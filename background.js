/* ============================================================
   BACKGROUND SERVICE WORKER — TaskScheduler
   Manages batch jobs, coordinates popup <-> content script,
   persists state to chrome.storage.local.
   ============================================================ */

'use strict';

class StateStore {
  constructor() {
    this.defaults = {
      config: {
        engine: 'auto',
        maxPages: 5,
        delayMin: 2000,
        delayMax: 4500,
        blacklist: '',
        requiredKeywords: '',
        enrich: true,
        dedup: true
      },
      results: [],
      history: [],
      activeJob: null
    };
  }

  async get(key) {
    try {
      const data = await chrome.storage.local.get(key);
      return data[key] !== undefined ? data[key] : this.defaults[key];
    } catch (err) {
      console.error('[BG] StateStore.get error:', err);
      return this.defaults[key];
    }
  }

  async set(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
      return true;
    } catch (err) {
      console.error('[BG] StateStore.set error:', err);
      return false;
    }
  }

  async update(partial) {
    try {
      await chrome.storage.local.set(partial);
      return true;
    } catch (err) {
      console.error('[BG] StateStore.update error:', err);
      return false;
    }
  }
}

class TaskScheduler {
  constructor() {
    this.store = new StateStore();
    this.running = false;
    this.aborted = false;
    this.activeTabId = null;
    this.currentJob = null;
  }

  async ensureTab(url) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await chrome.tabs.update(tabs[0].id, { url, active: true });
        this.activeTabId = tabs[0].id;
        await this.waitForTabLoad(tabs[0].id);
        return tabs[0].id;
      } else {
        const tab = await chrome.tabs.create({ url, active: true });
        this.activeTabId = tab.id;
        await this.waitForTabLoad(tab.id);
        return tab.id;
      }
    } catch (err) {
      console.error('[BG] ensureTab error:', err);
      throw err;
    }
  }

  waitForTabLoad(tabId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const listener = (updatedId, changeInfo) => {
        if (updatedId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 800);
        }
        if (Date.now() - start > timeoutMs) {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('Tab load timeout'));
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId).then(tab => {
        if (tab.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 400);
        }
      }).catch(() => {});
    });
  }

  async sendMessageToTab(tabId, message, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Content script response timeout'));
      }, timeoutMs);
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  buildSearchUrl(engine, keyword) {
    const q = encodeURIComponent(keyword);
    switch (engine) {
      case 'google':       return `https://www.google.com/search?q=${q}`;
      case 'bing':         return `https://www.bing.com/search?q=${q}`;
      case 'yahoo':        return `https://search.yahoo.com/search?p=${q}`;
      case 'duckduckgo':   return `https://duckduckgo.com/?q=${q}`;
      default:             return `https://www.google.com/search?q=${q}`;
    }
  }

  async runBatch(keywords, config) {
    if (this.running) throw new Error('A job is already running.');
    this.running = true;
    this.aborted = false;
    const effectiveEngine = config.engine === 'auto' ? 'google' : config.engine;
    const allResults = [];
    const jobStartedAt = new Date().toISOString();
    this.currentJob = {
      id: `job_${Date.now()}`,
      keywords,
      engine: effectiveEngine,
      startedAt: jobStartedAt,
      totalKeywords: keywords.length,
      completedKeywords: 0,
      resultsCount: 0
    };
    await this.store.set('activeJob', this.currentJob);
    this.broadcast({ type: 'JOB_STARTED', job: this.currentJob });

    try {
      for (let i = 0; i < keywords.length; i++) {
        if (this.aborted) break;
        const kw = keywords[i].trim();
        if (!kw) continue;
        this.currentJob.currentKeyword = kw;
        this.broadcast({ type: 'KEYWORD_START', keyword: kw, index: i, total: keywords.length });
        const url = this.buildSearchUrl(effectiveEngine, kw);
        let tabId;
        try {
          tabId = await this.ensureTab(url);
        } catch (err) {
          console.warn('[BG] tab navigation failed:', err);
          this.broadcast({ type: 'KEYWORD_ERROR', keyword: kw, error: err.message });
          continue;
        }
        const scrapeConfig = {
          ...config,
          engine: effectiveEngine,
          currentKeyword: kw
        };
        try {
          const response = await this.sendMessageToTab(tabId, {
            type: 'START_SCRAPE',
            config: scrapeConfig
          });
          if (response && response.success) {
            allResults.push(...(response.results || []));
            await this.store.set('results', allResults);
            this.currentJob.resultsCount = allResults.length;
            this.broadcast({
              type: 'KEYWORD_DONE',
              keyword: kw,
              found: (response.results || []).length,
              total: allResults.length
            });
          } else {
            this.broadcast({
              type: 'KEYWORD_ERROR',
              keyword: kw,
              error: response?.error || 'Unknown scrape error'
            });
          }
        } catch (err) {
          console.warn('[BG] scrape failed for keyword:', kw, err);
          this.broadcast({ type: 'KEYWORD_ERROR', keyword: kw, error: err.message });
        }
        this.currentJob.completedKeywords = i + 1;
        await this.store.set('activeJob', this.currentJob);
        if (i < keywords.length - 1 && !this.aborted) {
          const interDelay = 2000 + Math.floor(Math.random() * 2000);
          this.broadcast({ type: 'WAITING', ms: interDelay, reason: 'inter-keyword delay' });
          await this.sleep(interDelay);
        }
      }
      const historyEntry = {
        id: this.currentJob.id,
        startedAt: jobStartedAt,
        finishedAt: new Date().toISOString(),
        keywords,
        engine: effectiveEngine,
        resultsCount: allResults.length,
        aborted: this.aborted
      };
      const history = await this.store.get('history');
      history.unshift(historyEntry);
      if (history.length > 50) history.length = 50;
      await this.store.set('history', history);
      await this.store.set('activeJob', null);
      this.broadcast({
        type: 'JOB_COMPLETE',
        job: historyEntry,
        resultsCount: allResults.length
      });
    } catch (err) {
      console.error('[BG] batch error:', err);
      this.broadcast({ type: 'JOB_ERROR', error: err.message });
    } finally {
      this.running = false;
      this.currentJob = null;
    }
  }

  async stop() {
    this.aborted = true;
    if (this.activeTabId) {
      try {
        await chrome.tabs.sendMessage(this.activeTabId, { type: 'STOP_SCRAPE' });
      } catch (_) {}
    }
    this.broadcast({ type: 'JOB_STOPPED' });
  }

  broadcast(msg) {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) {}
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const scheduler = new TaskScheduler();

