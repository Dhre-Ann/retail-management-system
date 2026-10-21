/**
 * api.js — the only door to the backend.
 *
 * The rest of the UI calls the functions at the bottom of this file and nothing else.
 * Each one is an async stub. It waits a short time, then returns:
 *
 *   { data, sql, ms }
 *
 *   data  the rows or the receipt the screen should show
 *   sql   the statement text to append to the "SQL Sent to Server" panel
 *   ms    how long the stub took, in milliseconds
 *
 * TODO: replace with real backend call
 * is written on every public function. When the server exists, change the body
 * of that function to a fetch() and keep the same name and the same return shape.
 * app.js should not need to change.
 *
 * Nothing in this file is executed against a database. The SQL strings are text
 * for the log. The "database" is a few arrays in memory, so the screens can be
 * clicked through before the real schema is wired up.
 *
 * Extra mock fields (not final columns yet):
 *   Store.store_name, Store.tax_rate
 *   Product.sold_by_weight, Product.base_price, Product.prices_by_state
 * Prices stand in for the planned StateProductPrice table.
 */
'use strict';

const API = (function () {
  // Sample combined rates for the course project. Not tax advice.
  const TAX_RATES = {
    TX: 0.0825,
    GA: 0.089,
    NY: 0.08875,
    CO: 0.0881
  };

  // Stand-in for StateProductPrice. 1.00 means "use base_price".
  const PRICE_FACTORS = {
    TX: 1,
    GA: 0.98,
    NY: 1.06,
    CO: 1.04
  };

  const TABLE_NAMES = [
    'Store',
    'Product',
    'Inventory',
    'Receipt',
    'ReceiptItem',
    'Payment',
    'BankAccount'
  ];

  const LOOKUP_TABLES = ['Store', 'Product', 'Inventory', 'BankAccount'];
  const TX_TABLES = ['Receipt', 'ReceiptItem', 'Payment'];

  const SEED_STORES = [
    { store_id: 1, store_name: 'FreshMart Downtown Houston', address: '1200 Main St, Houston, TX 77002', state: 'TX' },
    { store_id: 2, store_name: 'FreshMart Austin Riverside', address: '450 S Congress Ave, Austin, TX 78704', state: 'TX' },
    { store_id: 3, store_name: 'FreshMart Midtown Atlanta', address: '800 Peachtree St NE, Atlanta, GA 30308', state: 'GA' },
    { store_id: 4, store_name: 'FreshMart Brooklyn Heights', address: '90 Montague St, Brooklyn, NY 11201', state: 'NY' },
    { store_id: 5, store_name: 'FreshMart Denver Highlands', address: '3400 Tejon St, Denver, CO 80211', state: 'CO' }
  ];

  // sold_by_weight and base_price are mock-only until the schema catches up.
  const SEED_PRODUCTS = [
    { sku: 'BAN-001', product_name: 'Bananas', category: 'Produce', tax_treatment: 'exempt', sold_by_weight: true, base_price: 0.69 },
    { sku: 'APL-014', product_name: 'Gala Apples', category: 'Produce', tax_treatment: 'exempt', sold_by_weight: true, base_price: 1.59 },
    { sku: 'ROM-003', product_name: 'Romaine Lettuce', category: 'Produce', tax_treatment: 'exempt', sold_by_weight: true, base_price: 1.89 },
    { sku: 'TOM-008', product_name: 'Vine Tomatoes', category: 'Produce', tax_treatment: 'exempt', sold_by_weight: true, base_price: 2.29 },
    { sku: 'MLK-101', product_name: 'Whole Milk, 1 gal', category: 'Dairy', tax_treatment: 'exempt', sold_by_weight: false, base_price: 3.49 },
    { sku: 'EGG-102', product_name: 'Large Eggs, dozen', category: 'Dairy', tax_treatment: 'exempt', sold_by_weight: false, base_price: 4.19 },
    { sku: 'BRD-210', product_name: 'Whole Wheat Bread', category: 'Bakery', tax_treatment: 'exempt', sold_by_weight: false, base_price: 2.99 },
    { sku: 'CHK-301', product_name: 'Chicken Breast', category: 'Meat', tax_treatment: 'exempt', sold_by_weight: false, base_price: 6.49 },
    { sku: 'BEE-302', product_name: 'Ground Beef 80/20, 1 lb', category: 'Meat', tax_treatment: 'exempt', sold_by_weight: false, base_price: 5.99 },
    { sku: 'BAC-303', product_name: 'Smoked Bacon, 12 oz', category: 'Meat', tax_treatment: 'exempt', sold_by_weight: false, base_price: 6.79 },
    { sku: 'COL-401', product_name: 'Cola, 12 pack', category: 'Beverages', tax_treatment: 'taxable', sold_by_weight: false, base_price: 7.49 },
    { sku: 'CHP-402', product_name: 'Kettle Potato Chips', category: 'Snacks', tax_treatment: 'taxable', sold_by_weight: false, base_price: 3.99 },
    { sku: 'DEL-403', product_name: 'Rotisserie Chicken', category: 'Deli', tax_treatment: 'taxable', sold_by_weight: false, base_price: 8.99 },
    { sku: 'HHD-501', product_name: 'Dish Soap, 18 oz', category: 'Household', tax_treatment: 'taxable', sold_by_weight: false, base_price: 2.79 },
    { sku: 'HHD-502', product_name: 'Paper Towels, 6 rolls', category: 'Household', tax_treatment: 'taxable', sold_by_weight: false, base_price: 8.49 }
  ];

  const SEED_ACCOUNTS = [
    { account_id: 1, account_holder_name: 'Maria Chen', account_number: '1000004521', account_balance: 250 },
    { account_id: 2, account_holder_name: 'James Okonkwo', account_number: '1000008834', account_balance: 12.5 },
    { account_id: 3, account_holder_name: 'Priya Shah', account_number: '1000002290', account_balance: 1500 },
    { account_id: 4, account_holder_name: 'Luis Garcia', account_number: '1000006712', account_balance: 64.2 },
    { account_id: 5, account_holder_name: 'Ava Nguyen', account_number: '1000001188', account_balance: 430 }
  ];

  // A few items start low so the low-stock report has something to show.
  // Key is "store_id|sku". Anything missing gets a normal on-hand amount.
  const LOW_STOCK = {
    '1|HHD-502': 3,
    '1|HHD-501': 4,
    '2|BEE-302': 2,
    '2|CHP-402': 5,
    '3|DEL-403': 1,
    '3|BAC-303': 6,
    '4|MLK-101': 4,
    '5|EGG-102': 3,
    '5|BRD-210': 8
  };

  const AISLE_BY_CATEGORY = {
    Produce: 1,
    Dairy: 2,
    Bakery: 3,
    Meat: 4,
    Beverages: 5,
    Snacks: 6,
    Deli: 7,
    Household: 8
  };

  // Sample sales applied once at startup so reports and "recent activity" are not empty.
  // minutesAgo is relative to the moment the page loads.
  const HISTORY = [
    { minutesAgo: 2, store_id: 1, payment_method: 'cash', account_id: null, items: [
      { sku: 'BAN-001', weight: 2 },
      { sku: 'MLK-101', quantity: 1 },
      { sku: 'BRD-210', quantity: 1 }
    ]},
    { minutesAgo: 4, store_id: 3, payment_method: 'card', account_id: 1, items: [
      { sku: 'COL-401', quantity: 1 },
      { sku: 'CHP-402', quantity: 1 }
    ]},
    { minutesAgo: 8, store_id: 4, payment_method: 'card', account_id: 2, items: [
      { sku: 'DEL-403', quantity: 1 },
      { sku: 'COL-401', quantity: 1 }
    ]},
    { minutesAgo: 20, store_id: 2, payment_method: 'cash', account_id: null, items: [
      { sku: 'EGG-102', quantity: 1 },
      { sku: 'CHK-301', quantity: 1 },
      { sku: 'APL-014', weight: 1.25 }
    ]},
    { minutesAgo: 40, store_id: 5, payment_method: 'card', account_id: 3, items: [
      { sku: 'DEL-403', quantity: 1 },
      { sku: 'ROM-003', weight: 1 },
      { sku: 'HHD-501', quantity: 2 }
    ]},
    { minutesAgo: 180, store_id: 4, payment_method: 'cash', account_id: null, items: [
      { sku: 'BEE-302', quantity: 1 },
      { sku: 'BAC-303', quantity: 1 },
      { sku: 'TOM-008', weight: 2 }
    ]},
    { minutesAgo: 300, store_id: 1, payment_method: 'card', account_id: 4, items: [
      { sku: 'HHD-502', quantity: 1 },
      { sku: 'HHD-501', quantity: 1 }
    ]},
    { minutesAgo: 60 * 26, store_id: 2, payment_method: 'cash', account_id: null, items: [
      { sku: 'MLK-101', quantity: 2 },
      { sku: 'BRD-210', quantity: 2 },
      { sku: 'BAN-001', weight: 1 }
    ]},
    { minutesAgo: 60 * 30, store_id: 5, payment_method: 'card', account_id: 5, items: [
      { sku: 'COL-401', quantity: 2 },
      { sku: 'CHP-402', quantity: 3 }
    ]}
  ];

  let db = null;

  // ----- money and time ---------------------------------------------------

  function toCents(amount) {
    return Math.round((Number(amount) + Number.EPSILON) * 100);
  }

  function fromCents(cents) {
    return cents / 100;
  }

  function roundQty(amount) {
    return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
  }

  // Line total in cents, then back to dollars. Same formula the register preview uses.
  function lineTotal(unitPrice, amount) {
    return fromCents(Math.round(toCents(unitPrice) * Number(amount)));
  }

  function priceFor(product, state) {
    const factor = PRICE_FACTORS[state] == null ? 1 : PRICE_FACTORS[state];
    return fromCents(Math.round(toCents(product.base_price) * factor));
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function stamp(date) {
    const d = date instanceof Date ? date : new Date();
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      ms: d.getTime()
    };
  }

  function sqlString(value) {
    if (value == null) return 'NULL';
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  function sqlNumber(value) {
    if (value == null || value === '') return 'NULL';
    return String(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function fail(message, sql) {
    const err = new Error(message);
    err.sql = sql || '';
    err.ms = 0;
    return err;
  }

  function abortError() {
    const err = new Error('The operation was cancelled.');
    err.name = 'AbortError';
    return err;
  }

  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(abortError());
        return;
      }
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(timer);
        reject(abortError());
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function timed(sql, produce, signal) {
    const start = performance.now();
    const wait = 80 + Math.round(Math.random() * 90);
    await pause(wait, signal);
    const data = typeof produce === 'function' ? produce() : produce;
    return { data, sql, ms: Math.round(performance.now() - start) };
  }

  // ----- seed -------------------------------------------------------------

  function buildInventory() {
    const rows = [];
    SEED_STORES.forEach((store) => {
      SEED_PRODUCTS.forEach((product) => {
        const key = `${store.store_id}|${product.sku}`;
        let qty = LOW_STOCK[key];
        if (qty == null) {
          qty = product.sold_by_weight ? 40 + store.store_id * 3 : 36 + store.store_id;
        }
        rows.push({
          store_id: store.store_id,
          sku: product.sku,
          available_quantity: qty,
          aisle_number: AISLE_BY_CATEGORY[product.category] || 9
        });
      });
    });
    return rows;
  }

  function emptyDb() {
    return {
      stores: clone(SEED_STORES),
      products: clone(SEED_PRODUCTS),
      inventory: buildInventory(),
      receipts: [],
      receiptItems: [],
      payments: [],
      bankAccounts: clone(SEED_ACCOUNTS),
      activity: [],
      nextReceiptId: 1001,
      nextPaymentId: 5001,
      tablesCreated: true
    };
  }

  function findStore(storeId) {
    return db.stores.find((store) => store.store_id === Number(storeId));
  }

  function findProduct(sku) {
    return db.products.find((product) => product.sku === sku);
  }

  function findInventory(storeId, sku) {
    return db.inventory.find((row) => row.store_id === Number(storeId) && row.sku === sku);
  }

  function findAccount(accountId) {
    return db.bankAccounts.find((account) => account.account_id === Number(accountId));
  }

  function logActivity(whenMs, table, action, record, detail) {
    db.activity.push({
      at_ms: whenMs,
      table,
      action,
      record: record == null ? '' : String(record),
      detail
    });
  }

  function publicStore(store) {
    return {
      store_id: store.store_id,
      store_name: store.store_name,
      address: store.address,
      state: store.state,
      // Not a Store column. Attached so the register can preview tax.
      tax_rate: TAX_RATES[store.state] || 0
    };
  }

  function publicProduct(product) {
    const prices = {};
    Object.keys(TAX_RATES).forEach((state) => {
      prices[state] = priceFor(product, state);
    });
    return {
      sku: product.sku,
      product_name: product.product_name,
      category: product.category,
      tax_treatment: product.tax_treatment,
      sold_by_weight: product.sold_by_weight,
      price: product.base_price,
      prices_by_state: prices
    };
  }

  function publicAccount(account) {
    return {
      account_id: account.account_id,
      account_holder_name: account.account_holder_name,
      account_number: account.account_number,
      account_balance: account.account_balance
    };
  }

  // ----- checkout core ----------------------------------------------------

  /**
   * Reads the cart, checks stock and (for a card) the balance, then writes rows.
   * All writes happen together after the checks, so a failure does not leave
   * a half-saved sale. Declined cards insert a Payment only.
   */
  function applyCheckout(payload, when) {
    const whenStamp = stamp(when || new Date());
    const storeId = Number(payload && payload.store_id);
    const method = payload && payload.payment_method;
    const items = payload && Array.isArray(payload.items) ? payload.items : null;

    if (!items || items.length === 0) {
      throw fail('Checkout failed at the cart step: there are no items to sell.');
    }
    if (method !== 'cash' && method !== 'card') {
      throw fail('Checkout failed at the payment step: method must be cash or card.');
    }

    const store = findStore(storeId);
    if (!store) {
      throw fail(`Checkout failed at the store step: store_id ${payload.store_id} was not found.`);
    }
    const rate = TAX_RATES[store.state] || 0;

    const seen = new Set();
    const lines = [];
    items.forEach((raw, index) => {
      const sku = raw && raw.sku;
      const product = findProduct(sku);
      if (!product) {
        throw fail(`Checkout failed at the product step: SKU ${sku || '(blank)'} was not found in Product.`);
      }
      if (seen.has(sku)) {
        throw fail(`Checkout failed at the cart step: SKU ${sku} is in the cart more than once. Combine those lines and try again.`);
      }
      seen.add(sku);

      const stock = findInventory(store.store_id, sku);
      if (!stock) {
        throw fail(`Checkout failed at the inventory step: SKU ${sku} is not stocked at ${store.store_name}.`);
      }

      let quantity = null;
      let weight = null;
      let amount = 0;
      if (product.sold_by_weight) {
        weight = Number(raw.weight);
        if (!Number.isFinite(weight) || weight <= 0) {
          throw fail(`Checkout failed at the cart step: ${product.product_name} is sold by weight. Enter a weight greater than 0.`);
        }
        weight = roundQty(weight);
        amount = weight;
        if (stock.available_quantity + 1e-9 < weight) {
          throw fail(`Checkout failed at the inventory step: ${product.product_name} (${sku}) has ${stock.available_quantity} lb left at ${store.store_name}, but the cart needs ${weight} lb.`);
        }
      } else {
        quantity = Number(raw.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw fail(`Checkout failed at the cart step: ${product.product_name} (${sku}) quantity must be a positive whole number.`);
        }
        amount = quantity;
        if (stock.available_quantity < quantity) {
          throw fail(`Checkout failed at the inventory step: ${product.product_name} (${sku}) has ${stock.available_quantity} left at ${store.store_name}, but the cart needs ${quantity}.`);
        }
      }

      const unit = priceFor(product, store.state);
      const total = lineTotal(unit, amount);
      lines.push({
        receipt_line_number: index + 1,
        sku,
        product_name: product.product_name,
        tax_treatment: product.tax_treatment,
        quantity,
        weight,
        unit_price: unit,
        line_total: total,
        amount
      });
    });

    let taxableCents = 0;
    let exemptCents = 0;
    lines.forEach((line) => {
      const cents = toCents(line.line_total);
      if (line.tax_treatment === 'taxable') taxableCents += cents;
      else exemptCents += cents;
    });
    const taxCents = Math.round(taxableCents * rate);
    const totalCents = taxableCents + exemptCents + taxCents;
    const totals = {
      subtotal: fromCents(taxableCents + exemptCents),
      taxable: fromCents(taxableCents),
      exempt: fromCents(exemptCents),
      tax: fromCents(taxCents),
      tax_rate: rate,
      total: fromCents(totalCents)
    };

    let account = null;
    if (method === 'card') {
      if (payload.account_id == null || payload.account_id === '') {
        throw fail('Checkout failed at the payment step: a card payment needs a bank account.');
      }
      account = findAccount(payload.account_id);
      if (!account) {
        throw fail(`Checkout failed at the payment step: bank account ${payload.account_id} was not found.`);
      }
    }

    const declined = account && toCents(account.account_balance) < totalCents;
    const paymentId = db.nextPaymentId++;

    if (declined) {
      const payment = {
        payment_id: paymentId,
        receipt_id: null,
        account_id: account.account_id,
        payment_method: 'card',
        payment_date: whenStamp.date,
        payment_time: whenStamp.time,
        payment_status: 'declined',
        payment_amount: totals.total
      };
      db.payments.push(payment);
      logActivity(whenStamp.ms, 'Payment', 'inserted', paymentId, `Declined card for ${account.account_holder_name}, attempted ${totals.total.toFixed(2)}`);

      const sql = [
        'BEGIN;',
        `-- Balance check failed for account_id ${account.account_id}:`,
        `--   balance ${account.account_balance.toFixed(2)} < total ${totals.total.toFixed(2)}`,
        'INSERT INTO Payment (receipt_id, account_id, payment_method, payment_date, payment_time, payment_status)',
        `VALUES (NULL, ${account.account_id}, 'card', ${sqlString(whenStamp.date)}, ${sqlString(whenStamp.time)}, 'declined');`,
        '-- No Receipt, ReceiptItem, Inventory, or BankAccount change.',
        'COMMIT;'
      ].join('\n');

      return {
        sql,
        data: {
          saved: false,
          store: publicStore(store),
          receipt: null,
          items: lines,
          totals,
          payment: {
            payment_id: paymentId,
            receipt_id: null,
            account_id: account.account_id,
            account_holder_name: account.account_holder_name,
            payment_method: 'card',
            payment_date: whenStamp.date,
            payment_time: whenStamp.time,
            payment_status: 'declined',
            account_balance_after: account.account_balance,
            decline_reason: `Insufficient funds. Balance is ${account.account_balance.toFixed(2)} and the total is ${totals.total.toFixed(2)}.`
          }
        }
      };
    }

    const receiptId = db.nextReceiptId++;
    const receipt = {
      receipt_id: receiptId,
      store_id: store.store_id,
      date: whenStamp.date,
      time: whenStamp.time,
      total_amount: totals.total
    };
    db.receipts.push(receipt);
    logActivity(whenStamp.ms, 'Receipt', 'inserted', receiptId, `${store.store_name} total ${totals.total.toFixed(2)}`);

    const itemSql = [];
    lines.forEach((line) => {
      const row = {
        receipt_id: receiptId,
        receipt_line_number: line.receipt_line_number,
        sku: line.sku,
        quantity: line.quantity,
        weight: line.weight,
        unit_price: line.unit_price,
        line_total: line.line_total
      };
      db.receiptItems.push(row);
      logActivity(whenStamp.ms, 'ReceiptItem', 'inserted', `${receiptId}-${line.receipt_line_number}`, `${line.sku} line total ${line.line_total.toFixed(2)}`);

      const stock = findInventory(store.store_id, line.sku);
      const before = stock.available_quantity;
      stock.available_quantity = line.weight == null
        ? before - line.quantity
        : roundQty(before - line.weight);
      logActivity(whenStamp.ms, 'Inventory', 'updated', `${store.store_id}/${line.sku}`, `available_quantity ${before} -> ${stock.available_quantity}`);

      itemSql.push(
        `INSERT INTO ReceiptItem (receipt_id, receipt_line_number, sku, quantity, weight, unit_price, line_total) VALUES (${receiptId}, ${line.receipt_line_number}, ${sqlString(line.sku)}, ${sqlNumber(line.quantity)}, ${sqlNumber(line.weight)}, ${line.unit_price.toFixed(2)}, ${line.line_total.toFixed(2)});`
      );
      itemSql.push(
        `UPDATE Inventory SET available_quantity = ${stock.available_quantity} WHERE store_id = ${store.store_id} AND sku = ${sqlString(line.sku)};`
      );
    });

    const payment = {
      payment_id: paymentId,
      receipt_id: receiptId,
      account_id: account ? account.account_id : null,
      payment_method: method,
      payment_date: whenStamp.date,
      payment_time: whenStamp.time,
      payment_status: 'approved',
      payment_amount: totals.total
    };
    db.payments.push(payment);
    logActivity(whenStamp.ms, 'Payment', 'inserted', paymentId, `${method} approved for receipt ${receiptId}`);

    let balanceAfter = null;
    const bankSql = [];
    if (account) {
      const before = account.account_balance;
      account.account_balance = fromCents(toCents(before) - totalCents);
      balanceAfter = account.account_balance;
      logActivity(whenStamp.ms, 'BankAccount', 'updated', account.account_id, `account_balance ${before.toFixed(2)} -> ${balanceAfter.toFixed(2)}`);
      bankSql.push(`UPDATE BankAccount SET account_balance = ${balanceAfter.toFixed(2)} WHERE account_id = ${account.account_id};`);
    }

    const sql = [
      'BEGIN;',
      `INSERT INTO Receipt (store_id, date, time, total_amount) VALUES (${store.store_id}, ${sqlString(whenStamp.date)}, ${sqlString(whenStamp.time)}, ${totals.total.toFixed(2)}) RETURNING receipt_id;`,
      `-- receipt_id = ${receiptId}`,
      ...itemSql,
      `INSERT INTO Payment (receipt_id, account_id, payment_method, payment_date, payment_time, payment_status) VALUES (${receiptId}, ${sqlNumber(account ? account.account_id : null)}, ${sqlString(method)}, ${sqlString(whenStamp.date)}, ${sqlString(whenStamp.time)}, 'approved');`,
      ...bankSql,
      'COMMIT;'
    ].join('\n');

    return {
      sql,
      data: {
        saved: true,
        store: publicStore(store),
        receipt,
        items: lines,
        totals,
        payment: {
          payment_id: paymentId,
          receipt_id: receiptId,
          account_id: account ? account.account_id : null,
          account_holder_name: account ? account.account_holder_name : null,
          payment_method: method,
          payment_date: whenStamp.date,
          payment_time: whenStamp.time,
          payment_status: 'approved',
          account_balance_after: balanceAfter,
          decline_reason: null
        }
      }
    };
  }

  function applyHistory() {
    HISTORY.forEach((sample, index) => {
      const when = new Date(Date.now() - sample.minutesAgo * 60 * 1000);
      try {
        applyCheckout({
          store_id: sample.store_id,
          payment_method: sample.payment_method,
          account_id: sample.account_id,
          items: sample.items
        }, when);
      } catch (err) {
        throw new Error(`Sample sale ${index + 1} failed: ${err.message}`);
      }
    });
  }

  function receiptInRange(receipt, startDate, endDate) {
    if (startDate && receipt.date < startDate) return false;
    if (endDate && receipt.date > endDate) return false;
    return true;
  }

  function requireDates(params) {
    const start = params && params.start_date ? String(params.start_date) : '';
    const end = params && params.end_date ? String(params.end_date) : '';
    if (!start || !end) {
      throw fail('Report failed before it ran: choose both a start date and an end date.');
    }
    if (start > end) {
      throw fail('Report failed before it ran: the start date is after the end date.');
    }
    return { start, end };
  }

  function itemsForReceipt(receiptId) {
    return db.receiptItems
      .filter((row) => row.receipt_id === receiptId)
      .sort((a, b) => a.receipt_line_number - b.receipt_line_number);
  }

  function taxForReceipt(receipt) {
    const store = findStore(receipt.store_id);
    const rate = store ? (TAX_RATES[store.state] || 0) : 0;
    let taxableCents = 0;
    let exemptCents = 0;
    itemsForReceipt(receipt.receipt_id).forEach((item) => {
      const product = findProduct(item.sku);
      const cents = toCents(item.line_total);
      if (product && product.tax_treatment === 'taxable') taxableCents += cents;
      else exemptCents += cents;
    });
    return {
      taxable: fromCents(taxableCents),
      exempt: fromCents(exemptCents),
      tax: fromCents(Math.round(taxableCents * rate)),
      rate
    };
  }

  function buildReceiptLookup(receipt) {
    const store = findStore(receipt.store_id);
    const payment = db.payments.find((row) => row.receipt_id === receipt.receipt_id) || null;
    const items = itemsForReceipt(receipt.receipt_id).map((item) => {
      const product = findProduct(item.sku);
      return {
        receipt_line_number: item.receipt_line_number,
        sku: item.sku,
        product_name: product ? product.product_name : item.sku,
        quantity: item.quantity,
        weight: item.weight,
        unit_price: item.unit_price,
        line_total: item.line_total
      };
    });
    const tax = taxForReceipt(receipt);
    return {
      saved: true,
      store: store ? publicStore(store) : null,
      receipt,
      items,
      totals: {
        subtotal: fromCents(toCents(tax.taxable) + toCents(tax.exempt)),
        taxable: tax.taxable,
        exempt: tax.exempt,
        tax: tax.tax,
        tax_rate: tax.rate,
        total: receipt.total_amount
      },
      payment: payment ? {
        payment_id: payment.payment_id,
        receipt_id: payment.receipt_id,
        account_id: payment.account_id,
        account_holder_name: payment.account_id && findAccount(payment.account_id)
          ? findAccount(payment.account_id).account_holder_name
          : null,
        payment_method: payment.payment_method,
        payment_date: payment.payment_date,
        payment_time: payment.payment_time,
        payment_status: payment.payment_status,
        account_balance_after: null,
        decline_reason: null
      } : null
    };
  }

  function tableRows(tableName) {
    switch (tableName) {
      case 'Store':
        return db.stores.map((row) => ({
          store_id: row.store_id,
          store_name: row.store_name,
          address: row.address,
          state: row.state
        }));
      case 'Product':
        return db.products.map((row) => ({
          sku: row.sku,
          product_name: row.product_name,
          category: row.category,
          tax_treatment: row.tax_treatment,
          sold_by_weight: row.sold_by_weight,
          base_price: row.base_price
        }));
      case 'Inventory':
        return db.inventory.map((row) => ({
          store_id: row.store_id,
          sku: row.sku,
          available_quantity: row.available_quantity,
          aisle_number: row.aisle_number
        }));
      case 'Receipt':
        return db.receipts.map((row) => ({
          receipt_id: row.receipt_id,
          store_id: row.store_id,
          date: row.date,
          time: row.time,
          total_amount: row.total_amount
        }));
      case 'ReceiptItem':
        return db.receiptItems.map((row) => ({
          receipt_id: row.receipt_id,
          receipt_line_number: row.receipt_line_number,
          sku: row.sku,
          quantity: row.quantity,
          weight: row.weight,
          unit_price: row.unit_price,
          line_total: row.line_total
        }));
      case 'Payment':
        return db.payments.map((row) => ({
          payment_id: row.payment_id,
          receipt_id: row.receipt_id,
          account_id: row.account_id,
          payment_method: row.payment_method,
          payment_date: row.payment_date,
          payment_time: row.payment_time,
          payment_status: row.payment_status
        }));
      case 'BankAccount':
        return db.bankAccounts.map((row) => ({
          account_id: row.account_id,
          account_holder_name: row.account_holder_name,
          account_number: row.account_number,
          account_balance: row.account_balance
        }));
      default:
        return null;
    }
  }

  function countOf(tableName) {
    const rows = tableRows(tableName);
    return rows ? rows.length : 0;
  }

  function assertKnownTable(tableName, step) {
    if (!TABLE_NAMES.includes(tableName)) {
      throw fail(`${step}: "${tableName}" is not one of ${TABLE_NAMES.join(', ')}.`);
    }
  }

  // ----- reports ----------------------------------------------------------

  function reportSalesByStore(params) {
    const range = requireDates(params);
    const rows = db.stores.map((store) => {
      const receipts = db.receipts.filter((receipt) => (
        receipt.store_id === store.store_id && receiptInRange(receipt, range.start, range.end)
      ));
      const totalCents = receipts.reduce((sum, receipt) => sum + toCents(receipt.total_amount), 0);
      return {
        store_id: store.store_id,
        store_name: store.store_name,
        state: store.state,
        receipt_count: receipts.length,
        sales_total: fromCents(totalCents)
      };
    }).sort((a, b) => b.sales_total - a.sales_total);

    const sql = [
      'SELECT s.store_id, s.address, s.state,',
      '       COUNT(r.receipt_id) AS receipt_count,',
      '       COALESCE(SUM(r.total_amount), 0) AS sales_total',
      'FROM Store s',
      'LEFT JOIN Receipt r',
      '  ON r.store_id = s.store_id',
      ` AND r.date BETWEEN ${sqlString(range.start)} AND ${sqlString(range.end)}`,
      'GROUP BY s.store_id, s.address, s.state',
      'ORDER BY sales_total DESC;'
    ].join('\n');

    return {
      sql,
      data: {
        title: 'Sales total per store',
        columns: [
          { key: 'store_id', label: 'Store ID' },
          { key: 'store_name', label: 'Store' },
          { key: 'state', label: 'State' },
          { key: 'receipt_count', label: 'Receipts', align: 'right' },
          { key: 'sales_total', label: 'Sales total', align: 'right', format: 'money' }
        ],
        rows
      }
    };
  }

  function reportSalesByState() {
    const byState = new Map();
    db.stores.forEach((store) => {
      if (!byState.has(store.state)) {
        byState.set(store.state, { state: store.state, store_count: 0, receipt_count: 0, sales_cents: 0 });
      }
      byState.get(store.state).store_count += 1;
    });
    db.receipts.forEach((receipt) => {
      const store = findStore(receipt.store_id);
      if (!store || !byState.has(store.state)) return;
      const bucket = byState.get(store.state);
      bucket.receipt_count += 1;
      bucket.sales_cents += toCents(receipt.total_amount);
    });
    const rows = Array.from(byState.values()).map((bucket) => ({
      state: bucket.state,
      store_count: bucket.store_count,
      receipt_count: bucket.receipt_count,
      sales_total: fromCents(bucket.sales_cents)
    })).sort((a, b) => b.sales_total - a.sales_total);

    const sql = [
      'SELECT s.state,',
      '       COUNT(DISTINCT s.store_id) AS store_count,',
      '       COUNT(r.receipt_id) AS receipt_count,',
      '       COALESCE(SUM(r.total_amount), 0) AS sales_total',
      'FROM Store s',
      'LEFT JOIN Receipt r ON r.store_id = s.store_id',
      'GROUP BY s.state',
      'ORDER BY sales_total DESC;'
    ].join('\n');

    return {
      sql,
      data: {
        title: 'Sales total per state',
        columns: [
          { key: 'state', label: 'State' },
          { key: 'store_count', label: 'Stores', align: 'right' },
          { key: 'receipt_count', label: 'Receipts', align: 'right' },
          { key: 'sales_total', label: 'Sales total', align: 'right', format: 'money' }
        ],
        rows
      }
    };
  }

  function reportTopProducts() {
    const totals = new Map();
    db.receiptItems.forEach((item) => {
      if (!totals.has(item.sku)) {
        const product = findProduct(item.sku);
        totals.set(item.sku, {
          sku: item.sku,
          product_name: product ? product.product_name : item.sku,
          units_sold: 0,
          weight_sold: 0,
          sales_cents: 0
        });
      }
      const bucket = totals.get(item.sku);
      if (item.quantity != null) bucket.units_sold += item.quantity;
      if (item.weight != null) bucket.weight_sold = roundQty(bucket.weight_sold + item.weight);
      bucket.sales_cents += toCents(item.line_total);
    });
    const rows = Array.from(totals.values())
      .map((bucket) => ({
        sku: bucket.sku,
        product_name: bucket.product_name,
        units_sold: bucket.units_sold || null,
        weight_sold: bucket.weight_sold || null,
        sales: fromCents(bucket.sales_cents)
      }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);

    const sql = [
      'SELECT ri.sku, p.product_name,',
      '       SUM(ri.quantity) AS units_sold,',
      '       SUM(ri.weight) AS weight_sold,',
      '       SUM(ri.line_total) AS sales',
      'FROM ReceiptItem ri',
      'JOIN Product p ON p.sku = ri.sku',
      'GROUP BY ri.sku, p.product_name',
      'ORDER BY sales DESC',
      'LIMIT 10;'
    ].join('\n');

    return {
      sql,
      data: {
        title: 'Top-selling products',
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'product_name', label: 'Product' },
          { key: 'units_sold', label: 'Units sold', align: 'right' },
          { key: 'weight_sold', label: 'Weight sold (lb)', align: 'right' },
          { key: 'sales', label: 'Sales (before tax)', align: 'right', format: 'money' }
        ],
        rows
      }
    };
  }

  function reportLowStock(params) {
    const threshold = params && params.threshold != null ? Number(params.threshold) : 10;
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw fail('Report failed before it ran: the low-stock threshold must be a number zero or greater.');
    }
    const rows = db.inventory
      .filter((row) => row.available_quantity <= threshold)
      .map((row) => {
        const store = findStore(row.store_id);
        const product = findProduct(row.sku);
        return {
          store_name: store ? store.store_name : `Store ${row.store_id}`,
          state: store ? store.state : '',
          sku: row.sku,
          product_name: product ? product.product_name : row.sku,
          available_quantity: row.available_quantity,
          aisle_number: row.aisle_number
        };
      })
      .sort((a, b) => a.available_quantity - b.available_quantity || a.store_name.localeCompare(b.store_name));

    const sql = [
      'SELECT s.address, s.state, i.sku, p.product_name, i.available_quantity, i.aisle_number',
      'FROM Inventory i',
      'JOIN Store s ON s.store_id = i.store_id',
      'JOIN Product p ON p.sku = i.sku',
      `WHERE i.available_quantity <= ${threshold}`,
      'ORDER BY i.available_quantity ASC, s.store_id, i.sku;'
    ].join('\n');

    return {
      sql,
      data: {
        title: 'Low-stock items per store',
        columns: [
          { key: 'store_name', label: 'Store' },
          { key: 'state', label: 'State' },
          { key: 'sku', label: 'SKU' },
          { key: 'product_name', label: 'Product' },
          { key: 'available_quantity', label: 'On hand', align: 'right' },
          { key: 'aisle_number', label: 'Aisle', align: 'right' }
        ],
        rows
      }
    };
  }

  function reportTaxByState() {
    const buckets = new Map();
    db.stores.forEach((store) => {
      if (!buckets.has(store.state)) {
        buckets.set(store.state, {
          state: store.state,
          tax_rate: TAX_RATES[store.state] || 0,
          taxable_cents: 0,
          tax_cents: 0
        });
      }
    });
    db.receipts.forEach((receipt) => {
      const store = findStore(receipt.store_id);
      if (!store || !buckets.has(store.state)) return;
      const tax = taxForReceipt(receipt);
      const bucket = buckets.get(store.state);
      bucket.taxable_cents += toCents(tax.taxable);
      bucket.tax_cents += toCents(tax.tax);
    });
    const rows = Array.from(buckets.values()).map((bucket) => ({
      state: bucket.state,
      tax_rate: bucket.tax_rate,
      taxable_sales: fromCents(bucket.taxable_cents),
      tax_collected: fromCents(bucket.tax_cents)
    })).sort((a, b) => b.tax_collected - a.tax_collected);

    const sql = [
      '-- Tax is recomputed from ReceiptItem + Product.tax_treatment and the state rate.',
      'SELECT s.state,',
      '       SUM(CASE WHEN p.tax_treatment = \'taxable\' THEN ri.line_total ELSE 0 END) AS taxable_sales',
      'FROM Receipt r',
      'JOIN Store s ON s.store_id = r.store_id',
      'JOIN ReceiptItem ri ON ri.receipt_id = r.receipt_id',
      'JOIN Product p ON p.sku = ri.sku',
      'GROUP BY s.state',
      'ORDER BY s.state;'
    ].join('\n');

    return {
      sql,
      data: {
        title: 'Tax collected per state',
        columns: [
          { key: 'state', label: 'State' },
          { key: 'tax_rate', label: 'Sample rate', align: 'right', format: 'percent' },
          { key: 'taxable_sales', label: 'Taxable sales', align: 'right', format: 'money' },
          { key: 'tax_collected', label: 'Tax collected', align: 'right', format: 'money' }
        ],
        rows
      }
    };
  }

  function reportPayments() {
    const methods = ['cash', 'card'];
    const rows = methods.map((method) => {
      const matching = db.payments.filter((payment) => payment.payment_method === method);
      const approved = matching.filter((payment) => payment.payment_status === 'approved');
      const declined = matching.filter((payment) => payment.payment_status === 'declined');
      const sum = (list) => fromCents(list.reduce((total, payment) => total + toCents(payment.payment_amount || 0), 0));
      return {
        payment_method: method,
        approved_count: approved.length,
        declined_count: declined.length,
        approved_amount: sum(approved),
        declined_amount: sum(declined)
      };
    });

    const sql = [
      '-- payment_amount is the receipt total, or the attempted total when the card was declined.',
      '-- It is not a column on Payment. A real query can join Receipt for approved rows.',
      'SELECT payment_method, payment_status, COUNT(*) AS payment_count',
      'FROM Payment',
      'GROUP BY payment_method, payment_status',
      'ORDER BY payment_method, payment_status;'
    ].join('\n');

    return {
      sql,
      data: {
        title: 'Payments by method',
        columns: [
          { key: 'payment_method', label: 'Method' },
          { key: 'approved_count', label: 'Approved', align: 'right' },
          { key: 'declined_count', label: 'Declined', align: 'right' },
          { key: 'approved_amount', label: 'Approved amount', align: 'right', format: 'money' },
          { key: 'declined_amount', label: 'Declined amount', align: 'right', format: 'money' }
        ],
        rows
      }
    };
  }

  function reportReceiptLookup(params) {
    const raw = params && params.receipt_id;
    const receiptId = Number(raw);
    const sql = [
      'SELECT r.receipt_id, r.store_id, r.date, r.time, r.total_amount,',
      '       ri.receipt_line_number, ri.sku, ri.quantity, ri.weight, ri.unit_price, ri.line_total,',
      '       p.payment_method, p.payment_status',
      'FROM Receipt r',
      'JOIN ReceiptItem ri ON ri.receipt_id = r.receipt_id',
      'LEFT JOIN Payment p ON p.receipt_id = r.receipt_id',
      `WHERE r.receipt_id = ${Number.isInteger(receiptId) ? receiptId : 0}`,
      'ORDER BY ri.receipt_line_number;'
    ].join('\n');

    if (!Number.isInteger(receiptId) || receiptId <= 0) {
      throw fail('Receipt lookup failed: enter a receipt ID that is a positive whole number.', sql);
    }
    const receipt = db.receipts.find((row) => row.receipt_id === receiptId);
    if (!receipt) {
      throw fail(`Receipt lookup failed: no Receipt row with receipt_id ${receiptId}. Declined cards do not create a receipt.`, sql);
    }
    const view = buildReceiptLookup(receipt);
    return {
      sql,
      data: {
        title: `Receipt ${receiptId}`,
        columns: [
          { key: 'receipt_line_number', label: 'Line' },
          { key: 'sku', label: 'SKU' },
          { key: 'product_name', label: 'Product' },
          { key: 'quantity', label: 'Qty', align: 'right' },
          { key: 'weight', label: 'Weight (lb)', align: 'right' },
          { key: 'unit_price', label: 'Unit price', align: 'right', format: 'money' },
          { key: 'line_total', label: 'Line total', align: 'right', format: 'money' }
        ],
        rows: view.items,
        receipt: view
      }
    };
  }

  // ----- simulation helpers -----------------------------------------------

  function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function pickStores(count) {
    const pool = db.stores.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = pool[i];
      pool[i] = pool[j];
      pool[j] = swap;
    }
    return pool.slice(0, count);
  }

  function randomCart(store) {
    const stocked = db.inventory.filter((row) => (
      row.store_id === store.store_id && row.available_quantity > 0 && findProduct(row.sku)
    ));
    if (!stocked.length) return null;
    const wanted = Math.min(stocked.length, randomInt(1, 3));
    const chosen = [];
    const pool = stocked.slice();
    while (chosen.length < wanted && pool.length) {
      const index = Math.floor(Math.random() * pool.length);
      const row = pool.splice(index, 1)[0];
      const product = findProduct(row.sku);
      if (product.sold_by_weight) {
        const maxLb = Math.min(row.available_quantity, 2);
        if (maxLb < 0.25) continue;
        const steps = Math.max(1, Math.floor(maxLb / 0.25));
        chosen.push({ sku: row.sku, weight: roundQty(randomInt(1, steps) * 0.25) });
      } else {
        const qty = randomInt(1, Math.min(2, row.available_quantity));
        chosen.push({ sku: row.sku, quantity: qty });
      }
    }
    return chosen.length ? chosen : null;
  }

  function randomPayload(stores) {
    const store = stores[Math.floor(Math.random() * stores.length)];
    const items = randomCart(store);
    if (!items) return null;
    const useCard = Math.random() < 0.55 && db.bankAccounts.length > 0;
    if (!useCard) {
      return { store_id: store.store_id, payment_method: 'cash', account_id: null, items };
    }
    const account = db.bankAccounts[Math.floor(Math.random() * db.bankAccounts.length)];
    return {
      store_id: store.store_id,
      payment_method: 'card',
      account_id: account.account_id,
      items
    };
  }

  // ----- public stubs -----------------------------------------------------

  /**
   * getStores()
   * input:  none
   * output: { data: Store[], sql, ms }
   * Store:  { store_id, store_name, address, state, tax_rate }
   * TODO: replace with real backend call
   */
  async function getStores() {
    const sql = [
      'SELECT store_id, address, state',
      'FROM Store',
      'ORDER BY store_id;',
      '-- store_name and tax_rate are added by the stub for the register preview.'
    ].join('\n');
    return timed(sql, () => db.stores.map(publicStore).sort((a, b) => a.store_id - b.store_id));
  }

  /**
   * getProducts()
   * input:  none
   * output: { data: Product[], sql, ms }
   * Product: { sku, product_name, category, tax_treatment, sold_by_weight, price, prices_by_state }
   * prices_by_state is { TX, GA, NY, CO } and stands in for StateProductPrice.
   * TODO: replace with real backend call
   */
  async function getProducts() {
    const sql = [
      'SELECT sku, product_name, category, tax_treatment',
      'FROM Product',
      'ORDER BY product_name;',
      '-- sold_by_weight, price, and prices_by_state are mock fields, not final columns yet.'
    ].join('\n');
    return timed(sql, () => db.products.map(publicProduct).sort((a, b) => a.product_name.localeCompare(b.product_name)));
  }

  /**
   * getInventory(storeId)
   * input:  storeId (number)
   * output: { data: Inventory[], sql, ms }
   * Inventory: { store_id, sku, available_quantity, aisle_number }
   * TODO: replace with real backend call
   */
  async function getInventory(storeId) {
    const id = Number(storeId);
    const sql = [
      'SELECT store_id, sku, available_quantity, aisle_number',
      'FROM Inventory',
      `WHERE store_id = ${Number.isInteger(id) ? id : 0}`,
      'ORDER BY aisle_number, sku;'
    ].join('\n');
    if (!Number.isInteger(id)) {
      throw fail('Inventory lookup failed: store id must be a whole number.', sql);
    }
    return timed(sql, () => db.inventory.filter((row) => row.store_id === id).map((row) => ({ ...row })));
  }

  /**
   * getBankAccounts()
   * input:  none
   * output: { data: BankAccount[], sql, ms }
   * BankAccount: { account_id, account_holder_name, account_number, account_balance }
   * TODO: replace with real backend call
   */
  async function getBankAccounts() {
    const sql = [
      'SELECT account_id, account_holder_name, account_number, account_balance',
      'FROM BankAccount',
      'ORDER BY account_holder_name;'
    ].join('\n');
    return timed(sql, () => db.bankAccounts.map(publicAccount).sort((a, b) => (
      a.account_holder_name.localeCompare(b.account_holder_name)
    )));
  }

  /**
   * checkout(payload)
   * input: {
   *   store_id,
   *   payment_method: 'cash' | 'card',
   *   account_id: number or null,
   *   items: [{ sku, quantity, weight }]   // quantity set for counted items, weight for by-weight
   * }
   * The stub ignores any price sent by the browser and looks the price up itself.
   * output: { data: { saved, store, receipt, items, totals, payment }, sql, ms }
   * payment.payment_status is 'approved' or 'declined'.
   * On decline, saved is false, receipt is null, and inventory is unchanged.
   * Throws Error (with .sql) when the sale cannot be attempted (bad sku, no stock, ...).
   * TODO: replace with real backend call
   */
  async function checkout(payload) {
    const start = performance.now();
    await pause(180 + Math.round(Math.random() * 120));
    const applied = applyCheckout(payload, new Date());
    return {
      data: applied.data,
      sql: applied.sql,
      ms: Math.round(performance.now() - start)
    };
  }

  /**
   * runReport(reportId, params)
   * reportId:
   *   'sales-by-store'       params { start_date, end_date }  dates are YYYY-MM-DD
   *   'sales-by-state'       params ignored
   *   'top-products'         params ignored
   *   'low-stock'            params { threshold }
   *   'tax-by-state'         params ignored
   *   'payments-by-method'   params ignored
   *   'receipt-lookup'       params { receipt_id }
   * output: { data: { title, columns, rows, receipt? }, sql, ms }
   * columns: [{ key, label, align?, format? }]  format is 'money' or 'percent' or omitted
   * receipt-lookup also sets data.receipt to the same shape checkout returns.
   * TODO: replace with real backend call
   */
  async function runReport(reportId, params) {
    let built;
    switch (reportId) {
      case 'sales-by-store':
        built = reportSalesByStore(params || {});
        break;
      case 'sales-by-state':
        built = reportSalesByState();
        break;
      case 'top-products':
        built = reportTopProducts();
        break;
      case 'low-stock':
        built = reportLowStock(params || {});
        break;
      case 'tax-by-state':
        built = reportTaxByState();
        break;
      case 'payments-by-method':
        built = reportPayments();
        break;
      case 'receipt-lookup':
        built = reportReceiptLookup(params || {});
        break;
      default:
        throw fail(`Report failed: unknown report id "${reportId}".`);
    }
    return timed(built.sql, built.data);
  }

  /**
   * browseTable(tableName, limit)
   * input:  one of Store, Product, Inventory, Receipt, ReceiptItem, Payment, BankAccount
   *         limit is a positive integer (the UI asks for 10)
   * output: { data: { table, columns, rows }, sql, ms }
   * TODO: replace with real backend call
   */
  async function browseTable(tableName, limit) {
    const n = Number(limit);
    const safeName = TABLE_NAMES.includes(tableName) ? tableName : 'Store';
    const sql = `SELECT * FROM ${safeName} LIMIT ${Number.isInteger(n) ? n : 0};`;
    assertKnownTable(tableName, 'Browse failed');
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw fail('Browse failed: limit must be a whole number from 1 to 100.', sql);
    }
    return timed(sql, () => {
      const rows = tableRows(tableName).slice(0, n);
      const columns = rows[0]
        ? Object.keys(rows[0])
        : Object.keys(tableRows(tableName)[0] || { notice: '' });
      const columnDefs = (rows[0] ? Object.keys(rows[0]) : columns).map((key) => ({
        key,
        label: key,
        align: typeof (rows[0] && rows[0][key]) === 'number' ? 'right' : 'left',
        format: /amount|price|balance|total/.test(key) ? 'money' : undefined
      }));
      if (!rows.length) {
        return {
          table: tableName,
          columns: [{ key: 'notice', label: 'Notice' }],
          rows: []
        };
      }
      return { table: tableName, columns: columnDefs, rows };
    });
  }

  /**
   * getRowCounts()
   * input:  none
   * output: { data: { counts: [{ table, rows }] }, sql, ms }
   * TODO: replace with real backend call
   */
  async function getRowCounts() {
    const sql = TABLE_NAMES.map((name) => (
      `SELECT '${name}' AS table_name, COUNT(*) AS rows FROM ${name}`
    )).join('\nUNION ALL\n') + ';';
    return timed(sql, () => ({
      counts: TABLE_NAMES.map((name) => ({ table: name, rows: countOf(name) }))
    }));
  }

  /**
   * createTables()
   * input:  none
   * output: { data: { tables, alreadyExisted, message }, sql, ms }
   * Does not delete rows. The SQL text is the schema the log should show.
   * TODO: replace with real backend call
   */
  async function createTables() {
    const already = db.tablesCreated;
    db.tablesCreated = true;
    const sql = [
      '-- Not executed here. This is the statement text for the SQL log.',
      '-- sold_by_weight and price are intentionally left off Product for now.',
      'CREATE TABLE IF NOT EXISTS Store (',
      '  store_id INTEGER PRIMARY KEY,',
      '  address VARCHAR(200) NOT NULL,',
      '  state CHAR(2) NOT NULL',
      ');',
      'CREATE TABLE IF NOT EXISTS Product (',
      '  sku VARCHAR(20) PRIMARY KEY,',
      '  product_name VARCHAR(120) NOT NULL,',
      '  category VARCHAR(40) NOT NULL,',
      "  tax_treatment VARCHAR(10) NOT NULL CHECK (tax_treatment IN ('taxable', 'exempt'))",
      ');',
      'CREATE TABLE IF NOT EXISTS Inventory (',
      '  store_id INTEGER NOT NULL REFERENCES Store (store_id),',
      '  sku VARCHAR(20) NOT NULL REFERENCES Product (sku),',
      '  available_quantity NUMERIC(10, 2) NOT NULL,',
      '  aisle_number INTEGER NOT NULL,',
      '  PRIMARY KEY (store_id, sku)',
      ');',
      'CREATE TABLE IF NOT EXISTS Receipt (',
      '  receipt_id INTEGER PRIMARY KEY,',
      '  store_id INTEGER NOT NULL REFERENCES Store (store_id),',
      '  date DATE NOT NULL,',
      '  time TIME NOT NULL,',
      '  total_amount NUMERIC(10, 2) NOT NULL',
      ');',
      'CREATE TABLE IF NOT EXISTS ReceiptItem (',
      '  receipt_id INTEGER NOT NULL REFERENCES Receipt (receipt_id),',
      '  receipt_line_number INTEGER NOT NULL,',
      '  sku VARCHAR(20) NOT NULL REFERENCES Product (sku),',
      '  quantity INTEGER,',
      '  weight NUMERIC(10, 2),',
      '  unit_price NUMERIC(10, 2) NOT NULL,',
      '  line_total NUMERIC(10, 2) NOT NULL,',
      '  PRIMARY KEY (receipt_id, receipt_line_number)',
      ');',
      'CREATE TABLE IF NOT EXISTS BankAccount (',
      '  account_id INTEGER PRIMARY KEY,',
      '  account_holder_name VARCHAR(120) NOT NULL,',
      '  account_number VARCHAR(30) NOT NULL,',
      '  account_balance NUMERIC(12, 2) NOT NULL',
      ');',
      'CREATE TABLE IF NOT EXISTS Payment (',
      '  payment_id INTEGER PRIMARY KEY,',
      '  receipt_id INTEGER REFERENCES Receipt (receipt_id),',
      '  account_id INTEGER REFERENCES BankAccount (account_id),',
      "  payment_method VARCHAR(10) NOT NULL CHECK (payment_method IN ('cash', 'card')),",
      '  payment_date DATE NOT NULL,',
      '  payment_time TIME NOT NULL,',
      "  payment_status VARCHAR(10) NOT NULL CHECK (payment_status IN ('approved', 'declined'))",
      ');'
    ].join('\n');
    const message = already
      ? 'Create tables finished. The tables already existed, so no rows were changed.'
      : 'Create tables finished. The seven tables are ready.';
    return timed(sql, {
      tables: TABLE_NAMES.slice(),
      alreadyExisted: already,
      message
    });
  }

  /**
   * initLookupTables()
   * input:  none
   * output: { data: { tables, message }, sql, ms }
   * Reloads Store, Product, Inventory, and BankAccount from the seed.
   * Receipts are kept. Inventory counts and bank balances go back to the seed,
   * so they will no longer match the receipts that are still there.
   * TODO: replace with real backend call
   */
  async function initLookupTables() {
    db.stores = clone(SEED_STORES);
    db.products = clone(SEED_PRODUCTS);
    db.inventory = buildInventory();
    db.bankAccounts = clone(SEED_ACCOUNTS);
    const when = Date.now();
    LOOKUP_TABLES.forEach((name) => {
      logActivity(when, name, 'updated', '', 'Lookup table reloaded from seed data');
    });
    const productValues = SEED_PRODUCTS.map((product) => (
      `(${sqlString(product.sku)}, ${sqlString(product.product_name)}, ${sqlString(product.category)}, ${sqlString(product.tax_treatment)})`
    )).join(',\n  ');
    const storeValues = SEED_STORES.map((store) => (
      `(${store.store_id}, ${sqlString(store.address)}, ${sqlString(store.state)})`
    )).join(',\n  ');
    const sql = [
      'BEGIN;',
      'DELETE FROM Inventory;',
      'DELETE FROM BankAccount;',
      '-- Store and Product deletes assume transaction tables were cleared first,',
      '-- or the real script uses a load that does not break foreign keys.',
      'DELETE FROM Store;',
      'DELETE FROM Product;',
      'INSERT INTO Store (store_id, address, state) VALUES',
      `  ${storeValues};`,
      'INSERT INTO Product (sku, product_name, category, tax_treatment) VALUES',
      `  ${productValues};`,
      '-- Inventory and BankAccount are reloaded from the seed the same way.',
      `INSERT INTO BankAccount (account_id, account_holder_name, account_number, account_balance) VALUES`,
      `  ${SEED_ACCOUNTS.map((account) => `(${account.account_id}, ${sqlString(account.account_holder_name)}, ${sqlString(account.account_number)}, ${account.account_balance.toFixed(2)})`).join(',\n  ')};`,
      'COMMIT;'
    ].join('\n');
    return timed(sql, {
      tables: LOOKUP_TABLES.slice(),
      message: 'Lookup tables reloaded. Store, Product, Inventory, and BankAccount are back to the seed. Receipts were kept.'
    });
  }

  /**
   * resetTransactionTables()
   * input:  none
   * output: { data: { tables, removed, message }, sql, ms }
   * Deletes Receipt, ReceiptItem, and Payment. Does not restore inventory or balances.
   * TODO: replace with real backend call
   */
  async function resetTransactionTables() {
    const removed = {
      Receipt: db.receipts.length,
      ReceiptItem: db.receiptItems.length,
      Payment: db.payments.length
    };
    db.receipts = [];
    db.receiptItems = [];
    db.payments = [];
    db.activity = db.activity.filter((entry) => !TX_TABLES.includes(entry.table));
    const sql = [
      'BEGIN;',
      'DELETE FROM ReceiptItem;',
      'DELETE FROM Payment;',
      'DELETE FROM Receipt;',
      'COMMIT;'
    ].join('\n');
    return timed(sql, {
      tables: TX_TABLES.slice(),
      removed,
      message: `Reset finished. Removed ${removed.Receipt} receipts, ${removed.ReceiptItem} receipt lines, and ${removed.Payment} payments. Inventory and bank balances were not changed.`
    });
  }

  /**
   * deleteAllRows(tableName)
   * input:  one table name from the list in browseTable
   * output: { data: { table, removed, message }, sql, ms }
   * Deletes that table only. Child rows in other tables are left as they are.
   * TODO: replace with real backend call
   */
  async function deleteAllRows(tableName) {
    const sql = `DELETE FROM ${TABLE_NAMES.includes(tableName) ? tableName : 'UnknownTable'};`;
    assertKnownTable(tableName, 'Delete failed');
    const removed = countOf(tableName);
    if (tableName === 'Store') db.stores = [];
    else if (tableName === 'Product') db.products = [];
    else if (tableName === 'Inventory') db.inventory = [];
    else if (tableName === 'Receipt') db.receipts = [];
    else if (tableName === 'ReceiptItem') db.receiptItems = [];
    else if (tableName === 'Payment') db.payments = [];
    else if (tableName === 'BankAccount') db.bankAccounts = [];
    db.activity = db.activity.filter((entry) => entry.table !== tableName);
    return timed(sql, {
      table: tableName,
      removed,
      message: `Deleted ${removed} row${removed === 1 ? '' : 's'} from ${tableName}.`
    });
  }

  /**
   * runSimulation(options, onProgress, signal)
   * input options: { customerCount, storeCount, concurrentConnections }
   * onProgress is called after each customer with:
   *   { processed, total, receiptsCreated, approved, declined, skipped,
   *     revenue, elapsedMs, last, sql, ms }
   * signal is an AbortSignal from the Stop button. Finished checkouts stay saved.
   * output: { data: { cancelled, processed, receiptsCreated, approved, declined,
   *   skipped, revenue, elapsedMs, averageTransactionMs, storesUsed }, sql, ms }
   * TODO: replace with real backend call
   */
  async function runSimulation(options, onProgress, signal) {
    const started = performance.now();
    const customerCount = Number(options && options.customerCount);
    const storeCount = Number(options && options.storeCount);
    const concurrency = Number(options && options.concurrentConnections);

    if (!Number.isInteger(customerCount) || customerCount < 1 || customerCount > 1000) {
      throw fail('Simulation failed before it started: customers must be a whole number from 1 to 1000.');
    }
    if (!db.stores.length) {
      throw fail('Simulation failed before it started: there are no stores. Initialize the lookup tables first.');
    }
    if (!Number.isInteger(storeCount) || storeCount < 1 || storeCount > db.stores.length) {
      throw fail(`Simulation failed before it started: stores involved must be a whole number from 1 to ${db.stores.length}.`);
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
      throw fail('Simulation failed before it started: concurrent connections must be a whole number from 1 to 20.');
    }

    const stores = pickStores(storeCount);
    const stats = {
      processed: 0,
      receiptsCreated: 0,
      approved: 0,
      declined: 0,
      skipped: 0,
      revenueCents: 0,
      times: []
    };
    let nextIndex = 0;
    const workers = Math.min(concurrency, customerCount);

    function snapshot(extra) {
      return {
        processed: stats.processed,
        total: customerCount,
        receiptsCreated: stats.receiptsCreated,
        approved: stats.approved,
        declined: stats.declined,
        skipped: stats.skipped,
        revenue: fromCents(stats.revenueCents),
        elapsedMs: Math.round(performance.now() - started),
        ...extra
      };
    }

    async function worker() {
      while (nextIndex < customerCount) {
        if (signal && signal.aborted) return;
        const mine = nextIndex;
        nextIndex += 1;
        if (mine >= customerCount) return;

        const payload = randomPayload(stores);
        if (!payload) {
          stats.processed += 1;
          stats.skipped += 1;
          if (typeof onProgress === 'function') {
            onProgress(snapshot({
              last: { note: 'Skipped — a chosen store has nothing left in stock.', payment_status: 'skipped' },
              sql: '-- skipped, no stock left to sell',
              ms: 0
            }));
          }
          continue;
        }

        const oneStart = performance.now();
        try {
          // Shorter wait than a hand checkout so a batch of 100 is watchable
          // (about 100 / 5 connections * 140 ms ≈ 3 seconds).
          await pause(140, signal);
          const applied = applyCheckout(payload, new Date());
          const ms = Math.round(performance.now() - oneStart);
          stats.processed += 1;
          stats.times.push(ms);
          const status = applied.data.payment.payment_status;
          if (status === 'approved') {
            stats.approved += 1;
            stats.receiptsCreated += 1;
            stats.revenueCents += toCents(applied.data.totals.total);
          } else {
            stats.declined += 1;
          }
          if (typeof onProgress === 'function') {
            const receipt = applied.data.receipt;
            onProgress(snapshot({
              last: {
                receipt_id: receipt ? receipt.receipt_id : null,
                store_name: applied.data.store.store_name,
                total_amount: applied.data.totals.total,
                payment_method: applied.data.payment.payment_method,
                payment_status: status,
                note: applied.data.payment.decline_reason
              },
              sql: `-- connection pool size ${workers}\n${applied.sql}`,
              ms
            }));
          }
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          stats.processed += 1;
          stats.skipped += 1;
          if (typeof onProgress === 'function') {
            onProgress(snapshot({
              last: {
                note: err.message || 'Skipped.',
                payment_status: 'skipped',
                store_name: ''
              },
              sql: err.sql || `-- skipped: ${err.message}`,
              ms: Math.round(performance.now() - oneStart)
            }));
          }
        }
      }
    }

    await Promise.all(Array.from({ length: workers }, () => worker()));

    const elapsedMs = Math.round(performance.now() - started);
    const averageTransactionMs = stats.times.length
      ? Math.round(stats.times.reduce((sum, value) => sum + value, 0) / stats.times.length)
      : 0;
    const cancelled = Boolean(signal && signal.aborted);
    const summarySql = [
      `-- simulation ${cancelled ? 'cancelled' : 'finished'}`,
      `-- customers requested: ${customerCount}`,
      `-- stores involved: ${stores.map((store) => store.store_id).join(', ')}`,
      `-- concurrent connections: ${workers}`,
      `-- approved: ${stats.approved}, declined: ${stats.declined}, skipped: ${stats.skipped}`,
      `-- elapsed_ms: ${elapsedMs}, average_transaction_ms: ${averageTransactionMs}`
    ].join('\n');

    return {
      data: {
        cancelled,
        processed: stats.processed,
        receiptsCreated: stats.receiptsCreated,
        approved: stats.approved,
        declined: stats.declined,
        skipped: stats.skipped,
        revenue: fromCents(stats.revenueCents),
        elapsedMs,
        averageTransactionMs,
        storesUsed: stores.map((store) => ({
          store_id: store.store_id,
          store_name: store.store_name,
          state: store.state
        }))
      },
      sql: summarySql,
      ms: elapsedMs
    };
  }

  /**
   * getRecentActivity(range)
   * input: { preset: '5min' | '1hour' | 'custom', start?: string, end?: string }
   *        custom start/end are datetime-local strings (YYYY-MM-DDTHH:mm)
   * output: { data: { start, end, rows }, sql, ms }
   * rows: [{ at_ms, table, action, record, detail }]
   * Tables covered: Receipt, ReceiptItem, Payment, Inventory, BankAccount
   *   (Store and Product appear only if an admin reload logged them.)
   * TODO: replace with real backend call
   */
  async function getRecentActivity(range) {
    const preset = range && range.preset;
    const now = Date.now();
    let startMs;
    let endMs;
    if (preset === '5min') {
      startMs = now - 5 * 60 * 1000;
      endMs = now;
    } else if (preset === '1hour') {
      startMs = now - 60 * 60 * 1000;
      endMs = now;
    } else if (preset === 'custom') {
      const start = range.start ? new Date(range.start) : null;
      const end = range.end ? new Date(range.end) : null;
      if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw fail('Recent activity failed: a custom range needs both a start and an end.');
      }
      if (start.getTime() > end.getTime()) {
        throw fail('Recent activity failed: the start is after the end.');
      }
      startMs = start.getTime();
      endMs = end.getTime();
    } else {
      throw fail('Recent activity failed: choose last 5 minutes, last hour, or a custom range.');
    }

    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();
    const sql = [
      `-- Rows written between ${startIso} and ${endIso}.`,
      'SELECT \'Receipt\' AS table_name, receipt_id AS record_key, date, time',
      'FROM Receipt',
      'WHERE (date + time) BETWEEN :start AND :end',
      'UNION ALL',
      'SELECT \'ReceiptItem\', receipt_id, NULL, NULL FROM ReceiptItem',
      'UNION ALL',
      'SELECT \'Payment\', payment_id, payment_date, payment_time FROM Payment',
      'UNION ALL',
      'SELECT \'Inventory\', sku, NULL, NULL FROM Inventory',
      'UNION ALL',
      'SELECT \'BankAccount\', account_id, NULL, NULL FROM BankAccount',
      'ORDER BY 1;'
    ].join('\n');

    return timed(sql, () => ({
      start: startIso,
      end: endIso,
      rows: db.activity
        .filter((entry) => entry.at_ms >= startMs && entry.at_ms <= endMs)
        .sort((a, b) => b.at_ms - a.at_ms)
        .map((entry) => ({ ...entry }))
    }));
  }

  db = emptyDb();
  applyHistory();

  return {
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
