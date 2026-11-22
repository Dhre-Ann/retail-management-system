'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { beforeEach, describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const schemaPath = path.join(root, 'sql', 'schema.sql');
const seedPath = path.join(root, 'sql', 'seed.sql');
const poolPath = require.resolve(path.join(root, 'server', 'db', 'pool.js'));
const checkoutPath = require.resolve(path.join(root, 'server', 'services', 'checkoutService.js'));
const simulationPath = require.resolve(path.join(root, 'server', 'routes', 'simulation.js'));

const REQUIRED_TABLES = [
  ['supermarkets', 'statetax'],
  ['supermarkets', 'store'],
  ['supermarkets', 'product'],
  ['supermarkets', 'inventory'],
  ['supermarkets', 'receipt'],
  ['supermarkets', 'receiptitem'],
  ['supermarkets', 'payment'],
  ['banking', 'bankaccount']
];

const db = {
  queries: [],
  poolQueries: [],
  events: [],
  checkouts: [],
  released: 0,
  failOn: null,
  tables: [],
  counts: {},
  stock: [],
  accounts: [],
  receipts: [],
  checkoutMode: 'approve',
  pending: []
};

function stockedStore() {
  const rows = [];
  for (let i = 0; i < 15; i += 1) {
    rows.push({
      store_id: 1,
      sku: `SKU-${i}`,
      sold_by_weight: false,
      available_quantity: '20.00'
    });
  }
  return rows;
}

function readyDatabase() {
  db.tables = REQUIRED_TABLES.map(([table_schema, table_name]) => ({ table_schema, table_name }));
  db.counts = {
    statetax: 10,
    store: 100,
    product: 15,
    inventory: 1500,
    bankaccount: 20
  };
  db.stock = stockedStore();
  db.accounts = [{ account_id: 1 }];
}

const client = {
  async query(sql) {
    const text = String(sql);
    db.queries.push(text);
    if (text === 'COMMIT') db.events.push('commit');
    if (text === 'ROLLBACK') db.events.push('rollback');
    if (db.failOn && db.failOn(text) && text !== 'ROLLBACK') {
      throw new Error('forced failure');
    }
    if (text.includes('information_schema.tables')) {
      return { rows: db.tables };
    }
    if (text.includes('COUNT(*)::int')) {
      return { rows: [db.counts] };
    }
    return { rows: [] };
  },
  release() {
    db.released += 1;
  }
};

require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: {
    async connect() {
      return client;
    },
    async query(sql, params) {
      const text = String(sql);
      db.poolQueries.push({ text, params });
      db.events.push('pool');
      if (text.includes('LOCALTIMESTAMP')) {
        return { rows: db.receipts };
      }
      if (text.includes('FROM supermarkets.inventory')) {
        return { rows: db.stock };
      }
      if (text.includes('FROM banking.bankaccount')) {
        return { rows: db.accounts };
      }
      throw new Error(`unexpected pool query: ${text.slice(0, 80)}`);
    }
  }
};

require.cache[checkoutPath] = {
  id: checkoutPath,
  filename: checkoutPath,
  loaded: true,
  exports: {
    async processCheckout(payload) {
      db.checkouts.push(payload);
      db.events.push('checkout');
      const n = db.checkouts.length;
      if (db.checkoutMode === 'deferred') {
        return new Promise((resolve, reject) => {
          db.pending.push({ n, resolve, reject });
        });
      }
      if (db.checkoutMode === 'mixed') {
        if (n === 1) return { saved: true, receipt_id: 9, total: 20 };
        if (n === 2) return { saved: false, message: 'Insufficient funds' };
        throw new Error('Insufficient stock for SKU-0');
      }
      if (db.checkoutMode === 'throw') {
        throw new Error('Insufficient stock for SKU-0');
      }
      return { saved: true, receipt_id: n, total: 12.5 };
    }
  }
};

delete require.cache[simulationPath];
const simulation = require(simulationPath);

