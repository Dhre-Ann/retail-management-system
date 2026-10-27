// automated checkout simulation
// one catalog snapshot, then processCheckout on a bounded worker pool

const express = require('express');
const pool = require('../db/pool');
const { processCheckout } = require('../services/checkoutService');

const router = express.Router();

const DEFAULT_TRANSACTION_COUNT = 10;
const DEFAULT_CONCURRENCY = 3;
const MIN_SELECTIONS = 10;
const MAX_SELECTIONS = 20;
// keep each sale small so a short demo does not empty the observed stock
const MAX_PACKAGED_QUANTITY = 2;
const MIN_WEIGHT_CENTS = 25;
const MAX_WEIGHT_CENTS = 150;

function parseBoundedInteger(value, fallback, min, max, name) {
    if (value === undefined) {
        return { value: fallback };
    }

    if (!Number.isInteger(value) || value < min || value > max) {
        return {
            error: `${name} must be an integer from ${min} to ${max}`
        };
    }

    return { value };
}

function parseSimulationRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Invalid simulation request' };
    }

    const transactionCount = parseBoundedInteger(
        body.transaction_count,
        DEFAULT_TRANSACTION_COUNT,
        1,
        100,
        'transaction_count'
    );

    if (transactionCount.error) {
        return transactionCount;
    }

    const concurrency = parseBoundedInteger(
        body.concurrency,
        DEFAULT_CONCURRENCY,
        1,
        10,
        'concurrency'
    );

    if (concurrency.error) {
        return concurrency;
    }

    if (concurrency.value > transactionCount.value) {
        return { error: 'concurrency cannot be greater than transaction_count' };
    }

    return {
        transactionCount: transactionCount.value,
        concurrency: concurrency.value
    };
}

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffle(list) {
    const copy = list.slice();

    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const swap = copy[i];
        copy[i] = copy[j];
        copy[j] = swap;
    }

    return copy;
}

function roundMs(value) {
    return Math.round(value * 100) / 100;
}

function roundMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
        return null;
    }
    return Math.round(amount * 100) / 100;
}

function packagedQuantity(available) {
    const onHand = Math.floor(Number(available) + 1e-8);
    if (onHand < 1) {
        return null;
    }
    return randomInt(1, Math.min(onHand, MAX_PACKAGED_QUANTITY));
}

// positive hundredths of a unit, capped by the inventory seen while planning
function weightedAmount(available) {
    const onHandCents = Math.floor(Number(available) * 100 + 1e-8);
    if (onHandCents < 1) {
        return null;
    }

    const cents = randomInt(
        Math.min(MIN_WEIGHT_CENTS, onHandCents),
        Math.min(MAX_WEIGHT_CENTS, onHandCents)
    );

    return cents / 100;
}

function indexStores(rows) {
    const byStore = new Map();

    for (const row of rows) {
        const storeId = Number(row.store_id);
        if (!Number.isInteger(storeId) || typeof row.sku !== 'string' || !row.sku) {
            continue;
        }

        const available = Number(row.available_quantity);
        if (!Number.isFinite(available) || available <= 0) {
            continue;
        }

        const soldByWeight = row.sold_by_weight === true;
        const canSell = soldByWeight
            ? Math.floor(available * 100 + 1e-8) >= 1
            : Math.floor(available + 1e-8) >= 1;

        if (!canSell) {
            continue;
        }

        let products = byStore.get(storeId);
        if (!products) {
            products = [];
            byStore.set(storeId, products);
        }

        if (products.some((product) => product.sku === row.sku)) {
            continue;
        }

        products.push({
            sku: row.sku,
            sold_by_weight: soldByWeight,
            available
        });
    }

    return byStore;
}

// null means no store currently has enough distinct stocked products for a valid sale
function buildPurchase(stores, accountIds) {
    const eligibleStoreIds = [];

    for (const [storeId, products] of stores) {
        if (products.length >= MIN_SELECTIONS) {
            eligibleStoreIds.push(storeId);
        }
    }

    if (eligibleStoreIds.length === 0) {
        return null;
    }

    const storeId = eligibleStoreIds[randomInt(0, eligibleStoreIds.length - 1)];
    const products = stores.get(storeId);
    const selectionCount = randomInt(
        MIN_SELECTIONS,
        Math.min(MAX_SELECTIONS, products.length)
    );
    const items = [];
    const seen = new Set();

    for (const product of shuffle(products)) {
        if (seen.has(product.sku)) {
            continue;
        }
        seen.add(product.sku);

        if (product.sold_by_weight) {
            const weight = weightedAmount(product.available);
            if (weight == null) {
                continue;
            }
            items.push({ sku: product.sku, weight });
        } else {
            const quantity = packagedQuantity(product.available);
            if (quantity == null) {
                continue;
            }
            items.push({ sku: product.sku, quantity });
        }

        if (items.length === selectionCount) {
            break;
        }
    }

    if (items.length < MIN_SELECTIONS) {
        return null;
    }

    const payByCard = accountIds.length > 0 && Math.random() < 0.5;

    return {
        store_id: storeId,
        payment_method: payByCard ? 'card' : 'cash',
        account_id: payByCard
            ? accountIds[randomInt(0, accountIds.length - 1)]
            : null,
        items
    };
}