/* ============================================================
   MESSAGE HANDLERS
   ============================================================ */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.type === 'GET_STATE') {
      (async () => {
        const [config, results, history, activeJob] = await Promise.all([
          scheduler.store.get('config'),
          scheduler.store.get('results'),
          scheduler.store.get('history'),
          scheduler.store.get('activeJob')
        ]);
        sendResponse({ config, results, history, activeJob, running: scheduler.running });
      })();
      return true;
    }

    if (msg.type === 'SAVE_CONFIG') {
      (async () => {
        await scheduler.store.set('config', msg.config);
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === 'START_BATCH') {
      (async () => {
        try {
          const config = await scheduler.store.get('config');
          const merged = { ...config, ...(msg.config || {}) };
          scheduler.runBatch(msg.keywords, merged).catch(err => {
            scheduler.broadcast({ type: 'JOB_ERROR', error: err.message });
          });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    if (msg.type === 'STOP_JOB') {
      scheduler.stop().then(() => sendResponse({ ok: true }));
      return true;
    }

    if (msg.type === 'CLEAR_RESULTS') {
      (async () => {
        await scheduler.store.set('results', []);
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === 'CLEAR_HISTORY') {
      (async () => {
        await scheduler.store.set('history', []);
        sendResponse({ ok: true });
      })();
      return true;
    }

    if (msg.type === 'APPEND_RESULTS') {
      (async () => {
        const existing = await scheduler.store.get('results');
        const merged = [...existing, ...(msg.results || [])];
        await scheduler.store.set('results', merged);
        sendResponse({ ok: true, total: merged.length });
      })();
      return true;
    }

    if (msg.type === 'CONTENT_READY' || msg.type === 'ENGINE_DETECTED' || msg.type === 'SCRAPE_PROGRESS') {
      scheduler.broadcast(msg);
      sendResponse({ ok: true });
      return true;
    }
  } catch (err) {
    console.error('[BG] handler error:', err);
    sendResponse({ ok: false, error: err.message });
    return true;
  }
});