function handlerFor(method, routePath) {
  const layer = simulation.stack.find((entry) => (
    entry.route
    && entry.route.path === routePath
    && entry.route.methods[method]
  ));
  assert.ok(layer, `missing ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const simulate = handlerFor('post', '/simulate');
const recentReceipts = handlerFor('get', '/simulate/receipts');
const cancelRun = handlerFor('post', '/simulate/:runId/cancel');

async function until(predicate) {
  for (let i = 0; i < 500; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('timed out waiting for the simulation');
}

function cancel(runId) {
  const res = mockRes();
  cancelRun({ params: { runId } }, res);
  return res;
}

function approvePending() {
  const batch = db.pending.splice(0);
  batch.forEach((entry) => entry.resolve({ saved: true, receipt_id: entry.n, total: 10 }));
  return batch.length;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function requestBody(overrides) {
  return {
    body: {
      transaction_count: 1,
      concurrency: 1,
      store_count: 1,
      ...overrides
    }
  };
}

beforeEach(() => {
  db.queries = [];
  db.poolQueries = [];
  db.events = [];
  db.checkouts = [];
  db.released = 0;
  db.failOn = null;
  db.receipts = [];
  db.checkoutMode = 'approve';
  db.pending = [];
  readyDatabase();
});

describe('simulation summary', () => {
  test('counts stay consistent and revenue ignores declined and failed totals', () => {
    const summary = simulation.summarize(5, [
      { status: 'approved', total: 12.34, execution_ms: 5, message: null },
      { status: 'declined', total: 80, execution_ms: 4, message: 'Insufficient funds' },
      { status: 'failed', total: 50, execution_ms: 3, message: 'Insufficient stock for SKU-1' },
      { status: 'failed', total: 40, execution_ms: 6, message: 'Insufficient stock for SKU-1' },
      { status: 'failed', total: 9, execution_ms: 2, message: null }
    ], 20);

    assert.equal(summary.requested, 5);
    assert.equal(summary.attempted, 5);
    assert.equal(summary.completed, 2);
    assert.equal(summary.approved, 1);
    assert.equal(summary.declined, 1);
    assert.equal(summary.failed, 3);
    assert.equal(summary.approved + summary.declined + summary.failed, summary.attempted);
    assert.equal(summary.completed, summary.approved + summary.declined);
    assert.equal(Math.round(summary.total_sales * 100), 1234);
    assert.deepEqual(summary.failure_reasons, [
      { message: 'Insufficient stock for SKU-1', count: 2 },
      { message: 'Checkout failed', count: 1 }
    ]);
    assert.equal(summary.failure_reasons.reduce((sum, row) => sum + row.count, 0), summary.failed);
    assert.equal(summary.average_ms, 4);
    assert.equal(summary.min_ms, 2);
    assert.equal(summary.max_ms, 6);
    assert.equal(summary.total_elapsed_ms, 20);
  });
});

describe('simulation initialization', () => {
  test('creates missing tables and reference rows before any checkout', async () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const seed = fs.readFileSync(seedPath, 'utf8');
    const res = mockRes();
    await simulate(requestBody(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(db.queries[0], 'BEGIN');
    assert.equal(db.queries[1], schema);
    assert.equal(db.queries[2], seed);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS/);
    assert.match(seed, /ON CONFLICT DO NOTHING/);
    assert.doesNotMatch(schema, /^\s*(DELETE|UPDATE|TRUNCATE|DROP TABLE)\b/im);
    assert.doesNotMatch(seed, /^\s*(DELETE|UPDATE|TRUNCATE|DROP TABLE)\b/im);
    assert.equal(db.queries.includes('ROLLBACK'), false);
    assert.ok(db.queries.includes('COMMIT'));
    assert.equal(db.released, 1);
    assert.equal(db.checkouts.length, 1);
    const commitAt = db.events.indexOf('commit');
    const checkoutAt = db.events.indexOf('checkout');
    assert.ok(commitAt >= 0);
    assert.ok(checkoutAt > commitAt);
    assert.equal(res.body.summary.approved, 1);
    assert.equal(res.body.summary.failed, 0);
    assert.equal(res.body.summary.cancelled, 0);
    assert.equal(res.body.summary.stop_requested, false);
    assert.equal(res.body.summary.total_sales, 12.5);
    assert.deepEqual(res.body.summary.failure_reasons, []);
  });

  test('does not start checkouts when setup fails', async () => {
    db.failOn = (sql) => sql.includes('CREATE SCHEMA');
    const errorLog = console.error;
    console.error = () => {};
    try {
      const res = mockRes();
      await simulate(requestBody(), res);
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.status, 'error');
      assert.match(res.body.message, /Simulation did not start/);
      assert.match(res.body.message, /forced failure/);
      assert.ok(db.queries.includes('ROLLBACK'));
      assert.equal(db.queries.includes('COMMIT'), false);
      assert.equal(db.checkouts.length, 0);
      assert.equal(db.poolQueries.length, 0);
      assert.equal(db.released, 1);
    } finally {
      console.error = errorLog;
    }
  });

  test('does not start checkouts when required tables are still missing', async () => {
    db.tables = [];
    const errorLog = console.error;
    console.error = () => {};
    try {
      const res = mockRes();
      await simulate(requestBody(), res);
      assert.equal(res.statusCode, 500);
      assert.match(res.body.message, /required tables are still missing/);
      assert.match(res.body.message, /supermarkets\.receipt/);
      assert.match(res.body.message, /banking\.bankaccount/);
      assert.ok(db.queries.includes('ROLLBACK'));
      assert.equal(db.checkouts.length, 0);
    } finally {
      console.error = errorLog;
    }
  });

  test('does not start checkouts when reference data is still missing', async () => {
    db.counts = {
      statetax: 10,
      store: 100,
      product: 15,
      inventory: 0,
      bankaccount: 20
    };
    const errorLog = console.error;
    console.error = () => {};
    try {
      const res = mockRes();
      await simulate(requestBody(), res);
      assert.equal(res.statusCode, 500);
      assert.match(res.body.message, /required reference data is still missing/);
      assert.match(res.body.message, /supermarkets\.inventory/);
      assert.doesNotMatch(res.body.message, /supermarkets\.receipt/);
      assert.ok(db.queries.includes('ROLLBACK'));
      assert.equal(db.checkouts.length, 0);
    } finally {
      console.error = errorLog;
    }
  });

  test('groups checkout failures and excludes them from revenue', async () => {
    db.checkoutMode = 'mixed';
    const errorLog = console.error;
    console.error = () => {};
    try {
      const res = mockRes();
      await simulate(requestBody({ transaction_count: 3, concurrency: 1 }), res);
      assert.equal(res.statusCode, 200);
      assert.equal(db.checkouts.length, 3);
      const summary = res.body.summary;
      assert.equal(summary.attempted, 3);
      assert.equal(summary.completed, 2);
      assert.equal(summary.approved, 1);
      assert.equal(summary.declined, 1);
      assert.equal(summary.failed, 1);
      assert.equal(summary.total_sales, 20);
      assert.deepEqual(summary.failure_reasons, [
        { message: 'Insufficient stock for SKU-0', count: 1 }
      ]);
      assert.equal(res.body.transactions[2].status, 'failed');
      assert.equal(res.body.transactions[2].message, 'Insufficient stock for SKU-0');
    } finally {
      console.error = errorLog;
    }
  });
});

describe('simulation stop', () => {
  test('with 3 concurrent connections, Stop lets running checkouts finish and starts no more', async () => {
    db.checkoutMode = 'deferred';
    const errorLog = console.error;
    console.error = () => {};
    try {
      const res = mockRes();
      const running = simulate(requestBody({
        run_id: 'run-concurrent-1',
        transaction_count: 10,
        concurrency: 3
      }), res);

      await until(() => db.pending.length === 3);
      const first = cancel('run-concurrent-1');
      const second = cancel('run-concurrent-1');
      assert.equal(first.statusCode, 200);
      assert.equal(first.body.state, 'stopping');
      assert.equal(second.statusCode, 200);
      assert.equal(second.body.state, 'already_stopping');

      const inFlight = db.pending.splice(0);
      inFlight[0].resolve({ saved: true, receipt_id: 1, total: 10 });
      inFlight[1].resolve({ saved: false, message: 'Insufficient funds' });
      inFlight[2].reject(new Error('Insufficient stock for SKU-0'));
      await running;

      assert.equal(res.statusCode, 200);
      assert.equal(db.checkouts.length, 3);
      assert.equal(db.pending.length, 0);
      const summary = res.body.summary;
      assert.equal(res.body.run_id, 'run-concurrent-1');
      assert.equal(summary.requested, 10);
      assert.equal(summary.attempted, 3);
      assert.equal(summary.cancelled, 7);
      assert.equal(summary.completed, 2);
      assert.equal(summary.approved, 1);
      assert.equal(summary.declined, 1);
      assert.equal(summary.failed, 1);
      assert.equal(summary.stop_requested, true);
      assert.equal(summary.total_sales, 10);
      assert.equal(summary.attempted + summary.cancelled, summary.requested);
      assert.deepEqual(summary.failure_reasons, [
        { message: 'Insufficient stock for SKU-0', count: 1 }
      ]);
      const skipped = res.body.transactions.filter((tx) => tx.status === 'cancelled');
      assert.equal(skipped.length, 7);
      assert.ok(skipped.every((tx) => tx.execution_ms === null && tx.receipt_id === null));
      assert.ok(Number.isFinite(summary.average_ms));

      const late = cancel('run-concurrent-1');
      assert.equal(late.body.state, 'not_running');
    } finally {
      console.error = errorLog;
    }
  });

  test('with 1 connection, Stop after the first checkout starts skips the rest', async () => {
    db.checkoutMode = 'deferred';
    const res = mockRes();
    const running = simulate(requestBody({
      run_id: 'run-single-01',
      transaction_count: 5,
      concurrency: 1
    }), res);

    await until(() => db.pending.length === 1);
    cancel('run-single-01');
    approvePending();
    await running;

    assert.equal(db.checkouts.length, 1);
    assert.equal(res.body.summary.attempted, 1);
    assert.equal(res.body.summary.approved, 1);
    assert.equal(res.body.summary.cancelled, 4);
  });

  test('Stop affects only the run it names', async () => {
    db.checkoutMode = 'deferred';
    const resA = mockRes();
    const resB = mockRes();
    let finished = 0;
    const runA = simulate(requestBody({
      run_id: 'run-target-A',
      transaction_count: 6,
      concurrency: 2
    }), resA).then(() => { finished += 1; });
    const runB = simulate(requestBody({
      run_id: 'run-other-B',
      transaction_count: 6,
      concurrency: 2
    }), resB).then(() => { finished += 1; });

    await until(() => db.pending.length === 4);
    cancel('run-target-A');
    while (finished < 2) {
      approvePending();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.all([runA, runB]);

    assert.equal(resA.body.summary.attempted, 2);
    assert.equal(resA.body.summary.cancelled, 4);
    assert.equal(resA.body.summary.stop_requested, true);
    assert.equal(resB.body.summary.attempted, 6);
    assert.equal(resB.body.summary.cancelled, 0);
    assert.equal(resB.body.summary.stop_requested, false);
    assert.equal(db.checkouts.length, 8);
  });

  test('a Stop that arrives before the run request starts no checkouts', async () => {
    const early = cancel('run-early-01');
    assert.equal(early.statusCode, 200);
    assert.equal(early.body.state, 'not_running');

    const res = mockRes();
    await simulate(requestBody({
      run_id: 'run-early-01',
      transaction_count: 4,
      concurrency: 2
    }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(db.checkouts.length, 0);
    assert.equal(res.body.summary.attempted, 0);
    assert.equal(res.body.summary.cancelled, 4);
    assert.equal(res.body.summary.total_sales, 0);
    assert.ok(db.queries.includes('COMMIT'));
  });

  test('rejects bad run ids and a second run with an active id', async () => {
    assert.equal(cancel('bad id!').statusCode, 400);

    const badRun = mockRes();
    await simulate(requestBody({ run_id: 'x' }), badRun);
    assert.equal(badRun.statusCode, 400);
    assert.equal(db.checkouts.length, 0);

    db.checkoutMode = 'deferred';
    const first = mockRes();
    const running = simulate(requestBody({ run_id: 'run-dupe-01' }), first);
    await until(() => db.pending.length === 1);
    const dupe = mockRes();
    await simulate(requestBody({ run_id: 'run-dupe-01' }), dupe);
    assert.equal(dupe.statusCode, 409);
    approvePending();
    await running;
    assert.equal(first.statusCode, 200);
    assert.equal(db.checkouts.length, 1);
  });
});

describe('recent receipts', () => {
  test('rejects an unknown interval before querying', async () => {
    const res = mockRes();
    await recentReceipts({ query: { interval: 'custom' } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /5min, 15min, 1hour, or 24hour/);
    assert.equal(db.poolQueries.length, 0);
  });

  test('loads receipt rows for a whitelisted interval', async () => {
    db.receipts = [
      {
        receipt_id: '4',
        store_id: '1',
        store_name: 'FreshMart Houston #1',
        receipt_date: '2026-11-22',
        receipt_time: '11:52:01',
        subtotal: '10.00',
        tax_amount: '0.83',
        total_amount: '10.83',
        payment_method: 'card',
        payment_status: 'approved'
      }
    ];
    const res = mockRes();
    await recentReceipts({ query: { interval: '15min' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.label, '15 minutes');
    assert.equal(res.body.truncated, false);
    assert.deepEqual(db.poolQueries[0].params, ['15 minutes', 101]);
    assert.match(db.poolQueries[0].text, /LOCALTIMESTAMP - \$1::interval/);
    assert.equal(res.body.rows[0].receipt_id, 4);
    assert.equal(res.body.rows[0].store_name, 'FreshMart Houston #1');
    assert.equal(res.body.rows[0].total_amount, 10.83);
    assert.equal(res.body.rows[0].payment_status, 'approved');
  });
});