function emptyResult(transactionNumber, elapsedMs, message) {
    return {
        transaction_number: transactionNumber,
        store_id: null,
        payment_method: null,
        selection_count: 0,
        status: 'failed',
        receipt_id: null,
        total: null,
        execution_ms: roundMs(elapsedMs),
        message
    };
}

function checkoutResult(transactionNumber, payload, elapsedMs, result, error) {
    const base = {
        transaction_number: transactionNumber,
        store_id: payload.store_id,
        payment_method: payload.payment_method,
        selection_count: payload.items.length,
        receipt_id: null,
        total: null,
        execution_ms: roundMs(elapsedMs),
        message: null
    };

    if (error) {
        return {
            ...base,
            status: 'failed',
            message: error.message || 'Checkout failed'
        };
    }

    // approved sale. receipt_id and total come from processCheckout.
    if (result && result.saved === true) {
        return {
            ...base,
            status: 'approved',
            receipt_id: result.receipt_id,
            total: roundMoney(result.total)
        };
    }

    // card declined for lack of funds. the service returns this instead of throwing.
    if (result && result.saved === false) {
        return {
            ...base,
            status: 'declined',
            message: result.message || 'Payment declined'
        };
    }

    return {
        ...base,
        status: 'failed',
        message: 'Unexpected checkout result'
    };
}

async function executePurchase(transactionNumber, stores, accountIds) {
    const plannedAt = performance.now();
    const payload = buildPurchase(stores, accountIds);

    if (!payload) {
        return emptyResult(
            transactionNumber,
            performance.now() - plannedAt,
            'A valid purchase cannot be generated'
        );
    }

    // time the checkout itself, whether it approves, declines, or throws
    const started = performance.now();

    try {
        const result = await processCheckout(payload);
        return checkoutResult(
            transactionNumber,
            payload,
            performance.now() - started,
            result,
            null
        );
    } catch (error) {
        return checkoutResult(
            transactionNumber,
            payload,
            performance.now() - started,
            null,
            error
        );
    }
}

// each worker finishes one checkout before taking another index
async function runTransactions(transactionCount, concurrency, stores, accountIds) {
    const results = new Array(transactionCount);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < transactionCount) {
            const index = nextIndex;
            nextIndex += 1;
            const started = performance.now();

            try {
                results[index] = await executePurchase(
                    index + 1,
                    stores,
                    accountIds
                );
            } catch (error) {
                results[index] = emptyResult(
                    index + 1,
                    performance.now() - started,
                    error.message || 'Checkout failed'
                );
            }
        }
    }

    const workerCount = Math.min(concurrency, transactionCount);
    const workers = [];

    for (let i = 0; i < workerCount; i += 1) {
        workers.push(worker());
    }

    await Promise.all(workers);
    return results;
}

function summarize(requested, transactions, totalElapsedMs) {
    let approved = 0;
    let declined = 0;
    let failed = 0;
    let salesCents = 0;
    let sumMs = 0;
    let minMs = Infinity;
    let maxMs = -Infinity;

    for (const tx of transactions) {
        if (tx.status === 'approved') {
            approved += 1;
            if (Number.isFinite(tx.total)) {
                salesCents += Math.round(tx.total * 100);
            }
        } else if (tx.status === 'declined') {
            declined += 1;
        } else {
            failed += 1;
        }

        sumMs += tx.execution_ms;
        if (tx.execution_ms < minMs) {
            minMs = tx.execution_ms;
        }
        if (tx.execution_ms > maxMs) {
            maxMs = tx.execution_ms;
        }
    }

    const count = transactions.length;

    return {
        requested,
        approved,
        declined,
        failed,
        total_sales: salesCents / 100,
        average_ms: count ? roundMs(sumMs / count) : 0,
        min_ms: count ? roundMs(minMs) : 0,
        max_ms: count ? roundMs(maxMs) : 0,
        total_elapsed_ms: roundMs(totalElapsedMs)
    };
}

async function loadCatalog() {
    // one inventory read for every store, not a query per product
    const [stock, accounts] = await Promise.all([
        pool.query(`
            SELECT i.store_id, p.sku, p.sold_by_weight, i.available_quantity
            FROM supermarkets.inventory i
            JOIN supermarkets.product p ON p.sku = i.sku
            WHERE i.available_quantity > 0
        `),
        pool.query(`
            SELECT account_id
            FROM banking.bankaccount
        `)
    ]);

    return {
        stores: indexStores(stock.rows),
        accountIds: accounts.rows
            .map((row) => Number(row.account_id))
            .filter((accountId) => Number.isInteger(accountId))
    };
}

router.post('/simulate', async (req, res) => {
    const parsed = parseSimulationRequest(req.body);

    if (parsed.error) {
        return res.status(400).json({
            status: 'error',
            message: parsed.error
        });
    }

    const started = performance.now();

    try {
        const catalog = await loadCatalog();
        // the snapshot is not reduced here. processCheckout decides stock and funds.
        const transactions = await runTransactions(
            parsed.transactionCount,
            parsed.concurrency,
            catalog.stores,
            catalog.accountIds
        );

        res.json({
            summary: summarize(
                parsed.transactionCount,
                transactions,
                performance.now() - started
            ),
            transactions
        });
    } catch (error) {
        console.error('Simulation error:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Unable to run simulation'
        });
    }
});

module.exports = router;
