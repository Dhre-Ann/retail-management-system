'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const appPath = path.join(root, 'js', 'app.js');
const apiPath = path.join(root, 'js', 'api.js');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeEl() {
  const listeners = {};
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    checked: false,
    classList: {
      add() {},
      remove() {},
      toggle() { return false; },
      contains() { return false; }
    },
    style: {},
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    dispatch(type, event) {
      return Promise.all((listeners[type] || []).map((fn) => fn(event || { preventDefault() {} })));
    },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    closest() { return null; },
    focus() {}
  };
}

function summaryFor(overrides) {
  return {
    requested: 10,
    attempted: 3,
    completed: 3,
    approved: 3,
    declined: 0,
    failed: 0,
    cancelled: 7,
    stop_requested: true,
    failure_reasons: [],
    total_sales: 30,
    average_ms: 5,
    min_ms: 4,
    max_ms: 6,
    total_elapsed_ms: 40,
    ...overrides
  };
}

async function bootApp() {
  const elements = new Map();
  const toasts = [];
  const errors = new Map();
  const session = {
    elements,
    toasts,
    errors,
    runs: [],
    cancels: [],
    cancelImpl: async (runId) => ({
      data: { state: 'stopping', message: 'Stop requested.' },
      sql: `POST /api/simulate/${runId}/cancel`,
      ms: 1
    }),
    el(id) {
      if (!elements.has(id)) elements.set(id, makeEl());
      return elements.get(id);
    }
  };

  const documentStub = {
    getElementById: (id) => session.el(id),
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    activeElement: null
  };
  const UI = {
    init() {},
    showSection() {},
    showError(id, message) { errors.set(id, message); },
    toast(message, kind) { toasts.push({ message, kind }); },
    logSql() {},
    escapeHtml(value) { return String(value ?? ''); },
    formatMoney(value) { return `$${value}`; },
    formatPercent(value) { return String(value); },
    clearTable() {},
    renderTable() {},
    exportTable() {},
    confirm: async () => true
  };
  const empty = async () => ({ data: [], sql: '', ms: 0 });
  const API = {
    health: async () => ({ data: { status: 'success' }, sql: '', ms: 0 }),
    getStores: empty,
    getProducts: empty,
    getBankAccounts: empty,
    getInventory: empty,
    getRowCounts: async () => ({ data: { counts: [], pending: true, message: 'pending' }, sql: '', ms: 0 }),
    runSimulation(options, signal) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      session.runs.push({ options, signal, resolve, reject });
      return promise;
    },
    cancelSimulation(runId) {
      session.cancels.push(runId);
      return session.cancelImpl(runId);
    }
  };

  const context = { document: documentStub, UI, API, console, AbortController };
  context.globalThis = context;
  const source = fs.readFileSync(appPath, 'utf8').replace('App.init();', '');
  vm.runInContext(source, vm.createContext(context));
  await context.App.init();

  session.start = async (count = 10, concurrency = 3) => {
    session.el('sim-customers').value = String(count);
    session.el('sim-stores').value = '1';
    session.el('sim-concurrency').value = String(concurrency);
    const done = session.el('sim-form').dispatch('submit');
    await flush();
    return done;
  };
  session.stop = () => session.el('stop-btn').dispatch('click');
  return session;
}

function finish(run, summary) {
  const transactions = [];
  for (let i = 0; i < summary.approved; i += 1) {
    transactions.push({ status: 'approved', total: summary.total_sales / summary.approved, receipt_id: i + 1 });
  }
  for (let i = 0; i < summary.cancelled; i += 1) {
    transactions.push({ status: 'cancelled', total: null, receipt_id: null, execution_ms: null });
  }
  run.resolve({
    data: { run_id: run.options.run_id, summary, transactions },
    sql: 'POST /api/simulate',
    ms: 5
  });
}

describe('Stop button', () => {
  test('sends one cancel for the active run and keeps waiting for the final summary', async () => {
    const session = await bootApp();
    const done = session.start(10, 3);
    await flush();
    assert.equal(session.runs.length, 1);
    const run = session.runs[0];
    assert.match(run.options.run_id, /^[A-Za-z0-9_-]{8,64}$/);
    assert.equal(run.options.concurrency, 3);

    await session.stop();
    await session.stop();
    await session.stop();
    assert.deepEqual(session.cancels, [run.options.run_id]);
    assert.equal(run.signal.aborted, false);
    assert.equal(session.el('sim-progress-label').textContent, 'Stopping');
    assert.ok(session.toasts.some((t) => /already requested/.test(t.message)));

    finish(run, summaryFor());
    await done;
    assert.equal(session.el('sim-progress-label').textContent, 'Stopped');
    assert.match(session.el('sim-summary').textContent, /Attempted 3\./);
    assert.match(session.el('sim-summary').textContent, /Skipped after Stop 7 of 10 requested\./);
    assert.equal(session.el('sim-attempted').textContent, '3');
    assert.equal(session.el('sim-progress-count').textContent, '3 / 10');
    assert.ok(!session.errors.get('sim-error'));
    assert.equal(session.el('sim-run-btn').disabled, false);

    const before = session.cancels.length;
    await session.stop();
    assert.equal(session.cancels.length, before);
    assert.match(session.toasts[session.toasts.length - 1].message, /Nothing is running/);
  });

  test('each run gets its own id, and a new run can be stopped again', async () => {
    const session = await bootApp();
    const first = session.start(4, 2);
    await flush();
    await session.stop();
    finish(session.runs[0], summaryFor({ requested: 4, attempted: 2, completed: 2, approved: 2, cancelled: 2, total_sales: 20 }));
    await first;

    const second = session.start(4, 2);
    await flush();
    await session.stop();
    finish(session.runs[1], summaryFor({ requested: 4, attempted: 2, completed: 2, approved: 2, cancelled: 2, total_sales: 20 }));
    await second;

    assert.notEqual(session.runs[0].options.run_id, session.runs[1].options.run_id);
    assert.deepEqual(session.cancels, [session.runs[0].options.run_id, session.runs[1].options.run_id]);
  });

  test('when the server cannot take the Stop, the page stops waiting', async () => {
    const session = await bootApp();
    session.cancelImpl = async () => {
      throw new Error('Cannot reach the backend.');
    };
    const done = session.start(5, 1);
    await flush();
    await session.stop();
    const run = session.runs[0];
    assert.equal(run.signal.aborted, true);
    const aborted = new Error('The page stopped waiting.');
    aborted.name = 'AbortError';
    run.reject(aborted);
    await done;
    assert.equal(session.el('sim-progress-label').textContent, 'Stopped');
  });
});

describe('cancelSimulation API', () => {
  test('posts to the cancel route for the given run and logs no SQL statements', async () => {
    const requests = [];
    const context = {
      performance: { now: () => 0 },
      fetch: async (url, options) => {
        requests.push({ url, method: options.method });
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ status: 'success', state: 'stopping', message: 'Stop requested.' });
          }
        };
      },
      console
    };
    context.globalThis = context;
    vm.runInContext(fs.readFileSync(apiPath, 'utf8'), vm.createContext(context));

    const result = await context.API.cancelSimulation('run-abc-123');
    assert.deepEqual(requests, [{ url: 'http://localhost:3000/api/simulate/run-abc-123/cancel', method: 'POST' }]);
    assert.equal(result.data.state, 'stopping');
    assert.match(result.sql, /No SQL runs/);
    await assert.rejects(() => context.API.cancelSimulation('bad id'), /valid run id/);
    assert.equal(requests.length, 1);
  });
});
