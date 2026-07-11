/**
 * popup.js
 * Drives the popup UI: tab switching, config inputs, start/stop control,
 * live progress rendering, results list rendering, history rendering,
 * and CSV/JSON export.
 *
 * All durable state lives in background.js / chrome.storage.local so the
 * popup can be closed and reopened mid-scrape without losing data.
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // Element refs
  // ---------------------------------------------------------------------

  const el = {
    statusBadge: document.getElementById('statusBadge'),
    statusLabel: document.getElementById('statusLabel'),
    contextWarning: document.getElementById('contextWarning'),

    tabs: Array.from(document.querySelectorAll('.tab-btn')),
    panels: {
      scrape: document.getElementById('panel-scrape'),
      results: document.getElementById('panel-results'),
      history: document.getElementById('panel-history')
    },
    resultsTabCount: document.getElementById('resultsTabCount'),

    domainFilter: document.getElementById('domainFilter'),
    maxPages: document.getElementById('maxPages'),
    maxPagesValue: document.getElementById('maxPagesValue'),
    delayMin: document.getElementById('delayMin'),
    delayMax: document.getElementById('delayMax'),
    delayRangeValue: document.getElementById('delayRangeValue'),

    progressPanel: document.getElementById('progressPanel'),
    statPage: document.getElementById('statPage'),
    statLinks: document.getElementById('statLinks'),
    statRuntime: document.getElementById('statRuntime'),
    progressPhase: document.getElementById('progressPhase'),

    ctaBtn: document.getElementById('ctaBtn'),
    ctaIcon: document.getElementById('ctaIcon'),
    ctaLabel: document.getElementById('ctaLabel'),

    resultsCount: document.getElementById('resultsCount'),
    resultsList: document.getElementById('resultsList'),
    exportTxt: document.getElementById('exportTxt'),
    exportCsv: document.getElementById('exportCsv'),
    exportJson: document.getElementById('exportJson'),
    clearResults: document.getElementById('clearResults'),

    historyList: document.getElementById('historyList'),
    clearHistory: document.getElementById('clearHistory')
  };

  let runtimeTimer = null;
  let cachedResults = [];

  // ---------------------------------------------------------------------
  // Tab switching
  // ---------------------------------------------------------------------

  el.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      el.tabs.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      Object.values(el.panels).forEach((p) => p.classList.remove('is-active'));
      el.panels[btn.dataset.tab].classList.add('is-active');
    });
  });

  // ---------------------------------------------------------------------
  // Config inputs (sliders) — live label updates
  // ---------------------------------------------------------------------

  el.maxPages.addEventListener('input', () => {
    el.maxPagesValue.textContent = el.maxPages.value;
  });

  function formatSeconds(ms) {
    return (ms / 1000).toFixed(1).replace(/\.0$/, '') + 's';
  }

  function updateDelayLabel() {
    let lo = parseInt(el.delayMin.value, 10);
    let hi = parseInt(el.delayMax.value, 10);
    // Keep min <= max for sane UX; swap display order rather than fighting the user's drag
    if (lo > hi) [lo, hi] = [hi, lo];
    el.delayRangeValue.textContent = `${formatSeconds(lo)} – ${formatSeconds(hi)}`;
  }

  el.delayMin.addEventListener('input', updateDelayLabel);
  el.delayMax.addEventListener('input', updateDelayLabel);

  // ---------------------------------------------------------------------
  // Toast helper
  // ---------------------------------------------------------------------

  function showToast(message, variant = 'default') {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('is-error', 'is-success');
    if (variant === 'error') toast.classList.add('is-error');
    if (variant === 'success') toast.classList.add('is-success');
    toast.classList.add('is-visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  // ---------------------------------------------------------------------
  // Background messaging helpers
  // ---------------------------------------------------------------------

  function sendToBackground(message) {
    return chrome.runtime.sendMessage(message).catch((err) => {
      console.warn('[popup] background message failed', err);
      return { ok: false, error: String(err) };
    });
  }

  // ---------------------------------------------------------------------
  // Status badge / CTA state rendering
  // ---------------------------------------------------------------------

  function setStatus(state, label) {
    el.statusBadge.dataset.state = state;
    el.statusLabel.textContent = label;
  }

  function setRunningUI(isRunning) {
    el.ctaBtn.dataset.mode = isRunning ? 'stop' : 'start';
    el.ctaIcon.textContent = isRunning ? '■' : '▶';
    el.ctaLabel.textContent = isRunning ? 'Stop Extraction' : 'Start Extraction';
    el.progressPanel.dataset.active = isRunning ? 'true' : 'false';

    el.domainFilter.disabled = isRunning;
    el.maxPages.disabled = isRunning;
    el.delayMin.disabled = isRunning;
    el.delayMax.disabled = isRunning;

    if (isRunning) {
      setStatus('running', 'Scraping');
      startRuntimeClock();
    } else {
      stopRuntimeClock();
    }
  }

  function startRuntimeClock() {
    stopRuntimeClock();
    runtimeTimer = setInterval(() => {
      const meta = window.__sleMeta;
      if (!meta || !meta.startTime) return;
      const elapsed = Date.now() - meta.startTime;
      el.statRuntime.textContent = formatRuntime(elapsed);
    }, 1000);
  }

  function stopRuntimeClock() {
    if (runtimeTimer) {
      clearInterval(runtimeTimer);
      runtimeTimer = null;
    }
  }

  function formatRuntime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------
  // Results rendering
  // ---------------------------------------------------------------------

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function renderResults(results) {
    cachedResults = results || [];
    el.resultsCount.textContent = `${cachedResults.length} link${cachedResults.length === 1 ? '' : 's'}`;
    el.resultsTabCount.textContent = String(cachedResults.length);
    el.statLinks.textContent = String(cachedResults.length);

    if (cachedResults.length === 0) {
      el.resultsList.innerHTML = `
        <div class="empty-state">
          <p>No links extracted yet.</p>
          <span>Run an extraction from the Extract tab to populate this list.</span>
        </div>`;
      return;
    }

    // Render most recent first for a "live feed" feel, capped for popup performance
    const toRender = cachedResults.slice().reverse().slice(0, 300);
    el.resultsList.innerHTML = toRender.map((r) => `
      <div class="result-item">
        <div class="result-item-top">
          <span class="result-serial">#${r.serial}</span>
          <span class="result-title">${escapeHtml(r.title)}</span>
        </div>
        <a class="result-url" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.url)}</a>
        ${r.snippet ? `<p class="result-snippet">${escapeHtml(r.snippet)}</p>` : ''}
      </div>
    `).join('');
  }

  function renderHistory(history) {
    if (!history || history.length === 0) {
      el.historyList.innerHTML = `
        <div class="empty-state">
          <p>No history yet.</p>
          <span>Completed extraction sessions will be logged here.</span>
        </div>`;
      return;
    }

    el.historyList.innerHTML = history.map((h) => {
      const date = new Date(h.timestamp);
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const filterStr = h.domainFilter ? `filter: "${escapeHtml(h.domainFilter)}"` : 'no filter';
      const reasonMap = {
        limit_reached: 'page limit reached',
        no_more_pages: 'no more pages',
        navigation_error: 'navigation error',
        unknown: 'completed'
      };
      const reasonStr = reasonMap[h.completionReason] || h.completionReason;

      return `
        <div class="history-item">
          <div class="history-item-main">
            <span class="history-item-title">${dateStr} · ${timeStr}</span>
            <span class="history-item-meta">${h.totalPages} page${h.totalPages === 1 ? '' : 's'} · ${filterStr} · ${reasonStr}</span>
          </div>
          <span class="history-item-count">${h.totalUnique}</span>
        </div>
      `;
    }).join('');
  }

  // ---------------------------------------------------------------------
  // Progress rendering
  // ---------------------------------------------------------------------

  const PHASE_LABELS = {
    waiting: 'Pacing delay — avoiding rate limits…',
    navigating: 'Navigating to next page…',
    stopped: 'Stopped by user.',
    undefined: 'Scraping current page…'
  };

  function applyMeta(meta) {
    window.__sleMeta = meta;
    if (!meta) {
      setRunningUI(false);
      setStatus('idle', 'Idle');
      return;
    }

    setRunningUI(!!meta.running);

    if (meta.currentPage) el.statPage.textContent = String(meta.currentPage);
    if (typeof meta.totalUnique === 'number') {
      el.statLinks.textContent = String(meta.totalUnique);
    }
    if (meta.startTime) {
      const elapsed = (meta.endTime || Date.now()) - meta.startTime;
      el.statRuntime.textContent = formatRuntime(elapsed);
    }

    if (meta.running) {
      el.progressPhase.textContent = PHASE_LABELS[meta.status] || PHASE_LABELS.undefined;
    } else if (meta.completionReason) {
      const reasonMap = {
        limit_reached: 'Done — page limit reached.',
        no_more_pages: 'Done — reached the last page.',
        navigation_error: 'Stopped — navigation error occurred.',
        unknown: 'Extraction finished.'
      };
      setStatus('complete', 'Complete');
      el.progressPhase.textContent = reasonMap[meta.completionReason] || 'Extraction finished.';
      el.progressPanel.dataset.active = 'true';
    }
  }

  // ---------------------------------------------------------------------
  // Initial load: pull current state from background
  // ---------------------------------------------------------------------

  async function loadState() {
    const state = await sendToBackground({ type: 'SLE_POPUP_GET_STATE' });
    if (!state || !state.ok) return;
    renderResults(state.results);
    renderHistory(state.history);
    applyMeta(state.meta);

    if (state.meta) {
      el.domainFilter.value = state.meta.domainFilter || '';
      if (state.meta.maxPages) {
        el.maxPages.value = state.meta.maxPages;
        el.maxPagesValue.textContent = state.meta.maxPages;
      }
      if (state.meta.minDelayMs) el.delayMin.value = state.meta.minDelayMs;
      if (state.meta.maxDelayMs) el.delayMax.value = state.meta.maxDelayMs;
      updateDelayLabel();
    }
  }

  async function checkActiveTabContext() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      const onSearch = !!(tab && tab.url && /^https:\/\/www\.google\.[a-z.]+\/search/i.test(tab.url));
      el.contextWarning.hidden = onSearch;
      if (!onSearch) {
        el.ctaBtn.disabled = true;
      } else {
        el.ctaBtn.disabled = false;
      }
    } catch (_) {
      // tabs permission should always be available here; fail open
    }
  }

  // ---------------------------------------------------------------------
  // Live updates pushed from background while popup is open
  // ---------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'SLE_PROGRESS_RELAY': {
        // Merge partial progress payload into our cached meta view
        const merged = Object.assign({}, window.__sleMeta || {}, message.payload);
        applyMeta(merged);
        break;
      }
      case 'SLE_RESULTS_UPDATED_RELAY': {
        // Re-pull authoritative results from background storage
        sendToBackground({ type: 'SLE_POPUP_GET_STATE' }).then((state) => {
          if (state && state.ok) renderResults(state.results);
        });
        break;
      }
      case 'SLE_SCRAPE_COMPLETE_RELAY': {
        loadState();
        showToast(`Extraction finished — ${message.payload?.totalUnique ?? 0} links collected`, 'success');
        break;
      }
      default:
        break;
    }
  });

  // ---------------------------------------------------------------------
  // CTA: Start / Stop
  // ---------------------------------------------------------------------

  el.ctaBtn.addEventListener('click', async () => {
    const isRunning = el.ctaBtn.dataset.mode === 'stop';

    if (isRunning) {
      el.ctaBtn.disabled = true;
      const res = await sendToBackground({ type: 'SLE_POPUP_STOP' });
      el.ctaBtn.disabled = false;
      if (res && res.ok) {
        showToast('Extraction stopped.');
        loadState();
      }
      return;
    }

    let lo = parseInt(el.delayMin.value, 10);
    let hi = parseInt(el.delayMax.value, 10);
    if (lo > hi) [lo, hi] = [hi, lo];

    const payload = {
      domainFilter: el.domainFilter.value.trim(),
      maxPages: parseInt(el.maxPages.value, 10) || 10,
      minDelayMs: lo,
      maxDelayMs: hi
    };

    el.ctaBtn.disabled = true;
    const res = await sendToBackground({ type: 'SLE_POPUP_START', payload });
    el.ctaBtn.disabled = false;

    if (!res || !res.ok) {
      const reason = res && res.error === 'NOT_ON_GOOGLE_SEARCH'
        ? 'Open a Google Search results page first.'
        : 'Could not start extraction. Try reloading the Google Search tab.';
      showToast(reason, 'error');
      return;
    }

    setStatus('running', 'Scraping');
    setRunningUI(true);
    window.__sleMeta = { running: true, startTime: Date.now(), currentPage: 1, totalUnique: 0 };
    el.statPage.textContent = '1';
    el.statLinks.textContent = '0';
    el.progressPhase.textContent = 'Scraping current page…';
  });

  // ---------------------------------------------------------------------
  // Export: CSV
  // ---------------------------------------------------------------------

  function csvEscape(value) {
    const str = String(value ?? '');
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function buildCsv(results) {
    const header = ['Serial', 'URL', 'Title', 'Description'];
    const rows = results.map((r) => [r.serial, r.url, r.title, r.snippet || ''].map(csvEscape).join(','));
    return [header.join(','), ...rows].join('\r\n');
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      { url, filename, saveAs: false },
      () => URL.revokeObjectURL(url)
    );
  }

  function timestampForFilename() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  el.exportCsv.addEventListener('click', () => {
    if (cachedResults.length === 0) {
      showToast('No results to export yet.', 'error');
      return;
    }
    const csv = buildCsv(cachedResults);
    downloadBlob(csv, `link-extractor-${timestampForFilename()}.csv`, 'text/csv;charset=utf-8;');
    showToast('CSV export started.', 'success');
  });

  el.exportJson.addEventListener('click', () => {
    if (cachedResults.length === 0) {
      showToast('No results to export yet.', 'error');
      return;
    }
    const json = JSON.stringify(cachedResults, null, 2);
    downloadBlob(json, `link-extractor-${timestampForFilename()}.json`, 'application/json;charset=utf-8;');
    showToast('JSON export started.', 'success');
  });

  // ---------------------------------------------------------------------
  // TXT Export Functionality
  // ---------------------------------------------------------------------
  function buildTxt(results) {
    let textContent = "==================================================\n";
    textContent += "        SEARCH LINK EXTRACTOR REPORT\n";
    textContent += `        Total Links Extracted: ${results.length}\n`;
    textContent += "==================================================\n\n";

    results.forEach((item) => {
      textContent += `Serial No  : ${item.serial}\n`;
      textContent += `Title      : ${item.title || 'No Title'}\n`;
      textContent += `URL        : ${item.url}\n`;
      textContent += `Description: ${item.snippet || 'No Description'}\n`;
      textContent += "--------------------------------------------------\n";
    });

    return textContent;
  }

  el.exportTxt.addEventListener('click', () => {
    if (cachedResults.length === 0) {
      showToast('No results to export yet.', 'error');
      return;
    }
    const txtContent = buildTxt(cachedResults);
    downloadBlob(txtContent, `link-extractor-${timestampForFilename()}.txt`, 'text/plain;charset=utf-8;');
    showToast('TXT export started.', 'success');
  });

  el.clearResults.addEventListener('click', async () => {
    const res = await sendToBackground({ type: 'SLE_POPUP_CLEAR' });
    if (res && res.ok) {
      renderResults([]);
      showToast('Results cleared.');
    }
  });

  el.clearHistory.addEventListener('click', async () => {
    await chrome.storage.local.set({ sle_history: [] });
    renderHistory([]);
    showToast('History cleared.');
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  (async function init() {
    updateDelayLabel();
    await checkActiveTabContext();
    await loadState();
  })();

  // ---------------------------------------------------------------------
  // Footer Dynamic Tooltip / Popup Window on Hover
  // ---------------------------------------------------------------------
  const footerElement = document.getElementById('dedicationFooter');
  const tooltipElement = document.getElementById('footerTooltip');

  if (footerElement && tooltipElement) {
    // মাউস ফুটারে প্রবেশ করলে পপআপ দেখাবে
    footerElement.addEventListener('mouseenter', () => {
      tooltipElement.classList.add('active');
    });

    // মাউস ফুটার থেকে চলে গেলে পপআপ লুকিয়ে যাবে
    footerElement.addEventListener('mouseleave', () => {
      tooltipElement.classList.remove('active');
    });

    // মাউস ফুটারের ওপর নড়াচড়া করলে পপআপটি মাউসের সাথে সাথে সরবে
    footerElement.addEventListener('mousemove', (e) => {
      // মাউসের স্থানাঙ্ক (Coordinates) বের করা হচ্ছে
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      // পপআপটি মাউসের ঠিক নিচে এবং ডানপাশে একটু সরিয়ে রাখার জন্য (+15, -60 ইত্যাদি) অফসেট ব্যবহার করা হয়েছে
      tooltipElement.style.left = (mouseX + 12) + 'px';
      tooltipElement.style.top = (mouseY - 65) + 'px'; // মাউসের কিছুটা উপরে দেখাবে
    });
  }
})();
