/**
 * api.js — the only door to the backend.
 *
 * Screens call the functions at the bottom of this file. Each call returns
 * { data, sql, ms } or throws an Error with .sql and .ms. The sql string is
 * the HTTP request plus the statement the Express route runs, when that
 * statement is the same on every call. It is recorded in the "SQL Sent to
 * Server" panel. Checkout records the request only: the route's statements
 * depend on the payment method and the result, so listing them would claim
 * work that may not have run.
 *
 * Features that do not have a route yet throw instead of inventing rows.
 * Nothing in this file writes to the database except the functions that call
 * the existing create, seed, delete, and checkout routes.
 */
'use strict';

const API = (function () {
  const BASE = 'http://localhost:3000';

  const LIMITS = [10, 25, 50, 100];

  // Display name -> route name. Must match server/index.js allowedTables.
  const TABLE_API = {
    StateTax: 'statetax',
    Store: 'store',
    Product: 'product',
    Inventory: 'inventory',
    Receipt: 'receipt',
    ReceiptItem: 'receiptitem',
    Payment: 'payment',
    BankAccount: 'bankaccount'
  };

  const TABLE_SCHEMA = {
    statetax: 'supermarkets',
    store: 'supermarkets',
    product: 'supermarkets',
    inventory: 'supermarkets',
    receipt: 'supermarkets',
    receiptitem: 'supermarkets',
    payment: 'supermarkets',
    bankaccount: 'banking'
  };

  const NUMERIC_KEYS = new Set([
    'store_id',
    'aisle_count',
    'unit_price',
    'available_quantity',
    'aisle_number',
    'account_id',
    'account_balance',
    'receipt_id',
    'subtotal',
    'tax_amount',
    'total_amount',
    'tax_rate',
    'receipt_line_number',
    'quantity',
    'weight',
    'line_total',
    'payment_id',
    'amount',
    'num_receipts',
    'total_sales',
    'units_sold',
    'lbs_sold',
    'revenue',
    'tax_collected',
    'num_payments'
  ]);

  const MONEY_KEYS = new Set([
    'unit_price',
    'account_balance',
    'subtotal',
    'tax_amount',
    'total_amount',
    'line_total',
    'amount',
    'total_sales',
    'revenue',
    'tax_collected'
  ]);

  function fail(message, sql, ms) {
    const err = new Error(message);
    err.sql = sql || '';
    err.ms = ms == null ? 0 : ms;
    return err;
  }

  function finiteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async function request(method, path, sql, payload) {
    const started = performance.now();
    const headers = { Accept: 'application/json' };
    const options = { method, headers };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    let response;
    try {
      response = await fetch(BASE + path, options);
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      throw fail(
        `Cannot reach the backend at ${BASE}. ${err && err.message ? err.message : 'Network error.'}`,
        sql,
        ms
      );
    }

    const ms = Math.round(performance.now() - started);
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (err) {
        throw fail(`The backend returned a non-JSON response (${response.status}).`, sql, ms);
      }
    }
    if (!response.ok) {
      const message = body && typeof body.message === 'string' && body.message
        ? body.message
        : `Request failed (${response.status}).`;
      throw fail(message, sql, ms);
    }
    return { body, ms };
  }

  function expectArray(body, label, sql, ms) {
    if (!Array.isArray(body)) {
      throw fail(`${label} returned an unexpected response.`, sql, ms);
    }
    return body;
  }

  function expectMessage(body, label, sql, ms) {
    if (!body || typeof body.message !== 'string') {
      throw fail(`${label} returned an unexpected response.`, sql, ms);
    }
    return body;
  }

  function coerceRow(row) {
    const out = {};
    Object.keys(row || {}).forEach((key) => {
      const value = row[key];
      if (NUMERIC_KEYS.has(key)) out[key] = finiteNumber(value);
      else out[key] = value;
    });
    return out;
  }

  function columnsFor(rows) {
    if (!rows.length) return [{ key: 'notice', label: 'Notice' }];
    return Object.keys(rows[0]).map((key) => ({
      key,
      label: key,
      align: NUMERIC_KEYS.has(key) ? 'right' : 'left',
      format: MONEY_KEYS.has(key) ? 'money' : (key === 'tax_rate' ? 'percent' : undefined)
    }));
  }

  function formatAddress(row) {
    const cityLine = [row.city, row.zip_code].filter(Boolean).join(' ');
    return [row.street_address, cityLine].filter(Boolean).join(', ');
  }

  function publicStore(row, taxByState) {
    const state = row.state;
    return {
      store_id: finiteNumber(row.store_id),
      store_name: row.store_name,
      street_address: row.street_address,
      city: row.city,
      state,
      zip_code: row.zip_code,
      aisle_count: finiteNumber(row.aisle_count),
      address: formatAddress(row),
      tax_rate: Object.prototype.hasOwnProperty.call(taxByState, state) ? taxByState[state] : null
    };
  }

  function publicProduct(row) {
    const price = finiteNumber(row.unit_price);
    return {
      sku: row.sku,
      product_name: row.product_name,
      category: row.category,
      tax_treatment: row.tax_treatment,
      sold_by_weight: row.sold_by_weight === true,
      unit_of_measure: row.unit_of_measure,
      unit_price: price,
      price
    };
  }

  function publicInventory(row) {
    return {
      store_id: finiteNumber(row.store_id),
      sku: row.sku,
      available_quantity: finiteNumber(row.available_quantity),
      aisle_number: finiteNumber(row.aisle_number)
    };
  }

  function publicAccount(row) {
    return {
      account_id: finiteNumber(row.account_id),
      account_holder_name: row.account_holder_name,
      account_number: row.account_number,
      account_balance: finiteNumber(row.account_balance)
    };
  }

  function pending(message) {
    const sql = `-- not sent\n-- ${message}`;
    throw fail(message, sql, 0);
  }

  async function health() {
    const sql = [
      'GET /api/health',
      'SELECT NOW() AS server_time;'
    ].join('\n');
    const { body, ms } = await request('GET', '/api/health', sql);
    if (!body || body.status !== 'success') {
      throw fail(
        body && body.message ? body.message : 'Health check returned an unexpected response.',
        sql,
        ms
      );
    }
    return { data: body, sql, ms };
  }

  async function getStores() {
    const sql = [
      'GET /api/stores',
      'SELECT * FROM supermarkets.store;',
      '',
      'GET /api/tables/statetax?limit=100',
      'SELECT * FROM supermarkets.statetax LIMIT 100;'
    ].join('\n');
    const storesResult = await request('GET', '/api/stores', sql);
    const taxResult = await request('GET', '/api/tables/statetax?limit=100', sql);
    const ms = storesResult.ms + taxResult.ms;
    const storeRows = expectArray(storesResult.body, 'Store list', sql, ms);
    const taxRows = expectArray(taxResult.body, 'State tax list', sql, ms);
    const taxByState = {};
    taxRows.forEach((row) => {
      taxByState[row.state] = finiteNumber(row.tax_rate);
    });
    const data = storeRows
      .map((row) => publicStore(row, taxByState))
      .sort((a, b) => a.store_id - b.store_id);
    return { data, sql, ms };
  }

  async function getProducts() {
    const sql = [
      'GET /api/products',
      'SELECT * FROM supermarkets.product;'
    ].join('\n');
    const { body, ms } = await request('GET', '/api/products', sql);
    const data = expectArray(body, 'Product list', sql, ms)
      .map(publicProduct)
      .sort((a, b) => String(a.product_name).localeCompare(String(b.product_name)));
    return { data, sql, ms };
  }

  async function getInventory(storeId) {
    const id = Number(storeId);
    const sql = [
      `GET /api/inventory/${Number.isInteger(id) ? id : ''}`,
      'SELECT * FROM supermarkets.inventory WHERE store_id = $1;',
      `-- $1 = ${Number.isInteger(id) ? id : 'invalid'}`
    ].join('\n');
    if (!Number.isInteger(id)) {
      throw fail('Inventory lookup failed: store id must be a whole number.', sql, 0);
    }
    const { body, ms } = await request('GET', `/api/inventory/${id}`, sql);
    const data = expectArray(body, 'Inventory', sql, ms)
      .map(publicInventory)
      .sort((a, b) => (a.aisle_number - b.aisle_number) || String(a.sku).localeCompare(String(b.sku)));
    return { data, sql, ms };
  }

  async function getBankAccounts() {
    const sql = [
      'GET /api/bank-accounts',
      'SELECT * FROM banking.bankaccount;'
    ].join('\n');
    const { body, ms } = await request('GET', '/api/bank-accounts', sql);
    const data = expectArray(body, 'Bank account list', sql, ms)
      .map(publicAccount)
      .sort((a, b) => String(a.account_holder_name).localeCompare(String(b.account_holder_name)));
    return { data, sql, ms };
  }

  function checkoutSql(payload) {
    const lines = ['POST /api/checkout'];
    if (payload === undefined) {
      lines.push('-- No request body was sent.');
    } else {
      lines.push('-- Request body:');
      JSON.stringify(payload, null, 2).split('\n').forEach((line) => {
        lines.push(`-- ${line}`);
      });
    }
    lines.push('-- The server runs checkout in one transaction. Which statements run');
    lines.push('-- depends on the payment method and the result, so they are not listed here.');
    return lines.join('\n');
  }

  async function checkout(payload) {
    const sql = checkoutSql(payload);
    const { body, ms } = await request('POST', '/api/checkout', sql, payload);
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.saved !== 'boolean') {
      throw fail('Checkout returned an unexpected response.', sql, ms);
    }
    return { data: body, sql, ms };
  }

  const SALES_BY_STORE_SQL = [
    'SELECT',
    '    s.store_id,',
    '    s.store_name,',
    '    s.city,',
    '    s.state,',
    '    COUNT(r.receipt_id) AS num_receipts,',
    '    COALESCE(SUM(r.total_amount), 0) AS total_sales',
    'FROM supermarkets.store s',
    'LEFT JOIN supermarkets.receipt r',
    '    ON r.store_id = s.store_id',
    '    AND r.receipt_date BETWEEN $1 AND $2',
    'GROUP BY s.store_id, s.store_name, s.city, s.state',
    'ORDER BY total_sales DESC;'
  ].join('\n');

  const TOP_PRODUCTS_SQL = [
    'SELECT',
    '    p.sku,',
    '    p.product_name,',
    '    p.category,',
    '    COALESCE(SUM(ri.quantity), 0) AS units_sold,',
    '    COALESCE(SUM(ri.weight), 0) AS lbs_sold,',
    '    COALESCE(SUM(ri.line_total), 0) AS revenue',
    'FROM supermarkets.receiptitem ri',
    'JOIN supermarkets.product p',
    '    ON p.sku = ri.sku',
    'GROUP BY p.sku, p.product_name, p.category',
    'ORDER BY revenue DESC',
    'LIMIT $1;'
  ].join('\n');

  const TAX_BY_STATE_SQL = [
    'SELECT',
    '    st.state,',
    '    st.tax_rate,',
    '    COUNT(r.receipt_id) AS num_receipts,',
    '    COALESCE(SUM(r.subtotal), 0) AS subtotal,',
    '    COALESCE(SUM(r.tax_amount), 0) AS tax_collected',
    'FROM supermarkets.statetax st',
    'JOIN supermarkets.store s',
    '    ON s.state = st.state',
    'LEFT JOIN supermarkets.receipt r',
    '    ON r.store_id = s.store_id',
    'GROUP BY st.state, st.tax_rate',
    'ORDER BY tax_collected DESC;'
  ].join('\n');

  const SALES_BY_STATE_SQL = [
    'SELECT',
    '    s.state,',
    '    COUNT(r.receipt_id) AS num_receipts,',
    '    COALESCE(SUM(r.total_amount), 0) AS total_sales',
    'FROM supermarkets.store s',
    'LEFT JOIN supermarkets.receipt r',
    '    ON r.store_id = s.store_id',
    'GROUP BY s.state',
    'ORDER BY total_sales DESC;'
  ].join('\n');

  const LOW_STOCK_SQL = [
    'SELECT',
    '    s.state,',
    '    s.store_id,',
    '    s.store_name,',
    '    p.sku,',
    '    p.product_name,',
    '    i.available_quantity,',
    '    p.unit_of_measure',
    'FROM supermarkets.inventory i',
    'JOIN supermarkets.store s',
    '    ON s.store_id = i.store_id',
    'JOIN supermarkets.product p',
    '    ON p.sku = i.sku',
    'WHERE i.available_quantity < 10',
    'ORDER BY s.state, i.available_quantity ASC;'
  ].join('\n');

  const PAYMENTS_BY_METHOD_SQL = [
    'SELECT',
    '    payment_method,',
    '    payment_status,',
    '    COUNT(*) AS num_payments,',
    '    COALESCE(SUM(amount), 0) AS total_amount',
    'FROM supermarkets.payment',
    'GROUP BY payment_method, payment_status',
    'ORDER BY payment_method, payment_status;'
  ].join('\n');

  function isoDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function reportTable(title, columns, rows, emptyMessage, sql, ms) {
    return {
      data: {
        title,
        columns,
        rows: rows.map(coerceRow),
        emptyMessage
      },
      sql,
      ms
    };
  }

  async function salesByStore(params) {
    const start = params && params.start_date;
    const end = params && params.end_date;
    const sql = [
      `GET /api/reports/sales-by-store?start_date=${isoDate(start) ? start : ''}&end_date=${isoDate(end) ? end : ''}`,
      SALES_BY_STORE_SQL,
      `-- $1 = ${isoDate(start) ? start : 'invalid'}`,
      `-- $2 = ${isoDate(end) ? end : 'invalid'}`
    ].join('\n');
    if (!isoDate(start) || !isoDate(end)) {
      throw fail('Sales by store failed: choose both a start date and an end date.', sql, 0);
    }
    if (start > end) {
      throw fail('Sales by store failed: the start date is after the end date.', sql, 0);
    }
    const path = `/api/reports/sales-by-store?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
    const { body, ms } = await request('GET', path, sql);
    const rows = expectArray(body, 'Sales by store', sql, ms);
    return reportTable(
      'Sales total per store',
      [
        { key: 'store_id', label: 'store_id', align: 'right' },
        { key: 'store_name', label: 'store_name' },
        { key: 'city', label: 'city' },
        { key: 'state', label: 'state' },
        { key: 'num_receipts', label: 'num_receipts', align: 'right', format: 'number' },
        { key: 'total_sales', label: 'total_sales', align: 'right', format: 'money' }
      ],
      rows,
      'No stores were returned for this date range.',
      sql,
      ms
    );
  }

  async function topProducts(params) {
    const limit = Number(params && params.limit);
    const shown = LIMITS.includes(limit) ? limit : 'invalid';
    const sql = [
      `GET /api/reports/top-products?limit=${shown}`,
      TOP_PRODUCTS_SQL,
      `-- $1 = ${shown}`
    ].join('\n');
    if (!LIMITS.includes(limit)) {
      throw fail('Top-selling products failed: limit must be 10, 25, 50, or 100.', sql, 0);
    }
    const { body, ms } = await request('GET', `/api/reports/top-products?limit=${limit}`, sql);
    const rows = expectArray(body, 'Top-selling products', sql, ms);
    return reportTable(
      'Top-selling products',
      [
        { key: 'sku', label: 'sku' },
        { key: 'product_name', label: 'product_name' },
        { key: 'category', label: 'category' },
        { key: 'units_sold', label: 'units_sold', align: 'right', format: 'number' },
        { key: 'lbs_sold', label: 'lbs_sold', align: 'right', format: 'number' },
        { key: 'revenue', label: 'revenue', align: 'right', format: 'money' }
      ],
      rows,
      'No products have been sold yet.',
      sql,
      ms
    );
  }

  async function taxByState() {
    const sql = [
      'GET /api/reports/tax-by-state',
      TAX_BY_STATE_SQL
    ].join('\n');
    const { body, ms } = await request('GET', '/api/reports/tax-by-state', sql);
    const rows = expectArray(body, 'Tax by state', sql, ms);
    return reportTable(
      'Tax collected per state',
      [
        { key: 'state', label: 'state' },
        { key: 'tax_rate', label: 'tax_rate', align: 'right', format: 'percent' },
        { key: 'num_receipts', label: 'num_receipts', align: 'right', format: 'number' },
        { key: 'subtotal', label: 'subtotal', align: 'right', format: 'money' },
        { key: 'tax_collected', label: 'tax_collected', align: 'right', format: 'money' }
      ],
      rows,
      'No state tax totals were returned.',
      sql,
      ms
    );
  }

  async function salesByState() {
    const sql = [
      'GET /api/reports/sales-by-state',
      SALES_BY_STATE_SQL
    ].join('\n');
    const { body, ms } = await request('GET', '/api/reports/sales-by-state', sql);
    const rows = expectArray(body, 'Sales by state', sql, ms);
    return reportTable(
      'Sales total per state',
      [
        { key: 'state', label: 'state' },
        { key: 'num_receipts', label: 'num_receipts', align: 'right', format: 'number' },
        { key: 'total_sales', label: 'total_sales', align: 'right', format: 'money' }
      ],
      rows,
      'No state sales totals were returned.',
      sql,
      ms
    );
  }

  async function lowStock() {
    const sql = [
      'GET /api/reports/low-stock',
      LOW_STOCK_SQL
    ].join('\n');
    const { body, ms } = await request('GET', '/api/reports/low-stock', sql);
    const rows = expectArray(body, 'Low stock', sql, ms);
    return reportTable(
      'Low-stock items',
      [
        { key: 'state', label: 'state' },
        { key: 'store_id', label: 'store_id', align: 'right' },
        { key: 'store_name', label: 'store_name' },
        { key: 'sku', label: 'sku' },
        { key: 'product_name', label: 'product_name' },
        { key: 'available_quantity', label: 'available_quantity', align: 'right', format: 'number' },
        { key: 'unit_of_measure', label: 'unit_of_measure' }
      ],
      rows,
      'No items have available quantity under 10.',
      sql,
      ms
    );
  }

  async function paymentsByMethod() {
    const sql = [
      'GET /api/reports/payments-by-method',
      PAYMENTS_BY_METHOD_SQL
    ].join('\n');
    const { body, ms } = await request('GET', '/api/reports/payments-by-method', sql);
    const rows = expectArray(body, 'Payments by method', sql, ms);
    return reportTable(
      'Payments by method',
      [
        { key: 'payment_method', label: 'payment_method' },
        { key: 'payment_status', label: 'payment_status' },
        { key: 'num_payments', label: 'num_payments', align: 'right', format: 'number' },
        { key: 'total_amount', label: 'total_amount', align: 'right', format: 'money' }
      ],
      rows,
      'No payments have been recorded.',
      sql,
      ms
    );
  }

  async function runReport(reportId, params) {
    if (reportId === 'receipt-lookup') return lookupReceipt(params || {});
    const reports = {
      'sales-by-store': salesByStore,
      'top-products': topProducts,
      'tax-by-state': taxByState,
      'sales-by-state': salesByState,
      'low-stock': lowStock,
      'payments-by-method': paymentsByMethod
    };
    const run = reports[reportId];
    if (!run) {
      pending(`Report "${reportId}" is not available. Nothing was queried.`);
    }
    return run(params || {});
  }

  async function lookupReceipt(params) {
    const receiptId = Number(params && params.receipt_id);
    const sql = [
      `GET /api/receipts/${Number.isInteger(receiptId) ? receiptId : ''}`,
      'SELECT * FROM supermarkets.receipt WHERE receipt_id = $1;',
      '-- Line items and payment are not requested. No endpoint returns them yet.'
    ].join('\n');
    if (!Number.isInteger(receiptId) || receiptId <= 0) {
      throw fail('Receipt lookup failed: enter a receipt ID that is a positive whole number.', sql, 0);
    }
    const { body, ms } = await request('GET', `/api/receipts/${receiptId}`, sql);
    if (!body || Array.isArray(body) || body.receipt_id == null) {
      throw fail('Receipt lookup returned an unexpected response.', sql, ms);
    }
    const row = coerceRow(body);
    if (typeof row.receipt_date === 'string' && row.receipt_date.length >= 10) {
      row.receipt_date = row.receipt_date.slice(0, 10);
    }
    return {
      data: {
        title: `Receipt ${receiptId}`,
        notice: 'Header only. Line items and payment are waiting on backend endpoints.',
        columns: [
          { key: 'receipt_id', label: 'Receipt ID', align: 'right' },
          { key: 'store_id', label: 'Store ID', align: 'right' },
          { key: 'receipt_date', label: 'Date' },
          { key: 'receipt_time', label: 'Time' },
          { key: 'subtotal', label: 'Subtotal', align: 'right', format: 'money' },
          { key: 'tax_amount', label: 'Tax', align: 'right', format: 'money' },
          { key: 'total_amount', label: 'Total', align: 'right', format: 'money' }
        ],
        rows: [row]
      },
      sql,
      ms
    };
  }

  async function browseTable(tableName, limit) {
    const apiName = TABLE_API[tableName];
    const n = Number(limit);
    const schema = apiName ? TABLE_SCHEMA[apiName] : '';
    const sql = apiName
      ? `GET /api/tables/${apiName}?limit=${n}\nSELECT * FROM ${schema}.${apiName} LIMIT ${n};`
      : `GET /api/tables/${tableName}`;
    if (!apiName) {
      throw fail(`Browse failed: "${tableName}" is not a table this backend allows.`, sql, 0);
    }
    if (!LIMITS.includes(n)) {
      throw fail('Browse failed: limit must be 10, 25, 50, or 100.', sql, 0);
    }
    const { body, ms } = await request('GET', `/api/tables/${apiName}?limit=${n}`, sql);
    const rows = expectArray(body, 'Browse', sql, ms).map(coerceRow);
    return {
      data: {
        table: tableName,
        columns: columnsFor(rows),
        rows
      },
      sql,
      ms
    };
  }

  async function getRowCounts() {
    return {
      data: {
        counts: [],
        pending: true,
        message: 'Row counts are waiting on a backend endpoint. Browsing a page of rows is not a count.'
      },
      sql: '',
      ms: 0
    };
  }

  async function createTables() {
    const sql = [
      'POST /api/create-tables',
      '-- Server reads sql/schema.sql and runs it in one transaction.'
    ].join('\n');
    const { body, ms } = await request('POST', '/api/create-tables', sql);
    const payload = expectMessage(body, 'Create tables', sql, ms);
    return {
      data: { status: payload.status, message: payload.message },
      sql,
      ms
    };
  }

  async function initLookupTables() {
    const sql = [
      'POST /api/initialize',
      '-- Server reads sql/seed.sql and runs it in one transaction.',
      '-- Existing primary keys are not replaced. A duplicate key rolls this run back.'
    ].join('\n');
    const { body, ms } = await request('POST', '/api/initialize', sql);
    const payload = expectMessage(body, 'Initialize', sql, ms);
    return {
      data: { status: payload.status, message: payload.message },
      sql,
      ms
    };
  }

  async function resetTransactionTables() {
    pending('Reset transaction tables is not connected to PostgreSQL yet. Nothing was deleted.');
  }

  async function deleteAllRows(tableName) {
    const apiName = TABLE_API[tableName];
    const schema = apiName ? TABLE_SCHEMA[apiName] : '';
    const sql = apiName
      ? `DELETE /api/tables/${apiName}\nDELETE FROM ${schema}.${apiName};`
      : `DELETE /api/tables/${tableName}`;
    if (!apiName) {
      throw fail(`Delete failed: "${tableName}" is not a table this backend allows.`, sql, 0);
    }
    const { body, ms } = await request('DELETE', `/api/tables/${apiName}`, sql);
    const payload = expectMessage(body, 'Delete', sql, ms);
    return {
      data: {
        table: tableName,
        status: payload.status,
        message: payload.message
      },
      sql,
      ms
    };
  }

  async function runSimulation() {
    pending('Simulation is not connected to PostgreSQL yet. No rows were written.');
  }

  async function getRecentActivity() {
    pending('Recent activity is not connected to PostgreSQL yet. Nothing was queried.');
  }

  return {
    health,
    getStores,
    getProducts,
    getInventory,
    getBankAccounts,
    checkout,
    runReport,
    browseTable,
    getRowCounts,
    createTables,
    initLookupTables,
    resetTransactionTables,
    deleteAllRows,
    runSimulation,
    getRecentActivity
  };
})();

globalThis.API = API;
