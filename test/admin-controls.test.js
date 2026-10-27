'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { beforeEach, describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const seedPath = path.join(root, 'sql', 'seed.sql');
const schemaPath = path.join(root, 'sql', 'schema.sql');
const adminPath = require.resolve(path.join(root, 'server', 'routes', 'admin.js'));
const poolPath = require.resolve(path.join(root, 'server', 'db', 'pool.js'));
const apiPath = path.join(root, 'js', 'api.js');
const appPath = path.join(root, 'js', 'app.js');

const db = {
  queries: [],
  released: 0,
  failOn: null,
  rows: null,
  snapshot: null
};

function freshRows() {
  return {
    receiptitem: 2,
    payment: 2,
    receipt: 2,
    inventoryQty: 7,
    balance: 1
  };
}

const client = {
  async query(sql) {
    const text = String(sql);
    const command = text.trim();
    db.queries.push(text);
    if (command !== 'ROLLBACK' && db.failOn && db.failOn(command)) {
      throw new Error('forced failure');
    }
    if (command === 'BEGIN') {
      db.snapshot = { ...db.rows };
      return { rowCount: 0, rows: [] };
    }
    if (command === 'COMMIT') {
      db.snapshot = null;
      return { rowCount: 0, rows: [] };
    }
    if (command === 'ROLLBACK') {
      if (db.snapshot) db.rows = { ...db.snapshot };
      db.snapshot = null;
      return { rowCount: 0, rows: [] };
    }
    if (/^DELETE FROM supermarkets\.receiptitem\b/i.test(command)) {
      const count = db.rows.receiptitem;
      db.rows.receiptitem = 0;
      return { rowCount: count, rows: [] };
    }
    if (/^DELETE FROM supermarkets\.payment\b/i.test(command)) {
      const count = db.rows.payment;
      db.rows.payment = 0;
      return { rowCount: count, rows: [] };
    }
    if (/^DELETE FROM supermarkets\.receipt\b/i.test(command)) {
      const count = db.rows.receipt;
      db.rows.receipt = 0;
      return { rowCount: count, rows: [] };
    }
    if (/^UPDATE supermarkets\.inventory\b/i.test(command)) {
      db.rows.inventoryQty = 'seeded';
      return { rowCount: 1, rows: [] };
    }
    if (/^UPDATE banking\.bankaccount\b/i.test(command)) {
      db.rows.balance = 'seeded';
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
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
    async query() {
      throw new Error('pool.query bypasses the transaction');
    }
  }
};
delete require.cache[adminPath];
const router = require(adminPath);

function handlerFor(method, routePath) {
  const layer = router.stack.find((entry) => (
    entry.route
    && entry.route.path === routePath
    && entry.route.methods[method]
  ));
  assert.ok(layer, `missing ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const initialize = handlerFor('post', '/initialize');
const resetTransactions = handlerFor('post', '/reset-transactions');

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

function seedText() {
  return fs.readFileSync(seedPath, 'utf8');
}

function insertStatements(sql) {
  return sql
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /INSERT\s+INTO/i.test(part));
}

function statementFor(sql, tableName) {
  const statement = insertStatements(sql).find((part) => (
    new RegExp(`INSERT\\s+INTO\\s+${tableName}\\b`, 'i').test(part)
  ));
  assert.ok(statement, `missing insert for ${tableName}`);
  return statement;
}

function fragmentAfter(sql, insertMarker, startMarker) {
  const insertAt = sql.indexOf(insertMarker);
  assert.ok(insertAt >= 0, insertMarker);
  const start = sql.indexOf(startMarker, insertAt);
  assert.ok(start >= 0, startMarker);
  const end = sql.indexOf('ON CONFLICT DO NOTHING', start);
  assert.ok(end > start);
  return sql.slice(start, end).trim();
}

function emptyLookup() {
  return {
    statetax: new Map(),
    store: new Map(),
    product: new Map(),
    bankaccount: new Map(),
    inventory: new Map([['1|BAN-001', '3.00']])
  };
}

function applyIdempotentSeed(sql, lookup) {
  const statements = insertStatements(sql);
  assert.equal(statements.length, 5);
  for (const statement of statements) {
    assert.match(statement, /ON CONFLICT\s+DO NOTHING/i);
    assert.doesNotMatch(statement, /DO UPDATE/i);
    const table = statement.match(/INSERT\s+INTO\s+([a-z0-9_.]+)/i)[1];
    if (table === 'supermarkets.inventory') {
      assert.match(statement, /^[\s\S]*INSERT\s+INTO\s+supermarkets\.inventory/i);
      assert.doesNotMatch(statement, /\bUPDATE\b/i);
      continue;
    }
    const tuples = table === 'supermarkets.statetax'
      ? [...statement.matchAll(/\('([A-Z]{2})',\s*([0-9.]+)\)/g)].map((match) => [match[1], match[2]])
      : table === 'supermarkets.store'
        ? [...statement.matchAll(/\((\d+),\s*'([^']*)'/g)].map((match) => [match[1], match[2]])
        : table === 'supermarkets.product'
          ? [...statement.matchAll(/\('([A-Z0-9-]+)',\s*'([^']*)'/g)].map((match) => [match[1], match[2]])
          : [...statement.matchAll(/\((\d+),\s*'[^']*',\s*'(\d+)',\s*([0-9.]+)\)/g)].map((match) => [match[1], match[2], match[3]]);
    const name = table.split('.').pop();
    for (const fields of tuples) {
      if (name === 'bankaccount') {
        const [id, number, balance] = fields;
        const numberTaken = [...lookup.bankaccount.values()].some((row) => row.number === number && row.id !== id);
        if (lookup.bankaccount.has(id) || numberTaken) continue;
        lookup.bankaccount.set(id, { id, number, balance });
        continue;
      }
      if (lookup[name].has(fields[0])) continue;
      lookup[name].set(fields[0], fields);
    }
  }
}

function seededQuantity(storeId, rn, soldByWeight) {
  if ((storeId + rn) % 13 === 0) return 1 + ((storeId + rn) % 8);
  if (soldByWeight) return 40 + (storeId % 10);
  return 36 + (storeId % 10);
}

beforeEach(() => {
  db.queries = [];
  db.released = 0;
  db.failOn = null;
  db.rows = freshRows();
  db.snapshot = null;
});

describe('initialize lookup tables', () => {
  test('primary keys match the bare ON CONFLICT targets', () => {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS supermarkets\.statetax \([\s\S]*?state VARCHAR\(40\) PRIMARY KEY/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS supermarkets\.store \([\s\S]*?store_id INT PRIMARY KEY/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS supermarkets\.product \([\s\S]*?sku VARCHAR\(50\) PRIMARY KEY/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS supermarkets\.inventory \([\s\S]*?PRIMARY KEY \(store_id, sku\)/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS banking\.bankaccount \([\s\S]*?account_id INT PRIMARY KEY/);
    assert.match(schema, /account_number VARCHAR\(50\) UNIQUE NOT NULL/);
    assert.match(schema, /FOREIGN KEY \(receipt_id\)\s*REFERENCES supermarkets\.receipt\(receipt_id\),/);
    assert.match(schema, /FOREIGN KEY \(receipt_id\)\s*REFERENCES supermarkets\.receipt\(receipt_id\)\s*ON DELETE CASCADE/);
  });

  test('runs the seed file once inside a transaction on an empty database', async () => {
    const seed = seedText();
    const res = mockRes();
    await initialize({}, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'success');
    assert.match(res.body.message, /Existing rows were left unchanged/);
    assert.deepEqual(db.queries.map((sql, index) => (index === 1 ? 'SEED' : sql)), [
      'BEGIN',
      'SEED',
      'COMMIT'
    ]);
    assert.equal(db.queries[1], seed);
    assert.equal(db.released, 1);
    assert.equal(db.snapshot, null);

    const statements = insertStatements(seed);
    assert.equal(statements.length, 5);
    for (const statement of statements) {
      assert.match(statement, /ON CONFLICT\s+DO NOTHING/i);
      assert.doesNotMatch(statement, /ON CONFLICT\s*\([^)]+\)/i);
      assert.doesNotMatch(statement, /DO UPDATE/i);
    }
    assert.doesNotMatch(seed, /\bUPDATE\b/i);
    assert.doesNotMatch(seed, /\bDELETE\b/i);
    assert.equal((seed.match(/ON CONFLICT DO NOTHING;/g) || []).length, 5);

    const lookup = emptyLookup();
    applyIdempotentSeed(seed, lookup);
    assert.equal(lookup.statetax.size, 10);
    assert.equal(lookup.store.size, 100);
    assert.equal(lookup.product.size, 15);
    assert.equal(lookup.bankaccount.size, 20);
    assert.equal(lookup.inventory.get('1|BAN-001'), '3.00');
    assert.equal(lookup.statetax.get('TX')[1], '0.0825');
    assert.equal(lookup.store.get('1')[1], 'FreshMart Houston #1');
    assert.equal(lookup.store.get('100')[1], 'FreshMart Charlotte #100');
    assert.equal(lookup.product.get('BAN-001')[1], 'Bananas');
    assert.equal(lookup.bankaccount.get('1').balance, '250.00');
    assert.equal(lookup.bankaccount.get('20').balance, '5.00');
  });

  test('repeated initialization does not duplicate rows or overwrite balances', async () => {
    const res = mockRes();
    await initialize({}, res);
    const seed = db.queries[1];
    const lookup = emptyLookup();
    applyIdempotentSeed(seed, lookup);
    lookup.bankaccount.get('1').balance = '1.00';
    lookup.inventory.set('1|BAN-001', '3.00');

    db.queries = [];
    const again = mockRes();
    await initialize({}, again);
    applyIdempotentSeed(db.queries[1], lookup);

    assert.equal(again.statusCode, 200);
    assert.equal(lookup.statetax.size, 10);
    assert.equal(lookup.store.size, 100);
    assert.equal(lookup.product.size, 15);
    assert.equal(lookup.bankaccount.size, 20);
    assert.equal(lookup.bankaccount.get('1').balance, '1.00');
    assert.equal(lookup.inventory.get('1|BAN-001'), '3.00');
    assert.doesNotMatch(db.queries[1], /\bUPDATE\b/i);
    assert.match(statementFor(db.queries[1], 'supermarkets.inventory'), /ON CONFLICT\s+DO NOTHING/i);
    assert.match(statementFor(db.queries[1], 'banking.bankaccount'), /ON CONFLICT\s+DO NOTHING/i);
  });

  test('keeps the original seed values', () => {
    const seed = seedText();
    assert.match(seed, /\('TX', 0\.0825\)/);
    assert.match(seed, /\('NC', 0\.07\)/);
    assert.match(seed, /\(1, 'FreshMart Houston #1', '137 Oak Ave', 'Houston', 'TX', '77008', 25\)/);
    assert.match(seed, /\(100, 'FreshMart Charlotte #100', '200 Highland Rd', 'Charlotte', 'NC', '28208', 37\)/);
    assert.match(seed, /\('BAN-001', 'Bananas', 'Produce', 'exempt', 0\.69, TRUE, 'lb'\)/);
    assert.match(seed, /\('HHD-502', 'Paper Towels, 6 rolls', 'Household', 'taxable', 8\.49, FALSE, 'each'\)/);
    assert.match(seed, /CASE WHEN \(s\.store_id \+ p\.rn\) % 13 = 0 THEN 1 \+ \(s\.store_id \+ p\.rn\) % 8/);
    assert.match(seed, /\(1, 'Maria Chen', '1000004521', 250\.00\)/);
    assert.match(seed, /\(12, 'Mason Lee', '1000050821', 18\.00\)/);
    assert.match(seed, /\(20, 'Owen Adams', '1000080509', 5\.00\)/);
    assert.equal([...statementFor(seed, 'supermarkets.statetax').matchAll(/\('([A-Z]{2})'/g)].length, 10);
    assert.equal([...statementFor(seed, 'supermarkets.store').matchAll(/\((\d+),\s*'FreshMart/g)].length, 100);
    assert.equal([...statementFor(seed, 'supermarkets.product').matchAll(/\('([A-Z0-9-]+)'/g)].length, 15);
    assert.equal([...statementFor(seed, 'banking.bankaccount').matchAll(/\((\d+),\s*'/g)].length, 20);
  });

  test('rolls back when seeding fails', async () => {
    db.failOn = (sql) => sql.includes('INSERT INTO supermarkets.statetax');
    const errorLog = console.error;
    console.error = () => {};
    try {
      const res = mockRes();
      await initialize({}, res);
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.message, 'forced failure');
      assert.equal(db.queries[0], 'BEGIN');
      assert.ok(db.queries.includes('ROLLBACK'));
      assert.ok(!db.queries.includes('COMMIT'));
      assert.equal(db.released, 1);
    } finally {
      console.error = errorLog;
    }
  });
});

describe('reset transaction tables', () => {
  test('clears receipts in foreign-key order and restores seed quantities and balances', async () => {
    const seed = seedText();
    const adminSource = fs.readFileSync(adminPath, 'utf8');
    const inventorySelect = fragmentAfter(seed, 'INSERT INTO supermarkets.inventory', 'SELECT s.store_id,');
    const bankValues = fragmentAfter(seed, 'INSERT INTO banking.bankaccount', 'VALUES');
    const res = mockRes();
    await resetTransactions({}, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'success');
    assert.match(res.body.message, /restored to the seeded values/);
    assert.equal(db.queries[0], 'BEGIN');
    assert.equal(db.queries[1], 'DELETE FROM supermarkets.receiptitem');
    assert.equal(db.queries[2], 'DELETE FROM supermarkets.payment');
    assert.equal(db.queries[3], 'DELETE FROM supermarkets.receipt');
    assert.match(db.queries[4], /^\s*UPDATE supermarkets\.inventory\b/);
    assert.match(db.queries[5], /^\s*UPDATE banking\.bankaccount\b/);
    assert.equal(db.queries[6], 'COMMIT');
    assert.equal(db.released, 1);
    assert.equal(db.rows.receiptitem, 0);
    assert.equal(db.rows.payment, 0);
    assert.equal(db.rows.receipt, 0);
    assert.equal(db.rows.inventoryQty, 'seeded');
    assert.equal(db.rows.balance, 'seeded');

    const joined = db.queries.join('\n');
    assert.doesNotMatch(joined, /DELETE\s+FROM\s+supermarkets\.statetax/i);
    assert.doesNotMatch(joined, /DELETE\s+FROM\s+supermarkets\.store\b/i);
    assert.doesNotMatch(joined, /DELETE\s+FROM\s+supermarkets\.product\b/i);
    assert.doesNotMatch(joined, /DELETE\s+FROM\s+supermarkets\.inventory\b/i);
    assert.doesNotMatch(joined, /DELETE\s+FROM\s+banking\.bankaccount/i);
    assert.doesNotMatch(joined, /INSERT\s+INTO/i);
    assert.notEqual(joined, seed);

    assert.ok(db.queries[4].includes(inventorySelect));
    assert.match(db.queries[4], /SET\s+available_quantity\s*=\s*seeded\.available_quantity/i);
    assert.doesNotMatch(db.queries[4], /SET\s+aisle_number/i);
    assert.doesNotMatch(db.queries[4], /ON CONFLICT/i);
    assert.match(inventorySelect, /ROW_NUMBER\(\) OVER \(ORDER BY sku\)/);
    assert.match(inventorySelect, /WHEN p\.sold_by_weight\s+THEN 40 \+ s\.store_id % 10/);
    assert.match(inventorySelect, /ELSE\s+36 \+ s\.store_id % 10 END/);

    assert.ok(db.queries[5].includes(bankValues));
    assert.match(db.queries[5], /SET\s+account_balance\s*=\s*seeded\.account_balance/i);
    assert.doesNotMatch(db.queries[5], /SET\s+account_holder_name/i);
    assert.doesNotMatch(db.queries[5], /SET\s+account_number/i);
    assert.doesNotMatch(db.queries[5], /ON CONFLICT/i);
    const balances = [...bankValues.matchAll(/\((\d+),\s*'[^']*',\s*'(\d+)',\s*([0-9.]+)\)/g)];
    assert.equal(balances.length, 20);
    assert.deepEqual(balances.map((match) => match[1]), Array.from({ length: 20 }, (_, index) => String(index + 1)));
    assert.equal(balances[0][3], '250.00');
    assert.equal(balances[1][3], '12.50');
    assert.equal(balances[11][3], '18.00');
    assert.equal(balances[19][3], '5.00');

    const products = [...statementFor(seed, 'supermarkets.product').matchAll(/\('([A-Z0-9-]+)',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*[0-9.]+,\s*(TRUE|FALSE)/g)];
    const bananas = products.map((match) => ({ sku: match[1], soldByWeight: match[2] === 'TRUE' }))
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((product, index) => ({ ...product, rn: index + 1 }))
      .find((product) => product.sku === 'BAN-001');
    assert.equal(bananas.rn, 3);
    assert.equal(bananas.soldByWeight, true);
    assert.equal(seededQuantity(1, bananas.rn, bananas.soldByWeight), 41);
    assert.equal(seededQuantity(12, 1, true), 6);
    assert.equal(seededQuantity(1, 2, false), 37);

    assert.doesNotMatch(adminSource, /250\.00/);
    assert.doesNotMatch(adminSource, /1000004521/);
    assert.doesNotMatch(adminSource, /sold_by_weight/);
    assert.doesNotMatch(adminSource, /% 13/);
  });

  test('rolls back deletes and restores when a later step fails', async () => {
    db.failOn = (sql) => /^UPDATE banking\.bankaccount\b/i.test(sql);
    const errorLog = console.error;
    console.error = () => {};
    try {
      const res = mockRes();
      await resetTransactions({}, res);
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.status, 'error');
      assert.equal(res.body.message, 'forced failure');
      assert.ok(db.queries.includes('ROLLBACK'));
      assert.ok(!db.queries.includes('COMMIT'));
      assert.deepEqual(db.rows, freshRows());
      assert.equal(db.released, 1);
      assert.doesNotMatch(res.body.message, /restored to the seeded values/);
    } finally {
      console.error = errorLog;
    }
  });
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

function loadApi(fetchImpl) {
  const context = {
    performance: { now: () => 50 },
    fetch: fetchImpl,
    console
  };
  context.globalThis = context;
  vm.runInContext(fs.readFileSync(apiPath, 'utf8'), vm.createContext(context));
  return context.API;
}

describe('admin API and confirmation wiring', () => {
  test('initialize and reset call their endpoints and surface failures', async () => {
    const requests = [];
    const api = loadApi(async (url, options) => {
      requests.push({ url, method: options.method });
      if (url === 'http://localhost:3000/api/initialize') {
        return jsonResponse({
          status: 'success',
          message: 'Lookup tables initialized. Missing seed rows were inserted. Existing rows were left unchanged.'
        });
      }
      if (url === 'http://localhost:3000/api/reset-transactions') {
        return jsonResponse({
          status: 'success',
          message: 'Transaction tables reset. Receipt lines, payments, and receipts were deleted. Inventory quantities and bank balances were restored to the seeded values.'
        });
      }
      return jsonResponse({ status: 'error', message: 'missing' }, 404);
    });

    const initialized = await api.initLookupTables();
    const reset = await api.resetTransactionTables();
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, 'http://localhost:3000/api/initialize');
    assert.match(initialized.sql, /ON CONFLICT DO NOTHING/);
    assert.match(initialized.data.message, /left unchanged/);
    assert.equal(requests[1].method, 'POST');
    assert.equal(requests[1].url, 'http://localhost:3000/api/reset-transactions');
    assert.match(reset.sql, /DELETE FROM supermarkets\.receiptitem/);
    assert.match(reset.sql, /DELETE FROM supermarkets\.payment/);
    assert.match(reset.sql, /DELETE FROM supermarkets\.receipt/);
    assert.match(reset.data.message, /restored to the seeded values/);

    const failing = loadApi(async () => jsonResponse({
      status: 'error',
      message: 'current transaction is aborted'
    }, 500));
    await assert.rejects(
      () => failing.resetTransactionTables(),
      (error) => {
        assert.equal(error.message, 'current transaction is aborted');
        assert.notEqual(
          error.message,
          'Reset transaction tables is not connected to PostgreSQL yet. Nothing was deleted.'
        );
        return true;
      }
    );
  });

  test('buttons keep confirmations and show reset success only after the request resolves', async () => {
    const session = await bootApp();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let started = false;
    session.api.resetImpl = () => {
      started = true;
      return gate.then(() => ({
        data: { message: 'Transaction tables reset.' },
        sql: 'reset',
        ms: 4
      }));
    };

    const pending = session.elements.get('btn-reset-tx').dispatch('click');
    await flush();
    assert.equal(session.confirms.length, 1);
    assert.equal(session.confirms[0].title, 'Reset transaction tables?');
    assert.equal(session.confirms[0].confirmLabel, 'Reset transactions');
    assert.equal(started, true);
    assert.equal(session.toasts.length, 0);
    release();
    await pending;
    assert.equal(session.toasts.length, 1);
    assert.equal(session.toasts[0].kind, 'success');
    assert.equal(session.toasts[0].message, 'Transaction tables reset.');
    assert.equal(session.elements.get('btn-reset-tx').disabled, false);

    const cancelled = await bootApp();
    cancelled.setConfirm(false);
    await cancelled.elements.get('btn-reset-tx').dispatch('click');
    assert.equal(cancelled.calls.length, 0);
    assert.equal(cancelled.toasts.length, 0);

    const failed = await bootApp();
    failed.api.resetImpl = async () => {
      const error = new Error('forced failure');
      error.sql = 'reset';
      error.ms = 2;
      throw error;
    };
    await failed.elements.get('btn-reset-tx').dispatch('click');
    assert.equal(failed.toasts.length, 1);
    assert.equal(failed.toasts[0].kind, 'error');
    assert.equal(failed.toasts[0].message, 'forced failure');
    assert.equal(failed.elements.get('btn-reset-tx').disabled, false);

    const created = await bootApp();
    await created.elements.get('btn-create-tables').dispatch('click');
    assert.deepEqual(created.confirms, []);
    assert.deepEqual(created.calls, ['create']);
    assert.equal(created.toasts[0].kind, 'success');

    const initCancelled = await bootApp();
    initCancelled.setConfirm(false);
    await initCancelled.elements.get('btn-init-lookups').dispatch('click');
    assert.equal(initCancelled.confirms[0].title, 'Initialize lookup tables?');
    assert.equal(initCancelled.confirms[0].confirmLabel, 'Run seed script');
    assert.match(initCancelled.confirms[0].message, /does not delete or replace rows that are already there/);
    assert.doesNotMatch(initCancelled.confirms[0].message, /request fails/);
    assert.deepEqual(initCancelled.calls, []);

    const initialized = await bootApp();
    await initialized.elements.get('btn-init-lookups').dispatch('click');
    assert.deepEqual(initialized.calls, ['init']);
    assert.equal(initialized.toasts[0].kind, 'success');

    const deleted = await bootApp();
    deleted.setConfirm(false);
    await deleted.elements.get('btn-delete-rows').dispatch('click');
    assert.match(deleted.confirms[0].title, /Delete all rows/);
    assert.equal(deleted.confirms[0].confirmLabel, 'Delete rows');
    assert.deepEqual(deleted.calls, []);
  });
});

function flush() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function bootApp() {
  const toasts = [];
  const confirms = [];
  const calls = [];
  const elements = new Map();
  const session = {
    toasts,
    confirms,
    calls,
    elements,
    confirmResult: true,
    api: {
      resetImpl: async () => ({
        data: { message: 'Transaction tables reset.' },
        sql: 'reset',
        ms: 1
      })
    },
    setConfirm(value) {
      session.confirmResult = value;
    }
  };

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
      async dispatch(type, event) {
        for (const fn of listeners[type] || []) await fn(event || {});
      },
      setAttribute() {},
      getAttribute() { return null; },
      removeAttribute() {},
      closest() { return null; },
      focus() {}
    };
  }

  const documentStub = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl());
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    activeElement: null
  };
  const UI = {
    init() {},
    showSection() {},
    showError() {},
    toast(message, kind) { toasts.push({ message, kind }); },
    logSql() {},
    escapeHtml(value) { return String(value ?? ''); },
    formatMoney(value) { return `$${value}`; },
    formatPercent(value) { return String(value); },
    clearTable() {},
    renderTable() {},
    exportTable() {},
    confirm: async (options) => {
      confirms.push(options);
      return session.confirmResult;
    }
  };
  const API = {
    health: async () => ({ data: { status: 'success' }, sql: '', ms: 0 }),
    getStores: async () => ({ data: [], sql: '', ms: 0 }),
    getProducts: async () => ({ data: [], sql: '', ms: 0 }),
    getBankAccounts: async () => ({ data: [], sql: '', ms: 0 }),
    getRowCounts: async () => ({
      data: { counts: [], pending: true, message: 'pending' },
      sql: '',
      ms: 0
    }),
    getInventory: async () => ({ data: [], sql: '', ms: 0 }),
    createTables: async () => {
      calls.push('create');
      return { data: { message: 'Database tables created successfully.' }, sql: 'create', ms: 1 };
    },
    initLookupTables: async () => {
      calls.push('init');
      return {
        data: { message: 'Lookup tables initialized. Missing seed rows were inserted. Existing rows were left unchanged.' },
        sql: 'init',
        ms: 1
      };
    },
    resetTransactionTables: (...args) => session.api.resetImpl(...args),
    deleteAllRows: async () => {
      calls.push('delete');
      return { data: { message: '2 rows deleted from receipt.' }, sql: 'delete', ms: 1 };
    },
    browseTable: async () => {
      calls.push('browse');
      return { data: { columns: [], rows: [] }, sql: 'browse', ms: 1 };
    }
  };

  const context = {
    document: documentStub,
    UI,
    API,
    console
  };
  context.globalThis = context;
  let source = fs.readFileSync(appPath, 'utf8');
  assert.match(source, /App\.init\(\);/);
  source = source.replace('App.init();', '');
  vm.runInContext(source, vm.createContext(context));
  await context.App.init();
  return session;
}
