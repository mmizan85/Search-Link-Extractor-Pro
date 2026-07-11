/**
 * background.js (Service Worker)
 *
 * Responsibilities:
 *  - Relay start/stop commands from popup.js to content.js on the active Google tab
 *  - Receive scraped result batches + progress events from content.js (which may
 *    survive across page-navigation-induced context destruction) and persist them
 *    so the popup can read current state at any time, even if it was closed mid-scrape
 *  - Maintain the "current session" dataset (results array) in chrome.storage.local
 *  - Maintain a lightweight History Dashboard log of past completed sessions
 *  - Forward live progress events to the popup (when open) via runtime messaging
 */

'use strict';

const STORAGE_KEYS = {
  CURRENT_RESULTS: 'sle_current_results',
  CURRENT_META: 'sle_current_meta',
  HISTORY: 'sle_history'
};

const MAX_HISTORY_ENTRIES = 25;

// -----------------------------------------------------------------------
// Utility: safe storage helpers
// -----------------------------------------------------------------------

async function getCurrentResults() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.CURRENT_RESULTS);
  return Array.isArray(data[STORAGE_KEYS.CURRENT_RESULTS]) ? data[STORAGE_KEYS.CURRENT_RESULTS] : [];
}

async function setCurrentResults(results) {
  await chrome.storage.local.set({ [STORAGE_KEYS.CURRENT_RESULTS]: results });
}

async function getCurrentMeta() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.CURRENT_META);
  return data[STORAGE_KEYS.CURRENT_META] || null;
}

async function setCurrentMeta(meta) {
  await chrome.storage.local.set({ [STORAGE_KEYS.CURRENT_META]: meta });
}

async function appendHistoryEntry(entry) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  const history = Array.isArray(data[STORAGE_KEYS.HISTORY]) ? data[STORAGE_KEYS.HISTORY] : [];
  history.unshift(entry);
  while (history.length > MAX_HISTORY_ENTRIES) history.pop();
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: history });
}

/** Forward a message to the popup if it's currently open. Failures are expected/ignored. */
function forwardToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // No popup listening right now - that's fine, state is already persisted.
  });
}

// -----------------------------------------------------------------------
// Message handling
// -----------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  switch (message.type) {
    // ---- Commands relayed from popup -> active tab's content script ----
    case 'SLE_POPUP_START': {
      handlePopupStart(message.payload).then(sendResponse);
      return true; // keep channel open for async response
    }

    case 'SLE_POPUP_STOP': {
      handlePopupStop().then(sendResponse);
      return true;
    }

    case 'SLE_POPUP_GET_STATE': {
      handleGetState().then(sendResponse);
      return true;
    }

    case 'SLE_POPUP_CLEAR': {
      handleClear().then(sendResponse);
      return true;
    }

    // ---- Events coming up from content.js ----
    case 'SLE_RESULTS_BATCH': {
      handleResultsBatch(message.payload).then(() => {
        if (sendResponse) sendResponse({ ok: true });
      });
      return true;
    }

    case 'SLE_PROGRESS': {
      handleProgress(message.payload);
      forwardToPopup({ type: 'SLE_PROGRESS_RELAY', payload: message.payload });
      break;
    }

    case 'SLE_SCRAPE_COMPLETE': {
      handleScrapeComplete(message.payload).then(() => {
        forwardToPopup({ type: 'SLE_SCRAPE_COMPLETE_RELAY', payload: message.payload });
      });
      break;
    }

    default:
      break;
  }
});

// -----------------------------------------------------------------------
// Handlers
// -----------------------------------------------------------------------

async function getActiveGoogleSearchTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.url || !/^https:\/\/www\.google\.[a-z.]+\/search/i.test(tab.url)) {
    return null;
  }
  return tab;
}

async function handlePopupStart(payload) {
  const tab = await getActiveGoogleSearchTab();
  if (!tab) {
    return { ok: false, error: 'NOT_ON_GOOGLE_SEARCH' };
  }

  // Fresh session: clear previous results/meta
  await setCurrentResults([]);
  await setCurrentMeta({
    running: true,
    startTime: Date.now(),
    domainFilter: payload?.domainFilter || '',
    maxPages: payload?.maxPages || 10,
    minDelayMs: payload?.minDelayMs ?? 1500,
    maxDelayMs: payload?.maxDelayMs ?? 3500,
    currentPage: 1,
    totalUnique: 0
  });

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'SLE_START_SCRAPE',
      payload
    });
    return { ok: true, response };
  } catch (err) {
    return { ok: false, error: 'CONTENT_SCRIPT_UNREACHABLE', detail: String(err) };
  }
}

async function handlePopupStop() {
  const tab = await getActiveGoogleSearchTab();
  const meta = await getCurrentMeta();
  if (meta) {
    meta.running = false;
    await setCurrentMeta(meta);
  }
  if (!tab) {
    return { ok: true, note: 'No active Google Search tab; local state marked stopped.' };
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'SLE_STOP_SCRAPE' });
    return { ok: true };
  } catch (err) {
    return { ok: true, note: 'Tab unreachable, local state marked stopped.' };
  }
}

async function handleGetState() {
  const [results, meta, historyData] = await Promise.all([
    getCurrentResults(),
    getCurrentMeta(),
    chrome.storage.local.get(STORAGE_KEYS.HISTORY)
  ]);
  return {
    ok: true,
    results,
    meta,
    history: Array.isArray(historyData[STORAGE_KEYS.HISTORY]) ? historyData[STORAGE_KEYS.HISTORY] : []
  };
}

async function handleClear() {
  await setCurrentResults([]);
  await setCurrentMeta(null);
  return { ok: true };
}

async function handleResultsBatch(payload) {
  if (!payload || !Array.isArray(payload.results)) return;
  const existing = await getCurrentResults();

  // Re-check dedup at the aggregation layer too, in case of any race across
  // a navigation boundary where content.js's in-memory Set was reset.
  const seen = new Set(existing.map((r) => r.url.toLowerCase()));
  const merged = existing.slice();

  for (const r of payload.results) {
    const key = r.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      serial: merged.length + 1,
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      page: payload.page
    });
  }

  await setCurrentResults(merged);

  const meta = (await getCurrentMeta()) || {};
  meta.totalUnique = merged.length;
  meta.currentPage = payload.page;
  await setCurrentMeta(meta);

  forwardToPopup({
    type: 'SLE_RESULTS_UPDATED_RELAY',
    payload: { totalUnique: merged.length, page: payload.page }
  });
}

async function handleProgress(payload) {
  const meta = (await getCurrentMeta()) || {};
  Object.assign(meta, payload);
  await setCurrentMeta(meta);
}

async function handleScrapeComplete(payload) {
  const meta = (await getCurrentMeta()) || {};
  meta.running = false;
  meta.endTime = Date.now();
  meta.completionReason = payload?.reason || 'unknown';
  await setCurrentMeta(meta);

  const results = await getCurrentResults();
  await appendHistoryEntry({
    timestamp: Date.now(),
    totalUnique: results.length,
    totalPages: payload?.totalPages || meta.currentPage || 1,
    domainFilter: meta.domainFilter || '',
    completionReason: payload?.reason || 'unknown'
  });
}
