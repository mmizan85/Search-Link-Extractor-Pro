/* ============================================================
   CONTENT SCRIPT — ScraperEngine
   Injected into search engine pages. Handles DOM scraping,
   pagination, data enrichment, and filtering.
   ============================================================ */

'use strict';

class DataEnricher {
  constructor() {
    this.regex = {
      email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
      social: {
        facebook:  /(?:https?:\/\/)?(?:www\.)?facebook\.com\/[A-Za-z0-9_.]+/gi,
        twitter:   /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+/gi,
        linkedin:  /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9_\-]+/gi,
        instagram: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9_.]+/gi
      }
    };
  }

  enrich(text) {
    if (!text || typeof text !== 'string') return { emails: [], phones: [], social: {} };
    const clean = text.replace(/\s+/g, ' ').trim();
    const emails = [...new Set((clean.match(this.regex.email) || []).map(e => e.toLowerCase()))];
    const phones = [...new Set((clean.match(this.regex.phone) || [])
      .filter(p => p.replace(/\D/g, '').length >= 7 && p.replace(/\D/g, '').length <= 15))];
    const social = {};
    for (const [platform, re] of Object.entries(this.regex.social)) {
      const matches = [...new Set((clean.match(re) || []).map(s => s.trim()))];
      if (matches.length) social[platform] = matches;
    }
    return { emails, phones, social };
  }
}

class FilterEngine {
  constructor(config = {}) {
    this.blacklist = (config.blacklist || []).map(d => d.toLowerCase().trim()).filter(Boolean);
    this.requiredKeywords = (config.requiredKeywords || []).map(k => k.toLowerCase().trim()).filter(Boolean);
    this.dedup = config.dedup !== false;
    this.seen = new Set();
  }

  passes(url, title, snippet) {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      for (const domain of this.blacklist) {
        if (host === domain || host.endsWith('.' + domain)) return false;
      }
      if (this.requiredKeywords.length) {
        const hay = ((title || '') + ' ' + (snippet || '')).toLowerCase();
        const ok = this.requiredKeywords.some(kw => hay.includes(kw));
        if (!ok) return false;
      }
      if (this.dedup) {
        const key = url.toLowerCase().replace(/\/$/, '');
        if (this.seen.has(key)) return false;
        this.seen.add(key);
      }
      return true;
    } catch {
      return false;
    }
  }

  reset() { this.seen.clear(); }
}

class ScraperEngine {
  constructor() {
    this.enricher = new DataEnricher();
    this.filter = null;
    this.engine = null;
    this.config = {};
    this.currentPage = 0;
    this.maxPages = 5;
    this.results = [];
    this.running = false;
    this.selectors = {
      google: {
        results: '#search .g, #rso .g',
        title: 'h3',
        link: 'a[href^="http"]',
        snippet: '[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"]',
        next: '#pnnext, a[aria-label="Next"]',
        searchInput: 'textarea[name="q"], input[name="q"]'
      },
      bing: {
        results: '#b_results > li.b_algo',
        title: 'h2',
        link: 'h2 a',
        snippet: '.b_caption p, .b_algoSlug',
        next: 'a.sb_pagN, a[title="Next page"]',
        searchInput: 'input[name="q"], textarea[name="q"]'
      },
      yahoo: {
        results: '#web ol li',
        title: 'h3.title a, h3 a',
        link: 'h3.title a, h3 a',
        snippet: '.compText p, .abstract',
        next: 'a.next, a[aria-label="Next"]',
        searchInput: 'input[name="p"], #yschsp'
      },
      duckduckgo: {
        results: 'article[data-testid="result"]',
        title: 'h2 a[data-testid="result-title-a"]',
        link: 'h2 a[data-testid="result-title-a"]',
        snippet: 'div[data-result="snippet"]',
        next: 'button[data-testid="pagination-next"], a[data-testid="pagination_next"]',
        searchInput: 'input[name="q"]'
      }
    };
  }

  detectEngine() {
    const host = location.hostname.toLowerCase();
    if (host.includes('google.')) return 'google';
    if (host.includes('bing.com')) return 'bing';
    if (host.includes('yahoo.com') || host.includes('search.yahoo')) return 'yahoo';
    if (host.includes('duckduckgo.com')) return 'duckduckgo';
    return null;
  }

  init(config = {}) {
    this.config = config;
    this.engine = config.engine === 'auto' ? this.detectEngine() : config.engine;
    if (!this.engine) throw new Error('Unsupported or undetected search engine.');
    this.maxPages = parseInt(config.maxPages, 10) || 5;
    this.currentPage = 0;
    this.results = [];
    this.running = true;
    this.filter = new FilterEngine({
      blacklist: (config.blacklist || '').split(',').map(s => s.trim()).filter(Boolean),
      requiredKeywords: (config.requiredKeywords || '').split(',').map(s => s.trim()).filter(Boolean),
      dedup: config.dedup !== false
    });
    return this.engine;
  }

