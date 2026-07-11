/* ============================================================
   POPUP SCRIPT — UIController + ExportManager
   Handles all UI interactions, tab switching, live status,
   and multi-format export.
   ============================================================ */

'use strict';

class ExportManager {
  static sanitizeFilename(name) {
    return (name || 'extract').replace(/[^a-z0-9_\-]/gi, '_').slice(0, 60);
  }

  static downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  static exportJSON(data) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      this.downloadBlob(blob, `${this.sanitizeFilename()}_${Date.now()}.json`);
      return true;
    } catch (err) {
      console.error('[EXPORT] JSON error:', err);
      return false;
    }
  }

  static exportCSV(data) {
    try {
      if (!data.length) throw new Error('No data');
      const headers = ['title', 'url', 'snippet', 'engine', 'page', 'keyword', 'emails', 'phones', 'social', 'extractedAt'];
      const escape = (v) => {
        if (v === null || v === undefined) return '';
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      const rows = [headers.join(',')];
      data.forEach(r => {
        rows.push(headers.map(h => escape(r[h])).join(','));
      });
      const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      this.downloadBlob(blob, `${this.sanitizeFilename()}_${Date.now()}.csv`);
      return true;
    } catch (err) {
      console.error('[EXPORT] CSV error:', err);
      return false;
    }
  }

  static exportTXT(data) {
    try {
      const lines = data.map((r, i) => {
        return [
          `[${i + 1}] ${r.title}`,
          `    URL: ${r.url}`,
          `    Engine: ${r.engine} | Page: ${r.page} | Keyword: ${r.keyword}`,
          r.snippet ? `    Snippet: ${r.snippet}` : '',
          r.emails?.length ? `    Emails: ${r.emails.join(', ')}` : '',
          r.phones?.length ? `    Phones: ${r.phones.join(', ')}` : '',
          r.social && Object.keys(r.social).length ? `    Social: ${JSON.stringify(r.social)}` : '',
          ''
        ].filter(Boolean).join('\n');
      });
      const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
      this.downloadBlob(blob, `${this.sanitizeFilename()}_${Date.now()}.txt`);
      return true;
    } catch (err) {
      console.error('[EXPORT] TXT error:', err);
      return false;
    }
  }

  static exportXLSX(data) {
    try {
      if (typeof XLSX === 'undefined') throw new Error('XLSX library not loaded');
      const rows = data.map(r => ({
        Title: r.title || '',
        URL: r.url || '',
        Snippet: r.snippet || '',
        Engine: r.engine || '',
        Page: r.page || '',
        Keyword: r.keyword || '',
        Emails: (r.emails || []).join('; '),
        Phones: (r.phones || []).join('; '),
        Social: r.social ? Object.entries(r.social).map(([k, v]) => `${k}: ${v.join(',')}`).join(' | ') : '',
        Extracted: r.extractedAt || ''
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Results');
      XLSX.writeFile(wb, `${this.sanitizeFilename()}_${Date.now()}.xlsx`);
      return true;
    } catch (err) {
      console.error('[EXPORT] XLSX error:', err);
      alert('XLSX export failed: ' + err.message);
      return false;
    }
  }

  static exportPDF(data) {
    try {
      if (typeof window.jspdf === 'undefined' && typeof jspdf === 'undefined') {
        throw new Error('jsPDF library not loaded');
      }
      const { jsPDF } = window.jspdf || jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      doc.setFontSize(16);
      doc.setTextColor(0, 168, 255);
      doc.text('Search Link Extractor Pro — Report', 40, 40);
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`Generated: ${new Date().toLocaleString()} | Total Records: ${data.length}`, 40, 58);
      const rows = data.map((r, i) => [
        i + 1,
        (r.title || '').slice(0, 50),
        (r.url || '').slice(0, 60),
        r.engine || '',
        r.keyword || '',
        (r.emails || []).join(', ').slice(0, 40)
      ]);
      doc.autoTable({
        head: [['#', 'Title', 'URL', 'Engine', 'Keyword', 'Emails']],
        body: rows,
        startY: 75,
        styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
        headStyles: { fillColor: [0, 168, 255], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 248, 252] },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 170 },
          2: { cellWidth: 220 },
          3: { cellWidth: 60 },
          4: { cellWidth: 90 },
          5: { cellWidth: 140 }
        }
      });
      doc.save(`${this.sanitizeFilename()}_${Date.now()}.pdf`);
      return true;
    } catch (err) {
      console.error('[EXPORT] PDF error:', err);
      alert('PDF export failed: ' + err.message);
      return false;
    }
  }

  static export(format, data) {
    switch (format) {
      case 'json': return this.exportJSON(data);
      case 'csv':  return this.exportCSV(data);
      case 'txt':  return this.exportTXT(data);
      case 'xlsx': return this.exportXLSX(data);
      case 'pdf':  return this.exportPDF(data);
      default: return false;
    }
  }
}

