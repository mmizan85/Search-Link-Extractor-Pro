/**
 * content.js
 * Injected into https://www.google.com/search* pages.
 *
 * Responsibilities:
 *  - Parse the current SERP for result items (URL, title, snippet)
 *  - Clean tracking/redirect wrapper URLs into final destination URLs
 *  - Apply domain/pattern filtering + internal-Google exclusion
 *  - Deduplicate using a Set keyed on normalized URL
 *  - Auto-paginate by locating and clicking the "Next" control
 *  - Respect a randomized human-like delay between page transitions
 *  - Report progress + results back to background.js via chrome.runtime messaging
 *
 * Defensive design: every DOM query is guarded. If Google changes a class name,
 * we fall back to alternate selectors and skip cleanly rather than throwing.
 */

(() => {
  'use strict';

  // Guard against double-injection (Chrome can re-run content scripts on SPA-like navigations)
  if (window.__SLE_CONTENT_LOADED__) {
    return;
  }
  window.__SLE_CONTENT_LOADED__ = true;

  // ---------------------------------------------------------------------
  // Constants & State
  // ---------------------------------------------------------------------

  const SELECTORS = {
    // Result containers - Google has used several over time; try each in order.
    resultContainers: [
      'div.g',
      'div.tF2Cxc',
      'div.Gx5Zad',
      'div[data-sokoban-container]',
      'div.MjjYud'
    ],
    titleNode: ['h3'],
    linkNode: ['a[href]'],
    snippetNode: [
      'div.VwiC3b',
      'span.aCOpRe',
      'div.IsZvec',
      'div[data-sncf="1"]',
      'div.s'
    ],
    nextButton: [
      '#pnnext',
      'a#pnnext',
      'a[aria-label="Next page"]',
      'a[aria-label="Next"]'
    ]
  };

  const GOOGLE_INTERNAL_HOST_PATTERNS = [
    /^https?:\/\/(www\.)?google\.[a-z.]+\/(search|maps|imgres|shopping|preferences|intl|accounts|advanced_search|url)/i,
    /^https?:\/\/maps\.google\./i,
    /^https?:\/\/accounts\.google\./i,
    /^https?:\/\/support\.google\./i,
    /^https?:\/\/policies\.google\./i,
    /^https?:\/\/webcache\.googleusercontent\.com/i,
    /^https?:\/\/translate\.google\./i
  ];

  let state = {
    running: false,
    paused: false,
    currentPage: 1,
    maxPages: 10,
    minDelayMs: 1500,
    maxDelayMs: 3500,
    domainFilter: '',
    seenUrls: new Set(),
    startTime: null
  };

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /** Try a list of selectors against a root element, return first match or null. */
  function queryFirst(root, selectorList) {
    for (const sel of selectorList) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) {
        // Invalid selector in this Chrome version - skip
      }
    }
    return null;
  }

  /** Find all result containers using fallback selector list. */
  function findResultContainers() {
    for (const sel of SELECTORS.resultContainers) {
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes && nodes.length > 0) {
          return Array.from(nodes);
        }
      } catch (_) {
        // skip invalid selector
      }
    }
    return [];
  }

  /**
   * Clean a raw href pulled from a Google SERP anchor.
   * Handles:
   *  - Direct destination links (most common in modern Google markup)
   *  - /url?q=<dest>&sa=...  legacy redirect wrapper
   *  - /interstitial?url=<dest>
   * Returns null if the URL should be discarded (internal Google page, javascript:, etc).
   */
  function cleanUrl(rawHref) {
    if (!rawHref || typeof rawHref !== 'string') return null;
    if (rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return null;

    let absolute;
    try {
      absolute = new URL(rawHref, window.location.origin);
    } catch (_) {
      return null;
    }

    // Unwrap Google's /url? redirect wrapper
    if (absolute.pathname === '/url' || absolute.pathname === '/interstitial') {
      const wrapped = absolute.searchParams.get('q') || absolute.searchParams.get('url');
      if (wrapped) {
        try {
          absolute = new URL(wrapped);
        } catch (_) {
          return null;
        }
      }
    }

    const finalHref = absolute.href;

    // Exclude internal Google system links
    for (const pattern of GOOGLE_INTERNAL_HOST_PATTERNS) {
      if (pattern.test(finalHref)) return null;
    }

    // Exclude anything that isn't http/https (mailto:, tel:, etc.)
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return null;

    return finalHref;
  }

  /** Normalize a URL for dedup purposes (strip trailing slash, fragment, common tracking params). */
  function normalizeForDedup(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
      stripParams.forEach((p) => u.searchParams.delete(p));
      let normalized = u.toString();
      if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
      return normalized.toLowerCase();
    } catch (_) {
      return url.toLowerCase();
    }
  }

  /** Check whether a URL passes the user-supplied domain/pattern filter. */
  function matchesDomainFilter(url, filterRaw) {
    if (!filterRaw) return true;
    const filter = filterRaw.trim().toLowerCase();
    if (!filter) return true;
    // Support comma-separated list of patterns; match if ANY pattern is contained in the URL.
    const patterns = filter.split(',').map((p) => p.trim()).filter(Boolean);
    if (patterns.length === 0) return true;
    const lowerUrl = url.toLowerCase();
    return patterns.some((p) => lowerUrl.includes(p));
  }

  /** Extract title + snippet + cleaned URL for one result container. */
  function extractResult(container) {
    const linkEl = queryFirst(container, SELECTORS.linkNode);
    if (!linkEl) return null;

    const rawHref = linkEl.getAttribute('href');
    const cleaned = cleanUrl(rawHref);
    if (!cleaned) return null;

    const titleEl = queryFirst(container, SELECTORS.titleNode);
    const title = titleEl ? titleEl.textContent.trim() : '(No title found)';

    const snippetEl = queryFirst(container, SELECTORS.snippetNode);
    const snippet = snippetEl ? snippetEl.textContent.trim() : '';

    return { url: cleaned, title, snippet };
  }

  /** Scrape the currently loaded SERP DOM and return an array of new (deduped, filtered) results. */
  function scrapeCurrentPage() {
    const containers = findResultContainers();
    const newResults = [];

    for (const container of containers) {
      try {
        const result = extractResult(container);
        if (!result) continue;

        const dedupKey = normalizeForDedup(result.url);
        if (state.seenUrls.has(dedupKey)) continue;

        if (!matchesDomainFilter(result.url, state.domainFilter)) continue;

        state.seenUrls.add(dedupKey);
        newResults.push(result);
      } catch (err) {
        // Never let one malformed result kill the whole scrape
        console.warn('[SLE] Skipped a malformed result node:', err);
      }
    }

    return newResults;
  }

  /** Locate the "Next" pagination control on the current SERP. */
  function findNextButton() {
    return queryFirst(document, SELECTORS.nextButton);
  }

  /** Random delay between minDelayMs and maxDelayMs, resolved as a Promise. */
  function humanDelay() {
    const { minDelayMs, maxDelayMs } = state;
    const lo = Math.min(minDelayMs, maxDelayMs);
    const hi = Math.max(minDelayMs, maxDelayMs);
    const ms = lo + Math.random() * (hi - lo);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Send a progress/status update to the popup via background relay. */
  function reportProgress(extra = {}) {
    chrome.runtime.sendMessage({
      type: 'SLE_PROGRESS',
      payload: {
        currentPage: state.currentPage,
        totalUnique: state.seenUrls.size,
        running: state.running,
        ...extra
      }
    }).catch(() => {
      // Popup may be closed - this is expected and harmless.
    });
  }

  /** Send a completed batch of results for this page to background for storage/aggregation. */
  function sendResultsBatch(results) {
    if (results.length === 0) return Promise.resolve();
    return chrome.runtime.sendMessage({
      type: 'SLE_RESULTS_BATCH',
      payload: { results, page: state.currentPage }
    }).catch(() => {});
  }

  /**
   * Main scrape loop: scrape page -> report -> wait -> click next -> repeat.
   * Stops when: max pages reached, no next button found, or user requested stop.
   */
  async function runScrapeLoop() {
    while (state.running) {
      const pageResults = scrapeCurrentPage();
      await sendResultsBatch(pageResults);
      reportProgress({ lastPageCount: pageResults.length });

      if (!state.running) break;

      if (state.currentPage >= state.maxPages) {
        finishScrape('limit_reached');
        return;
      }

      const nextBtn = findNextButton();
      if (!nextBtn) {
        finishScrape('no_more_pages');
        return;
      }

      // Human-like pacing before navigating to reduce anti-bot trigger likelihood
      reportProgress({ status: 'waiting' });
      await humanDelay();

      if (!state.running) break;

      state.currentPage += 1;
      reportProgress({ status: 'navigating' });

      try {
        nextBtn.click();
      } catch (err) {
        finishScrape('navigation_error');
        return;
      }

      // The click triggers a full page navigation on classic Google SERPs,
      // which destroys this content script context. We return here; if the
      // navigation actually happens, the freshly injected script picks up
      // the in-progress job from chrome.storage.local (see init()).
      return;
    }
  }

  function finishScrape(reason) {
    state.running = false;
    chrome.runtime.sendMessage({
      type: 'SLE_SCRAPE_COMPLETE',
      payload: { reason, totalUnique: state.seenUrls.size, totalPages: state.currentPage }
    }).catch(() => {});
    chrome.storage.local.remove('sle_active_job').catch(() => {});
  }

  // ---------------------------------------------------------------------
  // Job persistence across page navigations
  // ---------------------------------------------------------------------

  async function persistJob() {
    await chrome.storage.local.set({
      sle_active_job: {
        running: state.running,
        currentPage: state.currentPage,
        maxPages: state.maxPages,
        minDelayMs: state.minDelayMs,
        maxDelayMs: state.maxDelayMs,
        domainFilter: state.domainFilter,
        seenUrls: Array.from(state.seenUrls),
        startTime: state.startTime
      }
    });
  }

  async function loadJobIfActive() {
    const data = await chrome.storage.local.get('sle_active_job');
    const job = data && data.sle_active_job;
    if (job && job.running) {
      state.running = true;
      state.currentPage = job.currentPage || 1;
      state.maxPages = job.maxPages || 10;
      state.minDelayMs = job.minDelayMs ?? 1500;
      state.maxDelayMs = job.maxDelayMs ?? 3500;
      state.domainFilter = job.domainFilter || '';
      state.seenUrls = new Set(job.seenUrls || []);
      state.startTime = job.startTime || Date.now();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Message handling (commands from popup via background)
  // ---------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'SLE_START_SCRAPE': {
        const cfg = message.payload || {};
        state.running = true;
        state.currentPage = 1;
        state.maxPages = cfg.maxPages || 10;
        state.minDelayMs = cfg.minDelayMs ?? 1500;
        state.maxDelayMs = cfg.maxDelayMs ?? 3500;
        state.domainFilter = cfg.domainFilter || '';
        state.seenUrls = new Set();
        state.startTime = Date.now();
        persistJob().then(() => runScrapeLoop());
        sendResponse({ ok: true });
        break;
      }
      case 'SLE_STOP_SCRAPE': {
        state.running = false;
        chrome.storage.local.remove('sle_active_job').catch(() => {});
        reportProgress({ status: 'stopped' });
        sendResponse({ ok: true });
        break;
      }
      case 'SLE_PING': {
        sendResponse({ ok: true, onGoogleSearch: true });
        break;
      }
      default:
        break;
    }
  });

  // Keep persisted job state fresh as we go (covers the brief window before navigation)
  const persistInterval = setInterval(() => {
    if (state.running) persistJob();
  }, 1000);

  window.addEventListener('beforeunload', () => {
    clearInterval(persistInterval);
    if (state.running) persistJob();
  });

  // ---------------------------------------------------------------------
  // Init: resume an in-progress job after a pagination navigation
  // ---------------------------------------------------------------------

  async function init() {
    const resumed = await loadJobIfActive();
    if (resumed) {
      // Give the new SERP a brief moment to finish rendering before we scrape.
      setTimeout(() => runScrapeLoop(), 400);
    }
  }

  init();
})();
