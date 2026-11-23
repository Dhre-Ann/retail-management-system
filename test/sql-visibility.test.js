'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { describe, test } = require('node:test');

const apiPath = path.join(__dirname, '..', 'js', 'api.js');

function loadApi(fetchImpl) {
    const context = {
        performance: { now: () => 0 },
        fetch: fetchImpl,
        console
    };
    context.globalThis = context;
    vm.runInContext(fs.readFileSync(apiPath, 'utf8'), vm.createContext(context));
    return context.API;
}

function jsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return JSON.stringify(body);
        }
    };
}

function blocks(sql) {
    return String(sql).split('\n\n').map((part) => part.trim()).filter(Boolean);
}

const approvedStatements = [
    'BEGIN',
    'SELECT s.store_id, t.tax_rate\n            FROM supermarkets.store s\n            WHERE s.store_id = $1',
    'SELECT p.sku\n            FROM supermarkets.product p\n            WHERE p.sku = $1 AND i.store_id = $2\n            FOR UPDATE OF i',
    'SELECT ROUND(p.unit_price * $3::numeric, 2) AS line_total\n            FROM supermarkets.product p\n            WHERE p.sku = $1',
    'SELECT SUM(src.line_total) AS subtotal\n            FROM supermarkets.store s\n            WHERE s.store_id = $3',
    'UPDATE banking.bankaccount\n            SET account_balance = account_balance - $1\n            WHERE account_id = $2',
    'INSERT INTO supermarkets.receipt (receipt_id, store_id) VALUES ($1, $2)',
    'INSERT INTO supermarkets.receiptitem (receipt_id, sku) VALUES ($1, $2)',
    'UPDATE supermarkets.inventory SET available_quantity = available_quantity - $1 WHERE store_id = $2 AND sku = $3',
    'INSERT INTO supermarkets.payment (payment_id, account_id, amount) VALUES ($1, $2, $3)',
    'COMMIT'
];

