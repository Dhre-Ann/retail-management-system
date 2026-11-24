/**
 * api.js — the only door to the backend.
 *
 * Screens call the functions at the bottom of this file. Each call returns
 * { data, sql, ms } or throws an Error with .sql and .ms. The sql string is
 * the HTTP request plus the statement the Express route runs, when that
 * statement is the same on every call. It is recorded in the "SQL Sent to
 * Server" panel. Checkout and simulation display the statement text the
 * server captured while the transaction ran. Placeholders stay in the text.
 * Bound values are not shown.
 *
 * Features that do not have a route yet throw instead of inventing rows.
 * Nothing in this file writes to the database except the functions that call
 * the existing create, seed, reset, delete, checkout, and simulation routes.
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

  async function request(method, path, sql, payload, signal) {
    const started = performance.now();
    const headers = { Accept: 'application/json' };
    const options = { method, headers };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    if (signal) options.signal = signal;
    let response;
    try {
      response = await fetch(BASE + path, options);
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      if (err && err.name === 'AbortError') {
        const aborted = fail(
          'The page stopped waiting. The server can still finish this simulation.',
          sql,
          ms
        );
        aborted.name = 'AbortError';
        throw aborted;
      }
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
      const error = fail(message, sql, ms);
      if (body && Array.isArray(body.sql_statements)) {
        error.sqlStatements = body.sql_statements;
      }
      if (body && body.representative_sql && typeof body.representative_sql === 'object') {
        error.representativeSql = body.representative_sql;
      }
      throw error;
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

  function dedentSql(sql) {
    const lines = String(sql).replace(/\r\n/g, '\n').trim().split('\n');
    const indents = lines.slice(1)
      .filter((line) => line.trim())
      .map((line) => {
        const match = line.match(/^[ ]*/);
        return match ? match[0].length : 0;
      });
    const margin = indents.length ? Math.min(...indents) : 0;
    return lines.map((line, index) => (
      index === 0 ? line.trimEnd() : line.slice(margin).trimEnd()
    )).join('\n').trim();
  }

  function formatStatements(statements) {
    if (!Array.isArray(statements)) return '';
    return statements
      .filter((statement) => typeof statement === 'string' && statement.trim())
      .map((statement) => {
        const text = dedentSql(statement);
        return text.endsWith(';') ? text : `${text};`;
      })
      .join('\n\n');
  }

  function checkoutDisplay(statements) {
    const lines = ['POST /api/checkout'];
    if (Array.isArray(statements) && statements.length === 0) {
      lines.push('-- No SQL was sent to PostgreSQL.');
      return lines.join('\n');
    }
    const formatted = formatStatements(statements);
    if (!formatted) {
      lines.push('-- The server did not return checkout SQL for this request.');
      return lines.join('\n');
    }
    lines.push('');
    lines.push(formatted);
    return lines.join('\n');
  }

  async function checkout(payload) {
    const pendingSql = checkoutDisplay(undefined);
    try {
      const { body, ms } = await request('POST', '/api/checkout', pendingSql, payload);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.saved !== 'boolean') {
        const unexpected = fail(
          'Checkout returned an unexpected response.',
          checkoutDisplay(body && body.sql_statements),
          ms
        );
        unexpected.sqlStatements = body && Array.isArray(body.sql_statements) ? body.sql_statements : undefined;
        throw unexpected;
      }
      return { data: body, sql: checkoutDisplay(body.sql_statements), ms };
    } catch (err) {
      if (err && Array.isArray(err.sqlStatements)) {
        err.sql = checkoutDisplay(err.sqlStatements);
      }
      throw err;
    }
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
    '    AND ((r.receipt_date + r.receipt_time) AT TIME ZONE current_setting(\'TIMEZONE\'))',
    '        >= ($1::timestamp AT TIME ZONE $3)',
    '    AND ((r.receipt_date + r.receipt_time) AT TIME ZONE current_setting(\'TIMEZONE\'))',
    '        < (($2::date + INTERVAL \'1 day\') AT TIME ZONE $3)',
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
    '    p.payment_method,',
    '    p.payment_status,',
    '    COUNT(*) AS num_payments,',
    '    COALESCE(SUM(p.amount), 0) AS total_amount',
    'FROM supermarkets.payment p',
    'JOIN supermarkets.receipt r',
    '    ON r.receipt_id = p.receipt_id',
    'GROUP BY p.payment_method, p.payment_status',
    'ORDER BY p.payment_method, p.payment_status;'
  ].join('\n');

  function isoDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function reportTimeZone() {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (typeof zone === 'string' && /^[A-Za-z0-9_+\-/]+$/.test(zone)) return zone;
    } catch (err) {
      // Date inputs are still local calendar days if the zone name is unavailable.
    }
    return 'UTC';
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
    const zone = reportTimeZone();
    const sql = [
      `GET /api/reports/sales-by-store?start_date=${isoDate(start) ? start : ''}&end_date=${isoDate(end) ? end : ''}&time_zone=${zone}`,
      SALES_BY_STORE_SQL,
      `-- $1 = ${isoDate(start) ? start : 'invalid'}`,
      `-- $2 = ${isoDate(end) ? end : 'invalid'}`,
      `-- $3 = ${zone}`
    ].join('\n');
    if (!isoDate(start) || !isoDate(end)) {
      throw fail('Sales by store failed: choose both a start date and an end date.', sql, 0);
    }
    if (start > end) {
      throw fail('Sales by store failed: the start date is after the end date.', sql, 0);
    }
    const path = `/api/reports/sales-by-store?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}&time_zone=${encodeURIComponent(zone)}`;
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
    const rows = expectArray(body, 'Recorded payments by method', sql, ms);
    return reportTable(
      'Recorded payments by method',
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
      '-- Inserts use ON CONFLICT DO NOTHING, so existing rows are left unchanged.'
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
    const sql = [
      'POST /api/reset-transactions',
      'BEGIN;',
      'DELETE FROM supermarkets.receiptitem;',
      'DELETE FROM supermarkets.payment;',
      'DELETE FROM supermarkets.receipt;',
      '-- Restore supermarkets.inventory.available_quantity from the seed SELECT.',
      '-- Restore banking.bankaccount.account_balance from the seed VALUES.',
      'COMMIT;'
    ].join('\n');
    const { body, ms } = await request('POST', '/api/reset-transactions', sql);
    const payload = expectMessage(body, 'Reset', sql, ms);
    return {
      data: { status: payload.status, message: payload.message },
      sql,
      ms
    };
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

  function optionalNumber(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function appendRepresentativeTrace(lines, representative) {
    const statements = representative && Array.isArray(representative.statements)
      ? representative.statements
      : null;
    if (!statements) {
      lines.push('-- No checkout transaction SQL was captured for this run.');
      return;
    }
    const formatted = formatStatements(statements);
    if (!formatted) {
      lines.push('-- No checkout transaction SQL was captured for this run.');
      return;
    }
    lines.push('-- Representative transaction trace.');
    const number = Number(representative.transaction_number);
    const outcome = typeof representative.outcome === 'string' && representative.outcome
      ? representative.outcome
      : '';
    const where = Number.isInteger(number)
      ? `transaction ${number}${outcome ? `, ${outcome}` : ''}`
      : 'one checkout';
    lines.push(`-- Statements below are from ${where}, in execution order.`);
    lines.push('-- Other checkouts in this simulation are not listed.');
    lines.push('');
    lines.push(formatted);
  }

  function simulationSql(payload, representative) {
    const lines = ['POST /api/simulate'];
    lines.push('-- Request body:');
    JSON.stringify(payload, null, 2).split('\n').forEach((line) => {
      lines.push(`-- ${line}`);
    });
    lines.push('-- The server first runs sql/schema.sql and sql/seed.sql in one transaction.');
    lines.push('-- CREATE TABLE IF NOT EXISTS and ON CONFLICT DO NOTHING add only');
    lines.push('-- missing tables and reference rows. Receipts, inventory quantities,');
    lines.push('-- and bank balances are left unchanged.');
    lines.push('-- Checkouts start only after that transaction commits.');
    lines.push('-- Each checkout goes through the existing checkout service.');
    lines.push('-- Stop sends POST /api/simulate/<run_id>/cancel. No new checkouts start');
    lines.push('-- after that; checkouts already in a transaction commit or roll back.');
    lines.push('');
    appendRepresentativeTrace(lines, representative);
    return lines.join('\n');
  }

  const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

  function simulationTransaction(row) {
    const source = row && typeof row === 'object' ? row : {};
    return {
      transaction_number: optionalNumber(source.transaction_number),
      store_id: optionalNumber(source.store_id),
      payment_method: source.payment_method == null ? null : String(source.payment_method),
      selection_count: optionalNumber(source.selection_count),
      status: source.status == null ? '' : String(source.status),
      receipt_id: optionalNumber(source.receipt_id),
      total: optionalNumber(source.total),
      execution_ms: optionalNumber(source.execution_ms),
      message: source.message == null ? null : String(source.message)
    };
  }

  function deriveFailureReasons(transactions) {
    const counts = new Map();
    transactions.forEach((tx) => {
      if (tx.status !== 'failed') return;
      const message = tx.message || 'Checkout failed';
      counts.set(message, (counts.get(message) || 0) + 1);
    });
    return Array.from(counts, ([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
  }

  function normalizeFailureReasons(value) {
    if (!Array.isArray(value)) return null;
    const reasons = [];
    value.forEach((row) => {
      if (!row || typeof row !== 'object') return;
      const message = row.message == null ? '' : String(row.message);
      const count = Number(row.count);
      if (!message || !Number.isInteger(count) || count < 1) return;
      reasons.push({ message, count });
    });
    return reasons;
  }

  function simulationResult(body, sql, ms) {
    const summary = body && body.summary;
    const transactions = body && body.transactions;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary) || !Array.isArray(transactions)) {
      throw fail('Simulation returned an unexpected response.', sql, ms);
    }
    const normalized = {
      requested: optionalNumber(summary.requested),
      attempted: optionalNumber(summary.attempted),
      completed: optionalNumber(summary.completed),
      approved: optionalNumber(summary.approved),
      declined: optionalNumber(summary.declined),
      failed: optionalNumber(summary.failed),
      cancelled: optionalNumber(summary.cancelled),
      total_sales: optionalNumber(summary.total_sales),
      average_ms: optionalNumber(summary.average_ms),
      min_ms: optionalNumber(summary.min_ms),
      max_ms: optionalNumber(summary.max_ms),
      total_elapsed_ms: optionalNumber(summary.total_elapsed_ms)
    };
    if (Object.keys(normalized).some((key) => normalized[key] == null)) {
      throw fail('Simulation returned an unexpected summary.', sql, ms);
    }
    const mapped = transactions
      .filter((row) => row && typeof row === 'object')
      .map(simulationTransaction);
    normalized.failure_reasons = normalizeFailureReasons(summary.failure_reasons)
      || deriveFailureReasons(mapped);
    normalized.stop_requested = summary.stop_requested === true;
    return {
      run_id: body.run_id == null ? null : String(body.run_id),
      summary: normalized,
      transactions: mapped
    };
  }

  async function runSimulation(options, signal) {
    const transactionCount = Number(options && options.transaction_count);
    const storeCount = Number(options && options.store_count);
    const concurrency = Number(options && options.concurrency);
    const payload = {
      transaction_count: transactionCount,
      store_count: storeCount,
      concurrency
    };
    if (options && options.run_id != null) payload.run_id = String(options.run_id);
    const sql = simulationSql(payload, null);
    if (payload.run_id != null && !RUN_ID_PATTERN.test(payload.run_id)) {
      throw fail('Simulation did not start: run_id must be 8 to 64 letters, digits, hyphens, or underscores.', sql, 0);
    }
    if (!Number.isInteger(transactionCount) || transactionCount < 1 || transactionCount > 100) {
      throw fail('Simulation did not start: transaction_count must be an integer from 1 to 100.', sql, 0);
    }
    if (!Number.isInteger(storeCount) || storeCount < 1) {
      throw fail('Simulation did not start: store_count must be an integer of at least 1.', sql, 0);
    }
    if (storeCount > transactionCount) {
      throw fail('Simulation did not start: store_count cannot be greater than transaction_count. Each transaction is one store purchase.', sql, 0);
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
      throw fail('Simulation did not start: concurrency must be an integer from 1 to 10.', sql, 0);
    }
    if (concurrency > transactionCount) {
      throw fail('Simulation did not start: concurrency cannot be greater than transaction_count.', sql, 0);
    }
    try {
      const { body, ms } = await request('POST', '/api/simulate', sql, payload, signal);
      const display = simulationSql(payload, body && body.representative_sql);
      return { data: simulationResult(body, display, ms), sql: display, ms };
    } catch (err) {
      if (err && err.representativeSql) {
        err.sql = simulationSql(payload, err.representativeSql);
      }
      throw err;
    }
  }

  async function cancelSimulation(runId) {
    const id = runId == null ? '' : String(runId);
    const sql = [
      `POST /api/simulate/${id}/cancel`,
      '-- No SQL runs. The server stops starting new checkouts for this run.',
      '-- Checkouts already inside a transaction commit or roll back as usual.',
      '-- Committed receipts are not deleted.'
    ].join('\n');
    if (!RUN_ID_PATTERN.test(id)) {
      throw fail('Stop failed: this simulation does not have a valid run id.', sql, 0);
    }
    const { body, ms } = await request('POST', `/api/simulate/${encodeURIComponent(id)}/cancel`, sql);
    const payload = expectMessage(body, 'Stop', sql, ms);
    return {
      data: {
        state: payload.state == null ? '' : String(payload.state),
        message: payload.message
      },
      sql,
      ms
    };
  }

  const RECEIPT_INTERVALS = {
    '5min': '5 minutes',
    '15min': '15 minutes',
    '1hour': '1 hour',
    '24hour': '24 hours'
  };

  function recentReceipt(row) {
    const source = row && typeof row === 'object' ? row : {};
    return {
      receipt_id: optionalNumber(source.receipt_id),
      store_id: optionalNumber(source.store_id),
      store_name: source.store_name == null ? null : String(source.store_name),
      receipt_date: source.receipt_date == null ? null : String(source.receipt_date),
      receipt_time: source.receipt_time == null ? null : String(source.receipt_time),
      subtotal: optionalNumber(source.subtotal),
      tax_amount: optionalNumber(source.tax_amount),
      total_amount: optionalNumber(source.total_amount),
      payment_method: source.payment_method == null ? null : String(source.payment_method),
      payment_status: source.payment_status == null ? null : String(source.payment_status)
    };
  }

  function recentReceiptsResult(body, sql, ms) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.rows) || typeof body.label !== 'string') {
      throw fail('Recent receipts returned an unexpected response.', sql, ms);
    }
    return {
      interval: body.interval == null ? '' : String(body.interval),
      label: body.label,
      truncated: Boolean(body.truncated),
      rows: body.rows
        .filter((row) => row && typeof row === 'object')
        .map(recentReceipt)
    };
  }

  async function getRecentReceipts(interval) {
    const label = RECEIPT_INTERVALS[interval];
    const sql = [
      `GET /api/simulate/receipts?interval=${interval || ''}`,
      'SELECT r.receipt_id, r.store_id, s.store_name,',
      "       to_char(r.receipt_date, 'YYYY-MM-DD') AS receipt_date,",
      "       to_char(r.receipt_time, 'HH24:MI:SS') AS receipt_time,",
      '       r.subtotal, r.tax_amount, r.total_amount,',
      '       p.payment_method, p.payment_status',
      'FROM supermarkets.receipt r',
      'JOIN supermarkets.store s ON s.store_id = r.store_id',
      'LEFT JOIN supermarkets.payment p ON p.receipt_id = r.receipt_id',
      'WHERE (r.receipt_date + r.receipt_time) >= LOCALTIMESTAMP - $1::interval',
      'ORDER BY r.receipt_date DESC, r.receipt_time DESC, r.receipt_id DESC',
      'LIMIT $2;',
      label ? `-- $1 = '${label}'` : '-- interval was not one of the four presets'
    ].join('\n');
    if (!label) {
      throw fail('Recent receipts failed before the server call: choose the last 5 minutes, 15 minutes, 1 hour, or 24 hours.', sql, 0);
    }
    const { body, ms } = await request(
      'GET',
      `/api/simulate/receipts?interval=${encodeURIComponent(interval)}`,
      sql
    );
    return { data: recentReceiptsResult(body, sql, ms), sql, ms };
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
    cancelSimulation,
    getRecentReceipts
  };
})();

globalThis.API = API;