  extractFromDOM() {
    const sel = this.selectors[this.engine];
    if (!sel) return [];
    const nodes = document.querySelectorAll(sel.results);
    const pageResults = [];
    nodes.forEach(node => {
      try {
        const titleEl = node.querySelector(sel.title);
        const linkEl = node.querySelector(sel.link);
        const snippetEl = node.querySelector(sel.snippet);
        if (!titleEl || !linkEl) return;
        const title = (titleEl.textContent || '').trim();
        let url = linkEl.getAttribute('href') || '';
        if (this.engine === 'google') {
          const real = linkEl.getAttribute('data-href') || linkEl.getAttribute('href');
          if (real && !real.startsWith('http')) {
            const m = real.match(/[?&]q=(https?[^&]+)/);
            if (m) url = decodeURIComponent(m[1]);
          } else if (real && real.startsWith('http') && !real.includes('google.')) {
            url = real;
          } else if (real && real.startsWith('/url?')) {
            const m = real.match(/[?&]q=(https?[^&]+)/);
            if (m) url = decodeURIComponent(m[1]);
          }
        }
        if (!url || !/^https?:\/\//i.test(url)) return;
        const snippet = (snippetEl ? snippetEl.textContent : '').trim();
        const combinedText = `${title} ${snippet}`;
        const enrichment = this.config.enrich ? this.enricher.enrich(combinedText) : { emails: [], phones: [], social: {} };
        if (!this.filter.passes(url, title, snippet)) return;
        pageResults.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: title || '(No title)',
          url,
          snippet: snippet || '',
          engine: this.engine,
          page: this.currentPage + 1,
          keyword: this.config.currentKeyword || '',
          extractedAt: new Date().toISOString(),
          emails: enrichment.emails,
          phones: enrichment.phones,
          social: enrichment.social
        });
      } catch (err) {
        console.warn('[SLEP] node parse error:', err);
      }
    });
    return pageResults;
  }

  hasNextButton() {
    const sel = this.selectors[this.engine];
    if (!sel || !sel.next) return false;
    const btn = document.querySelector(sel.next);
    return !!btn && btn.offsetParent !== null;
  }

  clickNext() {
    const sel = this.selectors[this.engine];
    if (!sel || !sel.next) return false;
    const btn = document.querySelector(sel.next);
    if (btn) {
      try {
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.click();
        return true;
      } catch (err) {
        console.warn('[SLEP] next click error:', err);
        return false;
      }
    }
    return false;
  }

  async injectKeyword(keyword) {
    const sel = this.selectors[this.engine];
    if (!sel || !sel.searchInput) return false;
    const input = document.querySelector(sel.searchInput);
    if (!input) return false;
    try {
      input.focus();
      input.value = keyword;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const form = input.closest('form');
      if (form) {
        form.submit();
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }
      return true;
    } catch (err) {
      console.warn('[SLEP] inject keyword error:', err);
      return false;
    }
  }

  async scrapeCurrentPage() {
    const pageResults = this.extractFromDOM();
    this.results.push(...pageResults);
    this.currentPage++;
    return {
      page: this.currentPage,
      found: pageResults.length,
      total: this.results.length
    };
  }

  async runFullScrape(onProgress) {
    const results = [];
    try {
      while (this.running && this.currentPage < this.maxPages) {
        const summary = await this.scrapeCurrentPage();
        results.push(...this.results.slice(this.results.length - summary.found));
        if (onProgress) {
          onProgress({
            type: 'page_done',
            page: summary.page,
            maxPages: this.maxPages,
            found: summary.found,
            total: summary.total,
            keyword: this.config.currentKeyword
          });
        }
        if (this.currentPage >= this.maxPages) break;
        if (!this.hasNextButton()) break;
        const delay = this.randomDelay();
        if (onProgress) {
          onProgress({ type: 'waiting', ms: delay, reason: 'anti-bot delay' });
        }
        await this.sleep(delay);
        if (!this.running) break;
        if (!this.clickNext()) break;
        await this.sleep(1500);
      }
      return { success: true, results: this.results, keyword: this.config.currentKeyword };
    } catch (err) {
      console.error('[SLEP] scrape error:', err);
      return { success: false, error: err.message, results: this.results };
    }
  }

  randomDelay() {
    const min = parseInt(this.config.delayMin, 10) || 2000;
    const max = parseInt(this.config.delayMax, 10) || 4500;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() { this.running = false; }
}

/* ============================================================
   MESSAGE LISTENER — bridges background <-> content
   ============================================================ */
const engine = new ScraperEngine();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.type === 'PING') {
      sendResponse({ ok: true, engine: engine.detectEngine() });
      return true;
    }
    if (msg.type === 'START_SCRAPE') {
      (async () => {
        try {
          const detected = engine.init(msg.config || {});
          chrome.runtime.sendMessage({
            type: 'ENGINE_DETECTED',
            engine: detected,
            keyword: msg.config?.currentKeyword
          }).catch(() => {});
          const result = await engine.runFullScrape((progress) => {
            chrome.runtime.sendMessage({ type: 'SCRAPE_PROGRESS', progress }).catch(() => {});
          });
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: err.message, results: [] });
        }
      })();
      return true;
    }
    if (msg.type === 'INJECT_KEYWORD') {
      (async () => {
        try {
          const ok = await engine.injectKeyword(msg.keyword);
          sendResponse({ ok });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }
    if (msg.type === 'STOP_SCRAPE') {
      engine.stop();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'GET_ENGINE') {
      sendResponse({ engine: engine.detectEngine() });
      return true;
    }
  } catch (err) {
    console.error('[SLEP] listener error:', err);
    sendResponse({ ok: false, error: err.message });
    return true;
  }
});

/* Announce readiness on load */
try {
  chrome.runtime.sendMessage({ type: 'CONTENT_READY', engine: engine.detectEngine() }).catch(() => {});
} catch (_) {}