describe('SQL panel text', () => {
    test('a successful checkout shows captured statements in order and hides sensitive values', async () => {
        const api = loadApi(async (url, options) => {
            assert.equal(url, 'http://localhost:3000/api/checkout');
            assert.equal(options.method, 'POST');
            return jsonResponse(200, {
                saved: true,
                receipt_id: 12,
                subtotal: 10,
                tax: 0.83,
                total: 10.83,
                payment_status: 'approved',
                sql_statements: approvedStatements
            });
        });

        const result = await api.checkout({
            store_id: 1,
            payment_method: 'card',
            account_id: 7,
            account_number: '987654321098',
            card_number: '4111111111111111',
            items: [{ sku: 'SECRET-SKU', quantity: 1 }]
        });

        const shown = blocks(result.sql);
        assert.equal(shown[0], 'POST /api/checkout');
        assert.equal(shown[1], 'BEGIN;');
        assert.equal(shown.at(-1), 'COMMIT;');
        assert.equal(shown.length, approvedStatements.length + 1);
        assert.match(result.sql, /SELECT s\.store_id, t\.tax_rate\nFROM supermarkets\.store s\nWHERE s\.store_id = \$1;/);
        assert.match(result.sql, /FOR UPDATE OF i;/);
        assert.match(result.sql, /ROUND\(p\.unit_price \* \$3::numeric, 2\) AS line_total/);
        assert.match(result.sql, /UPDATE banking\.bankaccount/);
        assert.match(result.sql, /INSERT INTO supermarkets\.receipt /);
        assert.match(result.sql, /INSERT INTO supermarkets\.receiptitem/);
        assert.match(result.sql, /UPDATE supermarkets\.inventory/);
        assert.match(result.sql, /INSERT INTO supermarkets\.payment/);
        assert.doesNotMatch(result.sql, /987654321098|4111111111111111|SECRET-SKU|10\.83/);
        assert.doesNotMatch(result.sql, /password|postgres:\/\//i);
        assert.equal(result.data.saved, true);
        assert.equal(result.data.receipt_id, 12);
    });

    test('a failed checkout shows the statements that ran before ROLLBACK', async () => {
        const statements = [
            'BEGIN',
            'SELECT p.sku FROM supermarkets.product p WHERE p.sku = $1 AND i.store_id = $2 FOR UPDATE OF i',
            'ROLLBACK'
        ];
        const api = loadApi(async () => jsonResponse(400, {
            status: 'error',
            message: 'Insufficient stock for SECRET-SKU',
            sql_statements: statements
        }));

        await assert.rejects(
            () => api.checkout({
                store_id: 1,
                payment_method: 'cash',
                account_id: null,
                items: [{ sku: 'SECRET-SKU', quantity: 1 }]
            }),
            (error) => {
                assert.match(error.message, /Insufficient stock for SECRET-SKU/);
                const shown = blocks(error.sql);
                assert.equal(shown[0], 'POST /api/checkout');
                assert.equal(shown[1], 'BEGIN;');
                assert.match(shown[2], /FOR UPDATE OF i;/);
                assert.equal(shown.at(-1), 'ROLLBACK;');
                assert.equal(shown.some((part) => part.startsWith('COMMIT')), false);
                assert.equal(shown.some((part) => part.includes('INSERT INTO supermarkets.receipt')), false);
                assert.doesNotMatch(error.sql, /SECRET-SKU/);
                return true;
            }
        );
    });

    test('validation that sends no SQL says so instead of listing statements', async () => {
        const api = loadApi(async () => jsonResponse(400, {
            status: 'error',
            message: 'Invalid checkout request',
            sql_statements: []
        }));

        await assert.rejects(
            () => api.checkout({ store_id: 'north' }),
            (error) => {
                assert.match(error.message, /Invalid checkout request/);
                assert.match(error.sql, /No SQL was sent to PostgreSQL/);
                assert.doesNotMatch(error.sql, /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/);
                return true;
            }
        );
    });

    test('simulation shows one labeled representative trace for many checkouts', async () => {
        const statements = [
            'BEGIN',
            'INSERT INTO supermarkets.receipt (receipt_id, store_id) VALUES ($1, $2)',
            'COMMIT'
        ];
        const transactions = [];
        for (let i = 0; i < 8; i += 1) {
            transactions.push({
                transaction_number: i + 1,
                store_id: 1,
                payment_method: 'cash',
                selection_count: 10,
                status: 'approved',
                receipt_id: i + 1,
                total: 4,
                execution_ms: 2,
                message: null
            });
        }
        const api = loadApi(async () => jsonResponse(200, {
            run_id: 'run-visibility',
            summary: {
                requested: 8,
                attempted: 8,
                completed: 8,
                approved: 8,
                declined: 0,
                failed: 0,
                cancelled: 0,
                total_sales: 32,
                average_ms: 2,
                min_ms: 2,
                max_ms: 2,
                total_elapsed_ms: 9,
                failure_reasons: [],
                stop_requested: false
            },
            transactions,
            representative_sql: {
                label: 'Representative transaction trace',
                transaction_number: 1,
                outcome: 'approved',
                statements
            }
        }));

        const result = await api.runSimulation({
            transaction_count: 8,
            store_count: 1,
            concurrency: 2
        });

        assert.match(result.sql, /Representative transaction trace/);
        assert.match(result.sql, /transaction 1, approved/);
        assert.match(result.sql, /Other checkouts in this simulation are not listed/);
        assert.equal(result.sql.split('BEGIN;').length - 1, 1);
        assert.match(result.sql, /INSERT INTO supermarkets\.receipt /);
        assert.match(result.sql, /COMMIT;/);
        assert.equal(result.data.transactions.length, 8);
        assert.equal(result.data.summary.approved, 8);
        assert.doesNotMatch(result.sql, /receipt_id": 2|transaction 2/);
    });

    test('a declined simulation trace is labeled and stops at ROLLBACK', async () => {
        const api = loadApi(async () => jsonResponse(200, {
            run_id: 'run-decline',
            summary: {
                requested: 2,
                attempted: 2,
                completed: 2,
                approved: 0,
                declined: 2,
                failed: 0,
                cancelled: 0,
                total_sales: 0,
                average_ms: 1,
                min_ms: 1,
                max_ms: 1,
                total_elapsed_ms: 3,
                failure_reasons: [],
                stop_requested: false
            },
            transactions: [
                { transaction_number: 1, status: 'declined', total: null, execution_ms: 1, message: 'Insufficient funds' },
                { transaction_number: 2, status: 'declined', total: null, execution_ms: 1, message: 'Insufficient funds' }
            ],
            representative_sql: {
                label: 'Representative transaction trace',
                transaction_number: 1,
                outcome: 'declined',
                statements: ['BEGIN', 'UPDATE banking.bankaccount SET account_balance = account_balance - $1 WHERE account_id = $2', 'ROLLBACK']
            }
        }));

        const result = await api.runSimulation({
            transaction_count: 2,
            store_count: 1,
            concurrency: 1
        });

        assert.match(result.sql, /Representative transaction trace/);
        assert.match(result.sql, /transaction 1, declined/);
        assert.equal(blocks(result.sql).at(-1), 'ROLLBACK;');
        assert.doesNotMatch(result.sql, /\bCOMMIT\b/);
        assert.equal(result.sql.split('ROLLBACK;').length - 1, 1);
    });

    test('back office report SQL is unchanged', async () => {
        const urls = [];
        const api = loadApi(async (url) => {
            urls.push(url);
            return jsonResponse(200, []);
        });

        const payments = await api.runReport('payments-by-method');
        const products = await api.browseTable('Product', 10);

        assert.deepEqual(urls, [
            'http://localhost:3000/api/reports/payments-by-method',
            'http://localhost:3000/api/tables/product?limit=10'
        ]);
        assert.equal(payments.sql, [
            'GET /api/reports/payments-by-method',
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
        ].join('\n'));
        assert.equal(products.sql, 'GET /api/tables/product?limit=10\nSELECT * FROM supermarkets.product LIMIT 10;');
        assert.doesNotMatch(payments.sql, /Representative transaction trace|POST \/api\/checkout/);
    });
});
