'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { beforeEach, describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const poolPath = require.resolve(path.join(root, 'server', 'db', 'pool.js'));
const checkoutPath = require.resolve(path.join(root, 'server', 'services', 'checkoutService.js'));
const serviceSource = fs.readFileSync(checkoutPath, 'utf8');
const transactionSql = fs.readFileSync(path.join(root, 'sql', 'transaction.sql'), 'utf8');

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function toCents(value) {
    const text = String(value);
    const negative = text.startsWith('-');
    const [whole, frac = ''] = (negative ? text.slice(1) : text).split('.');
    if (frac.length > 2) {
        throw new Error(`expected at most two decimal places: ${text}`);
    }
    const cents = (Number(whole) * 100) + Number((frac + '00').slice(0, 2));
    return negative ? -cents : cents;
}

function formatCents(cents) {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// Half away from zero, matching PostgreSQL ROUND for positive money.
function roundDiv(numerator, denominator) {
    const negative = numerator < 0;
    const abs = Math.abs(numerator);
    const quotient = Math.floor(abs / denominator);
    const remainder = abs % denominator;
    const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
    return negative ? -rounded : rounded;
}

function lineTotalCents(unitPrice, amount) {
    return roundDiv(toCents(unitPrice) * toCents(amount), 100);
}

function taxCents(taxableCents, rate) {
    const fraction = String(rate).split('.')[1] || '';
    return roundDiv(taxableCents * Number(fraction), 10 ** fraction.length);
}

const db = {
    taxes: new Map(),
    stores: new Map(),
    products: new Map(),
    inventory: new Map(),
    accounts: new Map(),
    receipts: [],
    items: [],
    payments: [],
    locks: new Map(),
    lockOrders: [],
    log: [],
    failOn: null,
    nextTx: 1
};

function resetDb() {
    db.taxes = new Map();
    db.stores = new Map();
    db.products = new Map();
    db.inventory = new Map();
    db.accounts = new Map();
    db.receipts = [];
    db.items = [];
    db.payments = [];
    db.locks = new Map();
    db.lockOrders = [];
    db.log = [];
    db.failOn = null;
    db.nextTx = 1;
}

function stockKey(storeId, sku) {
    return `${storeId}:${sku}`;
}

async function acquire(key, tx) {
    let entry = db.locks.get(key);
    if (!entry) {
        entry = { owner: null, queue: [] };
        db.locks.set(key, entry);
    }
    if (entry.owner === tx) return;

    while (entry.owner !== null) {
        await new Promise((resolve, reject) => {
            const waiter = {
                resolve: () => {
                    clearTimeout(timer);
                    resolve();
                }
            };
            const timer = setTimeout(() => {
                entry.queue = entry.queue.filter((queued) => queued !== waiter);
                reject(new Error(`lock wait timed out for ${key}`));
            }, 2000);
            entry.queue.push(waiter);
        });
    }

    entry.owner = tx;
    tx.locks.push(key);
    if (key.startsWith('inv:')) tx.lockOrder.push(key.slice(4));
}

function recordLockOrder(tx) {
    if (tx.recorded) return;
    tx.recorded = true;
    db.lockOrders.push(tx.lockOrder.slice());
}

function releaseAll(tx) {
    for (const key of tx.locks) {
        const entry = db.locks.get(key);
        if (!entry || entry.owner !== tx) continue;
        entry.owner = null;
        const next = entry.queue.shift();
        if (next) next.resolve();
    }
    tx.locks = [];
}

function rollback(tx) {
    for (let i = tx.undo.length - 1; i >= 0; i -= 1) tx.undo[i]();
    tx.undo = [];
    recordLockOrder(tx);
    releaseAll(tx);
    tx.open = false;
}

function commit(tx) {
    tx.undo = [];
    recordLockOrder(tx);
    releaseAll(tx);
    tx.open = false;
}

function remember(tx, undo) {
    tx.undo.push(undo);
}

function requirePricingSql(text) {
    assert.match(text, /SUM\(src\.line_total\)/);
    assert.match(text, /WHEN src\.tax_treatment = 'taxable' THEN src\.line_total/);
    assert.match(text, /ELSE 0/);
    assert.match(text, /ROUND\(/);
    assert.match(text, /\* t\.tax_rate/);
    assert.match(text, /INNER JOIN supermarkets\.store s ON s\.store_id/);
    assert.match(text, /INNER JOIN supermarkets\.statetax t ON s\.state = t\.state/);
    assert.match(text, /GROUP BY t\.tax_rate/);
    assert.ok((text.match(/ROUND\(/g) || []).length >= 2);
}

async function handle(tx, sql, params = []) {
    const text = compact(sql);
    db.log.push(text);
    if (db.failOn && text !== 'ROLLBACK' && db.failOn(text)) {
        throw new Error('forced failure');
    }

    if (text === 'BEGIN') {
        tx.open = true;
        return { rows: [] };
    }
    if (text === 'COMMIT') {
        commit(tx);
        return { rows: [] };
    }
    if (text === 'ROLLBACK') {
        rollback(tx);
        return { rows: [] };
    }

    const advisory = text.match(/pg_advisory_xact_lock\((\d+), (\d+)\)/);
    if (advisory) {
        await acquire(`adv:${advisory[1]}:${advisory[2]}`, tx);
        return { rows: [] };
    }

    if (text.includes('FOR UPDATE OF i')) {
        const [sku, storeId] = params;
        const key = stockKey(storeId, sku);
        if (!db.products.has(sku) || !db.inventory.has(key)) return { rows: [] };
        await acquire(`inv:${key}`, tx);
        const product = db.products.get(sku);
        const onHand = db.inventory.get(key);
        return {
            rows: [{
                sku,
                unit_price: product.unit_price,
                tax_treatment: product.tax_treatment,
                sold_by_weight: product.sold_by_weight,
                available_quantity: onHand.available
            }]
        };
    }

    if (text.includes('ROUND(p.unit_price * $3::numeric, 2) AS line_total')) {
        const [sku, storeId, amount] = params;
        const key = stockKey(storeId, sku);
        const product = db.products.get(sku);
        if (!product || !db.inventory.has(key)) return { rows: [] };
        return {
            rows: [{
                unit_price: product.unit_price,
                tax_treatment: product.tax_treatment,
                line_total: formatCents(lineTotalCents(product.unit_price, amount))
            }]
        };
    }

    if (text.includes('AS taxable_subtotal')) {
        requirePricingSql(text);
        const storeId = params[params.length - 1];
        const store = db.stores.get(storeId);
        if (!store || !db.taxes.has(store.state)) return { rows: [] };
        let subtotal = 0;
        let taxable = 0;
        for (let i = 0; i < params.length - 1; i += 2) {
            const cents = toCents(params[i]);
            subtotal += cents;
            if (params[i + 1] === 'taxable') taxable += cents;
        }
        const tax = taxCents(taxable, db.taxes.get(store.state));
        const totals = {
            subtotal: formatCents(subtotal),
            taxable_subtotal: formatCents(taxable),
            tax_amount: formatCents(tax),
            total_amount: formatCents(subtotal + tax)
        };
        tx.totals = totals;
        return { rows: [totals] };
    }

    if (text.startsWith('UPDATE banking.bankaccount')) {
        const [amount, accountId] = params;
        if (!db.accounts.has(accountId)) return { rows: [] };
        await acquire(`acct:${accountId}`, tx);
        const account = db.accounts.get(accountId);
        if (toCents(account.balance) < toCents(amount)) {
            releaseOne(tx, `acct:${accountId}`);
            return { rows: [] };
        }
        const previous = account.balance;
        remember(tx, () => {
            account.balance = previous;
        });
        account.balance = formatCents(toCents(previous) - toCents(amount));
        return { rows: [{ account_id: accountId }] };
    }

    if (text.includes('FROM banking.bankaccount')) {
        const [accountId] = params;
        return {
            rows: db.accounts.has(accountId) ? [{ account_id: accountId }] : []
        };
    }

    if (text.includes('INSERT INTO supermarkets.receiptitem')) {
        const row = {
            receipt_id: params[0],
            receipt_line_number: params[1],
            sku: params[2],
            quantity: params[3],
            weight: params[4],
            unit_price: params[5],
            line_total: params[6]
        };
        db.items.push(row);
        remember(tx, () => {
            const index = db.items.indexOf(row);
            if (index >= 0) db.items.splice(index, 1);
        });
        return { rows: [] };
    }

    if (text.includes('INSERT INTO supermarkets.receipt')) {
        const receiptId = db.receipts.reduce((max, row) => Math.max(max, row.receipt_id), 0) + 1;
        const row = {
            receipt_id: receiptId,
            store_id: params[0],
            subtotal: params[1],
            tax_amount: params[2],
            total_amount: params[3]
        };
        db.receipts.push(row);
        remember(tx, () => {
            const index = db.receipts.indexOf(row);
            if (index >= 0) db.receipts.splice(index, 1);
        });
        return { rows: [{ receipt_id: receiptId }] };
    }

    if (text.includes('INSERT INTO supermarkets.payment')) {
        const paymentId = db.payments.reduce((max, row) => Math.max(max, row.payment_id), 0) + 1;
        const row = {
            payment_id: paymentId,
            receipt_id: params[0],
            account_id: params[1],
            payment_method: params[2],
            amount: params[3],
            payment_status: 'approved'
        };
        db.payments.push(row);
        remember(tx, () => {
            const index = db.payments.indexOf(row);
            if (index >= 0) db.payments.splice(index, 1);
        });
        return { rows: [] };
    }

    if (text.startsWith('UPDATE supermarkets.inventory')) {
        const [amount, storeId, sku] = params;
        const onHand = db.inventory.get(stockKey(storeId, sku));
        const previous = onHand.available;
        remember(tx, () => {
            onHand.available = previous;
        });
        onHand.available = formatCents(toCents(previous) - toCents(amount));
        return { rows: [] };
    }

    if (text.includes('FROM supermarkets.store s') && text.includes('t.tax_rate')) {
        const [storeId] = params;
        const store = db.stores.get(storeId);
        if (!store || !db.taxes.has(store.state)) return { rows: [] };
        return {
            rows: [{
                store_id: storeId,
                tax_rate: db.taxes.get(store.state)
            }]
        };
    }

    throw new Error(`unexpected checkout SQL: ${text}`);
}

function releaseOne(tx, key) {
    const entry = db.locks.get(key);
    if (!entry || entry.owner !== tx) return;
    entry.owner = null;
    tx.locks = tx.locks.filter((held) => held !== key);
    const next = entry.queue.shift();
    if (next) next.resolve();
}

function connect() {
    const tx = {
        id: db.nextTx,
        open: false,
        locks: [],
        lockOrder: [],
        undo: [],
        totals: null
    };
    db.nextTx += 1;
    return Promise.resolve({
        query(sql, params) {
            return handle(tx, sql, params);
        },
        release() {
            tx.released = true;
        }
    });
}

require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: { connect }
};
delete require.cache[checkoutPath];
const { processCheckout } = require(checkoutPath);
const checkoutRoutePath = require.resolve(path.join(root, 'server', 'routes', 'checkout.js'));
delete require.cache[checkoutRoutePath];
const checkoutRouter = require(checkoutRoutePath);

function postCheckout(body) {
    const layer = checkoutRouter.stack.find((entry) => (
        entry.route
        && entry.route.path === '/checkout'
        && entry.route.methods.post
    ));
    assert.ok(layer, 'missing POST /checkout');
    const res = {
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
    return layer.route.stack[layer.route.stack.length - 1].handle({ body }, res).then(() => res);
}

function addTax(state, rate) {
    db.taxes.set(state, rate);
}

function addStore(storeId, state) {
    db.stores.set(storeId, { state });
}

function addProduct(sku, unitPrice, taxTreatment, soldByWeight) {
    db.products.set(sku, {
        unit_price: unitPrice,
        tax_treatment: taxTreatment,
        sold_by_weight: soldByWeight
    });
}

function addInventory(storeId, sku, available) {
    db.inventory.set(stockKey(storeId, sku), { available });
}

function addAccount(accountId, balance) {
    db.accounts.set(accountId, { balance });
}

function baseStores() {
    addTax('TX', '0.0825');
    addTax('CA', '0.0875');
    addStore(1, 'TX');
    addStore(2, 'CA');
    addAccount(7, '100.00');
}

beforeEach(() => {
    resetDb();
    baseStores();
});

function receiptItems(receiptId) {
    return db.items
        .filter((item) => item.receipt_id === receiptId)
        .sort((a, b) => a.receipt_line_number - b.receipt_line_number);
}

describe('checkout SQL trace', () => {
    test('the service and transaction.sql both calculate totals with ROUND, SUM, and CASE', () => {
        assert.match(serviceSource, /ROUND\(p\.unit_price \* \$3::numeric, 2\) AS line_total/);
        assert.match(transactionSql, /ROUND\(p\.unit_price \* \$3::numeric, 2\) AS line_total/);
        assert.match(serviceSource, /SUM\(src\.line_total\)/);
        assert.match(transactionSql, /WHEN src\.tax_treatment = 'taxable' THEN src\.line_total/);
        assert.match(transactionSql, /GROUP BY t\.tax_rate/);
        assert.equal(serviceSource.includes('subtotalCents'), false);
        assert.equal(serviceSource.includes('taxableCents'), false);
        assert.equal(serviceSource.includes('lineCents'), false);
        assert.equal(transactionSql.includes('WITH '), false);
        assert.equal(serviceSource.includes('WITH '), false);
    });
});

describe('counted and weighted pricing', () => {
    test('counted taxable and exempt lines use one rounded tax and matching receipt, payment, and bank totals', async () => {
        addProduct('MLK-101', '3.49', 'exempt', false);
        addProduct('COL-401', '7.49', 'taxable', false);
        addInventory(1, 'MLK-101', '20.00');
        addInventory(1, 'COL-401', '20.00');

        const result = await processCheckout({
            store_id: 1,
            payment_method: 'card',
            account_id: 7,
            items: [
                { sku: 'MLK-101', quantity: 3 },
                { sku: 'COL-401', quantity: 2 }
            ]
        });

        // 3.49 * 3 = 10.47 exempt. 7.49 * 2 = 14.98 taxable.
        // Subtotal 25.45. Tax ROUND(14.98 * 0.0825, 2) = ROUND(1.23585, 2) = 1.24.
        // Total 26.69. Card balance 100.00 - 26.69 = 73.31.
        assert.equal(result.saved, true);
        assert.equal(result.payment_status, 'approved');
        assert.equal(result.subtotal, 25.45);
        assert.equal(result.tax, 1.24);
        assert.equal(result.total, 26.69);

        const receipt = db.receipts[0];
        const payment = db.payments[0];
        assert.equal(receipt.subtotal, '25.45');
        assert.equal(receipt.tax_amount, '1.24');
        assert.equal(receipt.total_amount, '26.69');
        assert.equal(payment.amount, '26.69');
        assert.equal(payment.account_id, 7);
        assert.equal(payment.payment_method, 'card');
        assert.equal(payment.receipt_id, receipt.receipt_id);
        assert.equal(db.accounts.get(7).balance, '73.31');

        const lines = receiptItems(receipt.receipt_id);
        assert.deepEqual(lines.map((line) => line.sku), ['COL-401', 'MLK-101']);
        assert.equal(lines[0].quantity, 2);
        assert.equal(lines[0].weight, null);
        assert.equal(lines[0].line_total, '14.98');
        assert.equal(lines[1].quantity, 3);
        assert.equal(lines[1].weight, null);
        assert.equal(lines[1].line_total, '10.47');
        assert.equal(
            toCents(lines[0].line_total) + toCents(lines[1].line_total),
            toCents(receipt.subtotal)
        );
        assert.equal(db.inventory.get(stockKey(1, 'COL-401')).available, '18.00');
        assert.equal(db.inventory.get(stockKey(1, 'MLK-101')).available, '17.00');

        const totalsSql = db.log.find((entry) => entry.includes('AS taxable_subtotal'));
        assert.match(totalsSql, /UNION ALL/);
        assert.match(totalsSql, /\$5/);
    });

    test('weighted lines round each half-cent line before the lines are summed', async () => {
        addProduct('BAN-001', '0.69', 'exempt', true);
        addProduct('ROM-003', '1.89', 'exempt', true);
        addInventory(1, 'BAN-001', '10.00');
        addInventory(1, 'ROM-003', '10.00');

        const result = await processCheckout({
            store_id: 1,
            payment_method: 'cash',
            account_id: null,
            items: [
                { sku: 'ROM-003', weight: 2.5 },
                { sku: 'BAN-001', weight: 1.5 }
            ]
        });

        // 0.69 * 1.50 = 1.035 -> 1.04. 1.89 * 2.50 = 4.725 -> 4.73.
        // Rounded lines sum to 5.77. Both lines are exempt, so tax is 0.
        assert.equal(result.saved, true);
        assert.equal(result.subtotal, 5.77);
        assert.equal(result.tax, 0);
        assert.equal(result.total, 5.77);

        const receipt = db.receipts[0];
        const lines = receiptItems(receipt.receipt_id);
        assert.deepEqual(lines.map((line) => [line.sku, line.quantity, line.weight, line.line_total]), [
            ['BAN-001', null, 1.5, '1.04'],
            ['ROM-003', null, 2.5, '4.73']
        ]);
        assert.equal(receipt.subtotal, '5.77');
        assert.equal(receipt.tax_amount, '0.00');
        assert.equal(receipt.total_amount, '5.77');
        assert.equal(db.payments[0].amount, '5.77');
        assert.equal(db.payments[0].account_id, null);
        assert.equal(db.payments[0].payment_method, 'cash');
        assert.equal(db.accounts.get(7).balance, '100.00');
        assert.equal(db.inventory.get(stockKey(1, 'BAN-001')).available, '8.50');
        assert.equal(db.inventory.get(stockKey(1, 'ROM-003')).available, '7.50');
    });

    test('a weighted taxable line is taxed on the rounded line total', async () => {
        addProduct('BAN-001', '0.69', 'taxable', true);
        addInventory(1, 'BAN-001', '10.00');

        const result = await processCheckout({
            store_id: 1,
            payment_method: 'cash',
            account_id: null,
            items: [{ sku: 'BAN-001', weight: 1.5 }]
        });

        // Line ROUND(0.69 * 1.50, 2) = 1.04.
        // Tax ROUND(1.04 * 0.0825, 2) = ROUND(0.0858, 2) = 0.09. Total 1.13.
        assert.equal(result.subtotal, 1.04);
        assert.equal(result.tax, 0.09);
        assert.equal(result.total, 1.13);
        assert.equal(db.receipts[0].tax_amount, '0.09');
        assert.equal(db.receipts[0].total_amount, '1.13');
        assert.equal(db.payments[0].amount, '1.13');
        assert.equal(db.items[0].quantity, null);
        assert.equal(db.items[0].weight, 1.5);
        assert.equal(db.items[0].line_total, '1.04');
    });

    test('tax rounds once on an exact half cent of the taxable subtotal', async () => {
        addProduct('BULK-1', '56.40', 'taxable', false);
        addInventory(2, 'BULK-1', '5.00');

        const result = await processCheckout({
            store_id: 2,
            payment_method: 'cash',
            account_id: null,
            items: [{ sku: 'BULK-1', quantity: 1 }]
        });

        // California 0.0875. 56.40 * 0.0875 = 4.935, which rounds to 4.94.
        assert.equal(result.subtotal, 56.4);
        assert.equal(result.tax, 4.94);
        assert.equal(result.total, 61.34);
        assert.equal(db.receipts[0].subtotal, '56.40');
        assert.equal(db.receipts[0].tax_amount, '4.94');
        assert.equal(db.receipts[0].total_amount, '61.34');
        assert.equal(db.payments[0].amount, '61.34');
        assert.equal(
            toCents(db.receipts[0].subtotal) + toCents(db.receipts[0].tax_amount),
            toCents(db.receipts[0].total_amount)
        );
    });

    test('counted items reject a weight and weighted items reject a quantity', async () => {
        addProduct('MLK-101', '3.49', 'exempt', false);
        addProduct('BAN-001', '0.69', 'exempt', true);
        addInventory(1, 'MLK-101', '20.00');
        addInventory(1, 'BAN-001', '10.00');

        await assert.rejects(
            () => processCheckout({
                store_id: 1,
                payment_method: 'cash',
                account_id: null,
                items: [{ sku: 'MLK-101', quantity: 1, weight: 1 }]
            }),
            /Invalid quantity or weight for MLK-101/
        );
        await assert.rejects(
            () => processCheckout({
                store_id: 1,
                payment_method: 'cash',
                account_id: null,
                items: [{ sku: 'BAN-001', quantity: 1, weight: 1.5 }]
            }),
            /Invalid quantity or weight for BAN-001/
        );

        assert.equal(db.receipts.length, 0);
        assert.equal(db.inventory.get(stockKey(1, 'MLK-101')).available, '20.00');
        assert.equal(db.inventory.get(stockKey(1, 'BAN-001')).available, '10.00');
        assert.ok(db.log.includes('ROLLBACK'));
        assert.equal(db.log.includes('COMMIT'), false);
    });
});

describe('bank funds and rollback', () => {
    test('insufficient funds leaves stock, balance, receipts, and payments unchanged', async () => {
        addProduct('COL-401', '7.49', 'taxable', false);
        addInventory(1, 'COL-401', '20.00');
        addAccount(4, '1.00');

        const result = await processCheckout({
            store_id: 1,
            payment_method: 'card',
            account_id: 4,
            items: [{ sku: 'COL-401', quantity: 1 }]
        });

        assert.equal(result.saved, false);
        assert.equal(result.message, 'Insufficient funds');
        assert.equal(db.accounts.get(4).balance, '1.00');
        assert.equal(db.accounts.get(7).balance, '100.00');
        assert.equal(db.inventory.get(stockKey(1, 'COL-401')).available, '20.00');
        assert.equal(db.receipts.length, 0);
        assert.equal(db.items.length, 0);
        assert.equal(db.payments.length, 0);
        assert.ok(db.log.includes('ROLLBACK'));
        assert.equal(db.log.includes('COMMIT'), false);
        assert.equal(db.locks.size === 0 || [...db.locks.values()].every((entry) => entry.owner === null), true);
    });

    test('a failure after a successful debit rolls the bank balance and locks back', async () => {
        addProduct('COL-401', '7.49', 'taxable', false);
        addInventory(1, 'COL-401', '20.00');
        db.failOn = (text) => text.includes('INSERT INTO supermarkets.receipt');

        await assert.rejects(
            () => processCheckout({
                store_id: 1,
                payment_method: 'card',
                account_id: 7,
                items: [{ sku: 'COL-401', quantity: 1 }]
            }),
            /forced failure/
        );

        assert.equal(db.accounts.get(7).balance, '100.00');
        assert.equal(db.inventory.get(stockKey(1, 'COL-401')).available, '20.00');
        assert.equal(db.receipts.length, 0);
        assert.equal(db.payments.length, 0);

        db.failOn = null;
        const retry = await processCheckout({
            store_id: 1,
            payment_method: 'card',
            account_id: 7,
            items: [{ sku: 'COL-401', quantity: 1 }]
        });

        assert.equal(retry.saved, true);
        assert.equal(retry.total, 8.11);
        assert.equal(db.accounts.get(7).balance, '91.89');
        assert.equal(db.receipts.length, 1);
        assert.equal(db.payments[0].amount, '8.11');
        assert.equal(db.inventory.get(stockKey(1, 'COL-401')).available, '19.00');
    });
});

describe('concurrent checkouts', () => {
    test('overlapping checkouts lock inventory in SKU order', async () => {
        addProduct('AAA', '1.00', 'exempt', false);
        addProduct('BBB', '1.00', 'exempt', false);
        addInventory(1, 'AAA', '5.00');
        addInventory(1, 'BBB', '5.00');

        const [first, second] = await Promise.all([
            processCheckout({
                store_id: 1,
                payment_method: 'cash',
                account_id: null,
                items: [
                    { sku: 'BBB', quantity: 1 },
                    { sku: 'AAA', quantity: 1 }
                ]
            }),
            processCheckout({
                store_id: 1,
                payment_method: 'cash',
                account_id: null,
                items: [
                    { sku: 'AAA', quantity: 1 },
                    { sku: 'BBB', quantity: 1 }
                ]
            })
        ]);

        assert.equal(first.saved, true);
        assert.equal(second.saved, true);
        assert.equal(first.total, 2);
        assert.equal(second.total, 2);
        assert.equal(db.inventory.get(stockKey(1, 'AAA')).available, '3.00');
        assert.equal(db.inventory.get(stockKey(1, 'BBB')).available, '3.00');
        assert.equal(db.receipts.length, 2);
        assert.deepEqual(db.lockOrders, [
            ['1:AAA', '1:BBB'],
            ['1:AAA', '1:BBB']
        ]);
        assert.deepEqual(
            db.receipts.map((receipt) => receiptItems(receipt.receipt_id).map((line) => line.sku)),
            [
                ['AAA', 'BBB'],
                ['AAA', 'BBB']
            ]
        );
    });

    test('a second checkout waits for the inventory lock and cannot oversell the last unit', async () => {
        addProduct('AAA', '1.00', 'exempt', false);
        addProduct('BBB', '1.00', 'exempt', false);
        addInventory(1, 'AAA', '1.00');
        addInventory(1, 'BBB', '5.00');

        const settled = await Promise.allSettled([
            processCheckout({
                store_id: 1,
                payment_method: 'cash',
                account_id: null,
                items: [
                    { sku: 'BBB', quantity: 1 },
                    { sku: 'AAA', quantity: 1 }
                ]
            }),
            processCheckout({
                store_id: 1,
                payment_method: 'cash',
                account_id: null,
                items: [
                    { sku: 'AAA', quantity: 1 },
                    { sku: 'BBB', quantity: 1 }
                ]
            })
        ]);
        const approved = settled.filter((entry) => entry.status === 'fulfilled');
        const rejected = settled.filter((entry) => entry.status === 'rejected');

        assert.equal(approved.length, 1);
        assert.equal(rejected.length, 1);
        assert.match(rejected[0].reason.message, /Insufficient stock for AAA/);
        assert.equal(approved[0].value.total, 2);
        assert.equal(db.inventory.get(stockKey(1, 'AAA')).available, '0.00');
        assert.equal(db.inventory.get(stockKey(1, 'BBB')).available, '4.00');
        assert.equal(db.receipts.length, 1);
        assert.equal(db.payments.length, 1);
        assert.equal(db.payments[0].amount, db.receipts[0].total_amount);
        assert.deepEqual(
            receiptItems(db.receipts[0].receipt_id).map((line) => line.sku),
            ['AAA', 'BBB']
        );
    });

    test('two card charges cannot both spend a balance that covers only one total', async () => {
        addProduct('COL-401', '10.00', 'exempt', false);
        addInventory(1, 'COL-401', '5.00');
        addAccount(4, '10.00');

        const [left, right] = await Promise.all([
            processCheckout({
                store_id: 1,
                payment_method: 'card',
                account_id: 4,
                items: [{ sku: 'COL-401', quantity: 1 }]
            }),
            processCheckout({
                store_id: 1,
                payment_method: 'card',
                account_id: 4,
                items: [{ sku: 'COL-401', quantity: 1 }]
            })
        ]);
        const results = [left, right];
        const approved = results.filter((result) => result.saved);
        const declined = results.filter((result) => result.saved === false);

        assert.equal(approved.length, 1);
        assert.equal(declined.length, 1);
        assert.equal(declined[0].message, 'Insufficient funds');
        assert.equal(approved[0].total, 10);
        assert.equal(db.accounts.get(4).balance, '0.00');
        assert.equal(db.inventory.get(stockKey(1, 'COL-401')).available, '4.00');
        assert.equal(db.receipts.length, 1);
        assert.equal(db.payments.length, 1);
        assert.equal(db.payments[0].amount, '10.00');
        assert.equal(db.receipts[0].total_amount, '10.00');
        assert.equal(db.receipts[0].tax_amount, '0.00');
    });
});

describe('checkout SQL visibility', () => {
    function traceText(statements) {
        return statements.map(compact);
    }

    test('a successful card checkout returns the statements that ran, in order, with placeholders', async () => {
        addProduct('MLK-101', '3.49', 'exempt', false);
        addProduct('COL-401', '7.49', 'taxable', false);
        addInventory(1, 'MLK-101', '20.00');
        addInventory(1, 'COL-401', '20.00');

        const payload = {
            store_id: 1,
            payment_method: 'card',
            account_id: 7,
            items: [
                { sku: 'MLK-101', quantity: 3 },
                { sku: 'COL-401', quantity: 2 }
            ]
        };
        const result = await processCheckout(payload);
        const res = await postCheckout(payload);

        assert.equal(result.saved, true);
        assert.equal(result.total, 26.69);
        assert.deepEqual(traceText(result.sql_statements), db.log.slice(0, result.sql_statements.length));
        assert.deepEqual(res.body.sql_statements, result.sql_statements);
        assert.equal(compact(result.sql_statements[0]), 'BEGIN');
        assert.equal(compact(result.sql_statements.at(-1)), 'COMMIT');

        const joined = result.sql_statements.join('\n');
        assert.match(joined, /FOR UPDATE OF i/);
        assert.match(joined, /ROUND\(p\.unit_price \* \$3::numeric, 2\) AS line_total/);
        assert.match(joined, /UNION ALL/);
        assert.match(joined, /\$5/);
        assert.match(joined, /UPDATE banking\.bankaccount/);
        assert.match(joined, /INSERT INTO supermarkets\.receipt\b/);
        assert.match(joined, /INSERT INTO supermarkets\.receiptitem/);
        assert.match(joined, /UPDATE supermarkets\.inventory/);
        assert.match(joined, /INSERT INTO supermarkets\.payment/);
        assert.match(joined, /\$1/);
        assert.doesNotMatch(joined, /26\.69|25\.45|14\.98|10\.47|73\.31/);
        assert.doesNotMatch(joined, /MLK-101|COL-401/);
        assert.doesNotMatch(joined, /password|postgres:\/\//i);
        assert.equal(result.payment_status, 'approved');
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.saved, true);
        assert.equal(res.body.total, 26.69);
        assert.equal(res.body.payment_status, 'approved');
    });

    test('a cash checkout trace omits the bank update and still records inventory and receipt SQL', async () => {
        addProduct('BAN-001', '0.69', 'exempt', true);
        addInventory(1, 'BAN-001', '10.00');

        const result = await processCheckout({
            store_id: 1,
            payment_method: 'cash',
            account_id: null,
            items: [{ sku: 'BAN-001', weight: 1.5 }]
        });

        const joined = result.sql_statements.join('\n');
        assert.deepEqual(traceText(result.sql_statements), db.log);
        assert.match(joined, /AS taxable_subtotal/);
        assert.doesNotMatch(joined, /UNION ALL/);
        assert.match(joined, /\$3/);
        assert.match(joined, /INSERT INTO supermarkets\.receiptitem/);
        assert.match(joined, /UPDATE supermarkets\.inventory/);
        assert.doesNotMatch(joined, /UPDATE banking\.bankaccount/);
        assert.doesNotMatch(joined, /1\.04|1\.13|BAN-001/);
        assert.equal(compact(result.sql_statements.at(-1)), 'COMMIT');
    });

    test('insufficient funds returns the statements sent before ROLLBACK and no receipt SQL', async () => {
        addProduct('COL-401', '7.49', 'taxable', false);
        addInventory(1, 'COL-401', '20.00');
        addAccount(4, '1.00');

        const payload = {
            store_id: 1,
            payment_method: 'card',
            account_id: 4,
            items: [{ sku: 'COL-401', quantity: 1 }]
        };
        const result = await processCheckout(payload);
        const res = await postCheckout(payload);

        assert.equal(result.saved, false);
        assert.equal(result.message, 'Insufficient funds');
        assert.deepEqual(traceText(result.sql_statements), db.log.slice(0, result.sql_statements.length));
        assert.deepEqual(res.body.sql_statements, result.sql_statements);
        assert.equal(res.statusCode, 200);

        const texts = traceText(result.sql_statements);
        assert.equal(texts[0], 'BEGIN');
        assert.equal(texts.at(-1), 'ROLLBACK');
        assert.equal(texts.includes('COMMIT'), false);
        assert.ok(texts.some((text) => text.startsWith('UPDATE banking.bankaccount')));
        assert.ok(texts.some((text) => text.includes('FROM banking.bankaccount')));
        assert.equal(texts.some((text) => text.includes('INSERT INTO supermarkets.receipt')), false);
        assert.equal(texts.some((text) => text.includes('UPDATE supermarkets.inventory')), false);
        assert.doesNotMatch(result.sql_statements.join('\n'), /COL-401|account_number|password/i);
    });

    test('a stock failure keeps the statements executed before ROLLBACK on the error and the HTTP response', async () => {
        addProduct('COL-401', '7.49', 'taxable', false);
        addInventory(1, 'COL-401', '0.00');
        const payload = {
            store_id: 1,
            payment_method: 'cash',
            account_id: null,
            items: [{ sku: 'COL-401', quantity: 1 }]
        };

        await assert.rejects(
            () => processCheckout(payload),
            (error) => {
                assert.match(error.message, /Insufficient stock for COL-401/);
                const texts = traceText(error.sql_statements);
                assert.deepEqual(texts, db.log);
                assert.equal(texts[0], 'BEGIN');
                assert.equal(texts.at(-1), 'ROLLBACK');
                assert.ok(texts.some((text) => text.includes('FOR UPDATE OF i')));
                assert.equal(texts.some((text) => text.includes('INSERT INTO')), false);
                assert.equal(texts.includes('COMMIT'), false);
                assert.doesNotMatch(error.sql_statements.join('\n'), /COL-401/);
                return true;
            }
        );

        const res = await postCheckout(payload);
        assert.equal(res.statusCode, 400);
        assert.match(res.body.message, /Insufficient stock for COL-401/);
        assert.equal(compact(res.body.sql_statements.at(-1)), 'ROLLBACK');
        assert.ok(res.body.sql_statements.some((statement) => statement.includes('FOR UPDATE OF i')));
        assert.equal(res.body.sql_statements.some((statement) => statement.includes('COMMIT')), false);
    });

    test('an invalid checkout records that no SQL was sent', async () => {
        const res = await postCheckout({ store_id: 1 });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.message, 'Invalid checkout request');
        assert.deepEqual(res.body.sql_statements, []);
        assert.equal(db.log.length, 0);
    });
});
