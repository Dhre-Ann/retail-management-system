/**
 * ui.js — shared pieces of the page.
 *
 * Tables, toasts, the confirmation modal, and the "SQL Sent to Server" panel.
 * This file does not know about stores, carts, or SQL meaning. app.js asks it
 * to draw things and to record SQL strings that api.js returned.
 *
 * Loaded as a classic script (not a module) so home.html works from a double-click.
 */
'use strict';

const UI = (function () {
  const sqlEntries = [];
  let sqlOpen = true;
  let modalResolver = null;
  let lastFocus = null;

  // ----- small formatters -------------------------------------------------

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function formatPercent(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n)) return '—';
    return `${Number((n * 100).toFixed(3))}%`;
  }

  function formatWhen(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  }

  function formatClock(date) {
    const d = date instanceof Date ? date : new Date();
    return d.toLocaleTimeString();
  }

  // ----- toasts -----------------------------------------------------------

  function toast(message, type) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    const tone = type === 'error'
      ? 'bg-red-50 text-red-800 border-red-200'
      : type === 'info'
        ? 'bg-slate-50 text-slate-800 border-slate-200'
        : 'bg-emerald-50 text-emerald-900 border-emerald-200';
    el.className = `rounded-md border px-3 py-2 text-sm shadow-sm ${tone}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    root.appendChild(el);
    while (root.children.length > 4) root.removeChild(root.firstChild);
    const life = type === 'error' ? 8000 : 4000;
    setTimeout(() => {
      el.remove();
    }, life);
  }

  // ----- inline error text ------------------------------------------------

  function showError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.classList.add('hidden');
      return;
    }
    el.textContent = message;
    el.classList.remove('hidden');
  }

  // ----- confirmation modal -----------------------------------------------

  /**
   * Opens the modal and resolves true only when Confirm is pressed.
   * Cancel, Escape, and the backdrop resolve false.
   */
  function confirm(options) {
    const root = document.getElementById('modal-root');
    document.getElementById('modal-title').textContent = options.title;
    document.getElementById('modal-body').textContent = options.message;
    const confirmBtn = document.getElementById('modal-confirm');
    confirmBtn.textContent = options.confirmLabel || 'Confirm';
    lastFocus = document.activeElement;
    root.classList.remove('hidden');
    document.getElementById('modal-cancel').focus();
    return new Promise((resolve) => {
      modalResolver = resolve;
    });
  }

  function closeModal(confirmed) {
    const root = document.getElementById('modal-root');
    if (!root || root.classList.contains('hidden')) return;
    root.classList.add('hidden');
    const resolve = modalResolver;
    modalResolver = null;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    if (resolve) resolve(Boolean(confirmed));
  }

  function bindModal() {
    document.getElementById('modal-cancel').addEventListener('click', () => closeModal(false));
    document.getElementById('modal-confirm').addEventListener('click', () => closeModal(true));
    document.querySelector('[data-modal-backdrop]').addEventListener('click', () => closeModal(false));
    document.addEventListener('keydown', (event) => {
      const root = document.getElementById('modal-root');
      if (!root || root.classList.contains('hidden')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal(false);
      }
      if (event.key !== 'Tab') return;
      const cancelBtn = document.getElementById('modal-cancel');
      const confirmBtn = document.getElementById('modal-confirm');
      const trap = [cancelBtn, confirmBtn];
      const index = trap.indexOf(document.activeElement);
      event.preventDefault();
      const next = event.shiftKey
        ? trap[(index <= 0 ? trap.length : index) - 1]
        : trap[(index + 1) % trap.length];
      next.focus();
    });
  }

  // ----- SQL log ----------------------------------------------------------

  function syncSqlSpace() {
    const panel = document.getElementById('sql-panel');
    if (!panel) return;
    const height = Math.ceil(panel.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--sql-space', `${height + 16}px`);
  }

  function renderSql() {
    const log = document.getElementById('sql-log');
    const count = document.getElementById('sql-count');
    if (count) count.textContent = String(sqlEntries.length);
    if (!log) return;
    if (!sqlEntries.length) {
      log.textContent = 'No SQL yet. Actions on this page will list the statement text here.';
    } else {
      log.textContent = sqlEntries.map((entry) => {
        const timing = entry.ms == null ? '' : `  ${entry.ms} ms`;
        return `[${entry.clock}]${timing}\n${entry.sql}`;
      }).join('\n\n');
      log.scrollTop = log.scrollHeight;
    }
    syncSqlSpace();
  }

  function logSql(sql, ms) {
    if (!sql) return;
    sqlEntries.push({
      clock: formatClock(new Date()),
      ms: ms == null ? null : ms,
      sql: String(sql).trim()
    });
    renderSql();
  }

  function clearSql() {
    sqlEntries.length = 0;
    renderSql();
  }

  function sqlText() {
    return sqlEntries.map((entry) => {
      const timing = entry.ms == null ? '' : `  ${entry.ms} ms`;
      return `[${entry.clock}]${timing}\n${entry.sql}`;
    }).join('\n\n');
  }

  async function copySql() {
    const text = sqlText();
    if (!text) {
      toast('SQL log is empty.', 'info');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('clipboard unavailable');
      }
    } catch (err) {
      // file:// pages often block the clipboard API. Fall back to a hidden selection.
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (!ok) {
        toast('Copy failed. Select the log and copy it manually.', 'error');
        return;
      }
    }
    toast('SQL log copied.', 'success');
  }

  function setSqlOpen(open) {
    sqlOpen = Boolean(open);
    const log = document.getElementById('sql-log');
    const toggle = document.getElementById('sql-toggle');
    if (log) log.classList.toggle('hidden', !sqlOpen);
    if (toggle) {
      toggle.setAttribute('aria-expanded', sqlOpen ? 'true' : 'false');
    }
    syncSqlSpace();
  }

  function bindSql() {
    document.getElementById('sql-toggle').addEventListener('click', () => setSqlOpen(!sqlOpen));
    document.getElementById('sql-clear').addEventListener('click', () => {
      clearSql();
      toast('SQL log cleared.', 'info');
    });
    document.getElementById('sql-copy').addEventListener('click', () => {
      copySql();
    });
    const narrow = window.matchMedia('(max-width: 768px)').matches;
    setSqlOpen(!narrow);
    renderSql();
  }

  // ----- sortable tables --------------------------------------------------

  // Remember the last data given to each container so a header click can re-sort.
  const tables = new Map();

  function cellText(value, column, row) {
    if (typeof column.format === 'function') return column.format(value, row);
    if (value == null || value === '') return '—';
    return String(value);
  }

  function compareValues(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function paintTable(container) {
    const spec = tables.get(container);
    if (!spec) return;
    const columns = spec.columns || [];
    let rows = (spec.rows || []).slice();
    if (spec.sortKey) {
      const dir = spec.sortDir === 'desc' ? -1 : 1;
      rows.sort((a, b) => dir * compareValues(a[spec.sortKey], b[spec.sortKey]));
    }
    spec.viewRows = rows;

    if (!columns.length) {
      container.innerHTML = '<p class="text-sm text-slate-600">No columns to show.</p>';
      return;
    }

    const head = columns.map((column) => {
      const arrow = spec.sortKey === column.key ? (spec.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      const align = column.align === 'right' ? 'text-right' : 'text-left';
      return `<th scope="col" class="px-2 py-2 font-medium ${align}">
        <button type="button" class="underline decoration-slate-300 underline-offset-2" data-sort-key="${escapeHtml(column.key)}">${escapeHtml(column.label)}${arrow}</button>
      </th>`;
    }).join('');

    let body;
    if (!rows.length) {
      body = `<tr><td class="px-2 py-3 text-slate-500" colspan="${columns.length}">${escapeHtml(spec.emptyMessage || 'No rows to show.')}</td></tr>`;
    } else {
      body = rows.map((row) => {
        const cells = columns.map((column) => {
          const align = column.align === 'right' ? 'text-right' : 'text-left';
          const text = cellText(row[column.key], column, row);
          return `<td class="px-2 py-2 ${align}">${escapeHtml(text)}</td>`;
        }).join('');
        return `<tr class="border-t border-slate-100">${cells}</tr>`;
      }).join('');
    }

    container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="min-w-[36rem] w-full text-sm bg-white border border-slate-200 rounded-lg">
          <thead class="bg-slate-50 text-slate-600">${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="mt-2 text-sm text-slate-500">${rows.length} row${rows.length === 1 ? '' : 's'}</p>`;
  }

  function renderTable(container, spec) {
    if (!container) return;
    const previous = tables.get(container);
    tables.set(container, {
      columns: spec.columns || [],
      rows: spec.rows || [],
      emptyMessage: spec.emptyMessage || 'No rows to show.',
      sortKey: spec.keepSort && previous ? previous.sortKey : null,
      sortDir: spec.keepSort && previous ? previous.sortDir : 'asc',
      viewRows: []
    });
    paintTable(container);
  }

  function clearTable(container) {
    if (!container) return;
    tables.delete(container);
    container.innerHTML = '';
  }

  function bindTables() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-sort-key]');
      if (!button) return;
      const container = button.closest('[data-table]');
      if (!container) return;
      const spec = tables.get(container);
      if (!spec) return;
      const key = button.getAttribute('data-sort-key');
      if (spec.sortKey === key) {
        spec.sortDir = spec.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        spec.sortKey = key;
        spec.sortDir = 'asc';
      }
      paintTable(container);
    });
  }

  function csvCell(value) {
    if (value == null) return '';
    const text = String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  /**
   * Download the rows currently shown in a table (including the active sort).
   * Client-side only — nothing is uploaded.
   */
  function exportTable(container, filename) {
    const spec = tables.get(container);
    if (!spec || !spec.viewRows) {
      toast('Nothing to export yet. Run the report first.', 'info');
      return;
    }
    const columns = spec.columns;
    const header = columns.map((column) => csvCell(column.label)).join(',');
    const lines = spec.viewRows.map((row) => (
      columns.map((column) => csvCell(cellText(row[column.key], column, row))).join(',')
    ));
    const csv = [header].concat(lines).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'report.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${spec.viewRows.length} row${spec.viewRows.length === 1 ? '' : 's'}.`, 'success');
  }

  // ----- sections ---------------------------------------------------------

  function showSection(name) {
    document.querySelectorAll('main > section').forEach((section) => {
      section.classList.toggle('hidden', section.id !== `section-${name}`);
    });
    document.querySelectorAll('.nav-btn').forEach((button) => {
      const on = button.getAttribute('data-section') === name;
      if (on) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
      button.classList.toggle('bg-emerald-50', on);
      button.classList.toggle('text-emerald-900', on);
      button.classList.toggle('border-emerald-600', on);
      button.classList.toggle('text-slate-700', !on);
      button.classList.toggle('border-transparent', !on);
    });
  }

  function init() {
    bindModal();
    bindSql();
    bindTables();
  }

  return {
    init,
    toast,
    showError,
    confirm,
    logSql,
    clearSql,
    setSqlOpen,
    renderTable,
    clearTable,
    exportTable,
    showSection,
    escapeHtml,
    formatMoney,
    formatNumber,
    formatPercent,
    formatWhen
  };
})();

globalThis.UI = UI;