class UIController {
  constructor() {
    this.currentTab = 'settings';
    this.results = [];
    this.history = [];
    this.config = {};
    this.running = false;
    this.tooltipEl = null;
    this.footerEl = null;
    this.init();
  }

  async init() {
    try {
      this.cacheElements();
      this.bindTabs();
      this.bindActions();
      this.bindFooterTooltip();
      await this.loadState();
      this.renderConfig();
      this.renderResults();
      this.renderHistory();
      this.listenForUpdates();
      this.detectEngine();
    } catch (err) {
      console.error('[UI] init error:', err);
    }
  }

  cacheElements() {
    this.$ = (sel) => document.querySelector(sel);
    this.$$ = (sel) => document.querySelectorAll(sel);
    this.tooltipEl = this.$('#footerTooltip');
    this.footerEl = this.$('#appFooter');
  }

  bindTabs() {
    this.$$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.$$('.tab-btn').forEach(b => b.classList.remove('active'));
        this.$$('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        this.$(`#tab-${tab}`).classList.add('active');
        this.currentTab = tab;
      });
    });
  }

  bindActions() {
    this.$('#btnSaveConfig').addEventListener('click', () => this.saveConfig());
    this.$('#btnStartBatch').addEventListener('click', () => this.startBatch());
    this.$('#btnQuickSearch').addEventListener('click', () => this.quickSearch());
    this.$('#btnStopJob').addEventListener('click', () => this.stopJob());
    this.$('#btnClearResults').addEventListener('click', () => this.clearResults());
    this.$('#btnClearHistory').addEventListener('click', () => this.clearHistory());
    this.$$('[data-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        const fmt = btn.dataset.export;
        if (!this.results.length) {
          alert('No data to export.');
          return;
        }
        ExportManager.export(fmt, this.results);
      });
    });
  }

  bindFooterTooltip() {
    if (!this.footerEl || !this.tooltipEl) return;
    this.footerEl.addEventListener('mouseenter', () => {
      this.tooltipEl.classList.add('visible');
    });
    this.footerEl.addEventListener('mouseleave', () => {
      this.tooltipEl.classList.remove('visible');
    });
    this.footerEl.addEventListener('mousemove', (e) => {
      try {
        const rect = this.footerEl.getBoundingClientRect();
        let x = e.clientX;
        let y = e.clientY;
        const ttWidth = this.tooltipEl.offsetWidth;
        const half = ttWidth / 2;
        if (x - half < 8) x = half + 8;
        if (x + half > window.innerWidth - 8) x = window.innerWidth - half - 8;
        this.tooltipEl.style.left = `${x}px`;
        this.tooltipEl.style.top = `${y}px`;
      } catch (err) {
        console.warn('[UI] tooltip move error:', err);
      }
    });
  }

  async loadState() {
    try {
      const state = await this.sendToBackground({ type: 'GET_STATE' });
      if (!state) return;
      this.config = state.config || {};
      this.results = state.results || [];
      this.history = state.history || [];
      this.running = !!state.running;
      this.updateJobUI();
    } catch (err) {
      console.error('[UI] loadState error:', err);
    }
  }

  renderConfig() {
    const c = this.config;
    const setVal = (id, v) => {
      const el = this.$(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    };
    setVal('#cfgEngine', c.engine);
    setVal('#cfgPages', c.maxPages);
    setVal('#cfgDelayMin', c.delayMin);
    setVal('#cfgDelayMax', c.delayMax);
    setVal('#cfgBlacklist', c.blacklist);
    setVal('#cfgKeywords', c.requiredKeywords);
    setVal('#cfgEnrich', c.enrich);
    setVal('#cfgDedup', c.dedup);
  }

  readConfigFromForm() {
    return {
      engine: this.$('#cfgEngine').value,
      maxPages: parseInt(this.$('#cfgPages').value, 10) || 5,
      delayMin: parseInt(this.$('#cfgDelayMin').value, 10) || 2000,
      delayMax: parseInt(this.$('#cfgDelayMax').value, 10) || 4500,
      blacklist: this.$('#cfgBlacklist').value,
      requiredKeywords: this.$('#cfgKeywords').value,
      enrich: this.$('#cfgEnrich').checked,
      dedup: this.$('#cfgDedup').checked
    };
  }

  async saveConfig() {
    try {
      const cfg = this.readConfigFromForm();
      await this.sendToBackground({ type: 'SAVE_CONFIG', config: cfg });
      this.config = cfg;
      this.flashStatus('Configuration saved', 'success');
    } catch (err) {
      console.error('[UI] saveConfig error:', err);
      this.flashStatus('Save failed: ' + err.message, 'error');
    }
  }

  async startBatch() {
    try {
      if (this.running) {
        alert('A job is already running.');
        return;
      }
      const raw = this.$('#batchKeywords').value.trim();
      if (!raw) {
        alert('Please enter at least one keyword.');
        return;
      }
      const keywords = raw.split(',').map(k => k.trim()).filter(Boolean);
      if (!keywords.length) {
        alert('No valid keywords found.');
        return;
      }
      await this.saveConfig();
      await this.sendToBackground({ type: 'START_BATCH', keywords });
      this.running = true;
      this.updateJobUI();
      this.flashStatus(`Batch started: ${keywords.length} keyword(s)`, 'running');
    } catch (err) {
      console.error('[UI] startBatch error:', err);
      this.flashStatus('Start failed: ' + err.message, 'error');
    }
  }

  async quickSearch() {
    try {
      const kw = this.$('#quickKeyword').value.trim();
      if (!kw) {
        alert('Enter a keyword for quick search.');
        return;
      }
      if (this.running) {
        alert('A job is already running.');
        return;
      }
      await this.saveConfig();
      await this.sendToBackground({ type: 'START_BATCH', keywords: [kw] });
      this.running = true;
      this.updateJobUI();
      this.flashStatus(`Quick search: "${kw}"`, 'running');
    } catch (err) {
      console.error('[UI] quickSearch error:', err);
      this.flashStatus('Search failed: ' + err.message, 'error');
    }
  }

  async stopJob() {
    try {
      await this.sendToBackground({ type: 'STOP_JOB' });
      this.running = false;
      this.updateJobUI();
      this.flashStatus('Job stopped by user', 'error');
    } catch (err) {
      console.error('[UI] stopJob error:', err);
    }
  }

  async clearResults() {
    if (!confirm('Clear all extracted results?')) return;
    try {
      await this.sendToBackground({ type: 'CLEAR_RESULTS' });
      this.results = [];
      this.renderResults();
      this.flashStatus('Results cleared', 'success');
    } catch (err) {
      console.error('[UI] clearResults error:', err);
    }
  }

  async clearHistory() {
    if (!confirm('Clear all job history?')) return;
    try {
      await this.sendToBackground({ type: 'CLEAR_HISTORY' });
      this.history = [];
      this.renderHistory();
      this.flashStatus('History cleared', 'success');
    } catch (err) {
      console.error('[UI] clearHistory error:', err);
    }
  }

  updateJobUI() {
    const btnStart = this.$('#btnStartBatch');
    const btnQuick = this.$('#btnQuickSearch');
    const btnStop = this.$('#btnStopJob');
    if (this.running) {
      btnStart.disabled = true;
      btnQuick.disabled = true;
      btnStop.disabled = false;
      this.$('#progressWrap').classList.remove('hidden');
    } else {
      btnStart.disabled = false;
      btnQuick.disabled = false;
      btnStop.disabled = true;
    }
  }

  renderResults() {
    const container = this.$('#resultsTable');
    const count = this.$('#resultCount');
    if (!container) return;
    count.textContent = this.results.length;
    if (!this.results.length) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>
          <p>No data yet. Run a search to populate results.</p>
        </div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    this.results.slice().reverse().forEach(r => {
      const row = document.createElement('div');
      row.className = 'result-row';
      const tags = [];
      if (r.emails?.length) tags.push(`<span class="result-tag email">✉ ${r.emails.length}</span>`);
      if (r.phones?.length) tags.push(`<span class="result-tag phone">☎ ${r.phones.length}</span>`);
      const socialCount = r.social ? Object.values(r.social).reduce((a, b) => a + b.length, 0) : 0;
      if (socialCount) tags.push(`<span class="result-tag social">⚡ ${socialCount}</span>`);
      row.innerHTML = `
        <div>
          <a class="result-title" href="${this.escapeAttr(r.url)}" target="_blank" rel="noopener">${this.escapeHTML(r.title)}</a>
          <div class="result-url">${this.escapeHTML(r.url)}</div>
          ${r.snippet ? `<div class="result-snippet">${this.escapeHTML(r.snippet)}</div>` : ''}
        </div>
        <div class="result-meta">
          <span class="result-tag">${r.engine}</span>
          ${tags.join('')}
        </div>`;
      frag.appendChild(row);
    });
    container.innerHTML = '';
    container.appendChild(frag);
  }

  renderHistory() {
    const container = this.$('#historyList');
    if (!container) return;
    if (!this.history.length) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <p>No past jobs recorded.</p>
        </div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    this.history.forEach(h => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const started = h.startedAt ? new Date(h.startedAt).toLocaleString() : '—';
      item.innerHTML = `
        <div class="history-head">
          <span class="history-keyword">${this.escapeHTML((h.keywords || []).slice(0, 3).join(', '))}${(h.keywords || []).length > 3 ? ' …' : ''}</span>
          <span class="history-time">${started}</span>
        </div>
        <div class="history-stats">
          <span>Engine: <strong>${h.engine || '—'}</strong></span>
          <span>Keywords: <strong>${(h.keywords || []).length}</strong></span>
          <span>Results: <strong>${h.resultsCount || 0}</strong></span>
          ${h.aborted ? '<span style="color: var(--danger)">Aborted</span>' : ''}
        </div>`;
      frag.appendChild(item);
    });
    container.innerHTML = '';
    container.appendChild(frag);
  }

  listenForUpdates() {
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        try {
          if (msg.type === 'ENGINE_DETECTED') {
            const badge = this.$('#engineBadge');
            const nameEl = this.$('#engineName');
            if (badge && nameEl && msg.engine) {
              nameEl.textContent = msg.engine;
              badge.classList.add('active');
            }
          }
          if (msg.type === 'SCRAPE_PROGRESS' && msg.progress) {
            const p = msg.progress;
            if (p.type === 'page_done') {
              const pct = Math.round((p.page / p.maxPages) * 100);
              this.$('#progressFill').style.width = pct + '%';
              this.$('#progressLabel').textContent = `Page ${p.page} / ${p.maxPages} • ${p.found} new`;
              this.$('#progressPercent').textContent = pct + '%';
              this.$('#statusText').textContent = `Scraping "${p.keyword}" — page ${p.page}`;
            } else if (p.type === 'waiting') {
              this.$('#statusText').textContent = `Waiting ${(p.ms / 1000).toFixed(1)}s (anti-bot)...`;
            }
          }
          if (msg.type === 'KEYWORD_START') {
            const total = msg.total || 1;
            const idx = (msg.index || 0) + 1;
            const pct = Math.round(((idx - 1) / total) * 100);
            this.$('#progressFill').style.width = pct + '%';
            this.$('#progressLabel').textContent = `Keyword ${idx} / ${total}`;
            this.$('#progressPercent').textContent = pct + '%';
            this.$('#statusText').textContent = `Starting: "${msg.keyword}"`;
          }
          if (msg.type === 'KEYWORD_DONE') {
            this.flashStatus(`✓ "${msg.keyword}" — ${msg.found} new results (total: ${msg.total})`, 'success');
          }
          if (msg.type === 'KEYWORD_ERROR') {
            this.flashStatus(`✗ "${msg.keyword}" — ${msg.error}`, 'error');
          }
          if (msg.type === 'JOB_COMPLETE') {
            this.running = false;
            this.updateJobUI();
            this.$('#progressFill').style.width = '100%';
            this.$('#progressPercent').textContent = '100%';
            this.$('#statusText').textContent = `Job complete — ${msg.resultsCount} total results`;
            this.flashStatus(`Job finished: ${msg.resultsCount} results`, 'success');
            (async () => {
              const state = await this.sendToBackground({ type: 'GET_STATE' });
              if (state) {
                this.results = state.results || [];
                this.history = state.history || [];
                this.renderResults();
                this.renderHistory();
              }
            })();
          }
          if (msg.type === 'JOB_ERROR') {
            this.running = false;
            this.updateJobUI();
            this.flashStatus('Job error: ' + msg.error, 'error');
          }
          if (msg.type === 'JOB_STOPPED') {
            this.running = false;
            this.updateJobUI();
            this.$('#statusText').textContent = 'Job stopped';
          }
        } catch (err) {
          console.warn('[UI] message handler error:', err);
        }
      });
    } catch (err) {
      console.error('[UI] listener setup error:', err);
    }
  }

  async detectEngine() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]) return;
      const tab = tabs[0];
      const host = new URL(tab.url || '').hostname.toLowerCase();
      let engine = null;
      if (host.includes('google.')) engine = 'google';
      else if (host.includes('bing.com')) engine = 'bing';
      else if (host.includes('yahoo.com') || host.includes('search.yahoo')) engine = 'yahoo';
      else if (host.includes('duckduckgo.com')) engine = 'duckduckgo';
      if (engine) {
        const badge = this.$('#engineBadge');
        const nameEl = this.$('#engineName');
        if (badge && nameEl) {
          nameEl.textContent = engine;
          badge.classList.add('active');
        }
      }
    } catch (err) {
      console.warn('[UI] detectEngine error:', err);
    }
  }

  flashStatus(text, kind = 'idle') {
    try {
      const dot = this.$('#jobStatus .status-dot');
      const label = this.$('#statusText');
      if (dot) {
        dot.classList.remove('idle', 'running', 'success', 'error');
        dot.classList.add(kind);
      }
      if (label) label.textContent = text;
    } catch (err) {
      console.warn('[UI] flashStatus error:', err);
    }
  }

  sendToBackground(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  escapeAttr(str) {
    return this.escapeHTML(str);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    new UIController();
  } catch (err) {
    console.error('[UI] bootstrap error:', err);
  }
});