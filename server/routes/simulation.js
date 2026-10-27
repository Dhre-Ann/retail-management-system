// automated checkout simulation
// one catalog snapshot, then processCheckout on a bounded worker pool

const express = require('express');
const pool = require('../db/pool');
const { processCheckout } = require('../services/checkoutService');

const router = express.Router();

const DEFAULT_TRANSACTION_COUNT = 10;
const DEFAULT_CONCURRENCY = 3;
const MIN_ITEMS = 10;
const MAX_ITEMS = 20;
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

    if (!Number.isInteger(body.store_count) || body.store_count < 1) {
        return { error: 'store_count must be an integer of at least 1' };
    }

    if (body.store_count > transactionCount.value) {
        return {
            error: 'store_count cannot be greater than transaction_count. Each transaction is one store purchase.'
        };
    }

    return {
        transactionCount: transactionCount.value,
        concurrency: concurrency.value,
        storeCount: body.store_count
    };
}

function sampleDistinct(list, count) {
    const copy = list.slice();

    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = randomInt(0, i);
        const swap = copy[i];
        copy[i] = copy[j];
        copy[j] = swap;
    }

    return copy.slice(0, count);
}

function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
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

function stockCents(available) {
    return Math.floor(Number(available) * 100 + 1e-8);
}

function packagedUnits(available) {
    const onHand = Math.floor(Number(available) + 1e-8);
    return onHand >= 1 ? onHand : 0;
}

// smallest weight the existing hundredths rule can sell from this balance
function minimumWeightCents(cents) {
    if (cents < 1) {
        return 0;
    }
    return Math.min(MIN_WEIGHT_CENTS, cents);
}

// how many weighted entries fit if each one keeps a valid positive weight
function weightedEntries(available) {
    let cents = stockCents(available);
    let count = 0;

    while (true) {
        const draw = minimumWeightCents(cents);
        if (draw < 1) {
            break;
        }
        cents -= draw;
        count += 1;
    }

    return count;
}

function itemCapacity(product) {
    return product.sold_by_weight
        ? weightedEntries(product.available)
        : packagedUnits(product.available);
}

function reserveLaterCents(cents, laterEntries) {
    let left = cents;
    let reserved = 0;

    for (let i = 0; i < laterEntries; i += 1) {
        const draw = minimumWeightCents(left);
        if (draw < 1) {
            return -1;
        }
        reserved += draw;
        left -= draw;
    }

    return reserved;
}

// one weight per selected entry, then summed onto a single checkout line
function aggregateWeight(available, entries) {
    let centsLeft = stockCents(available);
    let totalCents = 0;

    for (let i = 0; i < entries; i += 1) {
        const reserved = reserveLaterCents(centsLeft, entries - i - 1);
        if (reserved < 0) {
            return null;
        }

        const maxCents = centsLeft - reserved;
        const minCents = minimumWeightCents(maxCents);
        const cappedMax = Math.min(MAX_WEIGHT_CENTS, maxCents);
        if (minCents < 1 || minCents > cappedMax) {
            return null;
        }

        const drawn = randomInt(minCents, cappedMax);
        totalCents += drawn;
        centsLeft -= drawn;
    }

    if (totalCents < 1 || totalCents > stockCents(available)) {
        return null;
    }

    return totalCents / 100;
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

function eligibleStoreIds(stores) {
    const ids = [];

    for (const [storeId, products] of stores) {
        const capacity = products.reduce((sum, product) => sum + itemCapacity(product), 0);
        if (capacity >= MIN_ITEMS) {
            ids.push(storeId);
        }
    }

    return ids;
}

// The first storeCount assignments cover every selected store.
// Later purchases stay inside that same set.
function assignStores(chosen, transactionCount) {
    const assignments = chosen.slice();

    while (assignments.length < transactionCount) {
        assignments.push(chosen[randomInt(0, chosen.length - 1)]);
    }

    for (let i = assignments.length - 1; i > 0; i -= 1) {
        const j = randomInt(0, i);
        const swap = assignments[i];
        assignments[i] = assignments[j];
        assignments[j] = swap;
    }

    return assignments;
}

// null means this store cannot fill a 10-to-20 item purchase
function buildPurchase(stores, accountIds, storeId) {
    const products = stores.get(storeId);
    if (!products) {
        return null;
    }
    const capacity = products.reduce((sum, product) => sum + itemCapacity(product), 0);
    if (capacity < MIN_ITEMS) {
        return null;
    }
    const itemCount = randomInt(MIN_ITEMS, Math.min(MAX_ITEMS, capacity));
    const remaining = new Map();

    products.forEach((product) => {
        remaining.set(product.sku, itemCapacity(product));
    });

    const picks = new Map();

    for (let n = 0; n < itemCount; n += 1) {
        const choices = products.filter((product) => remaining.get(product.sku) > 0);
        if (choices.length === 0) {
            return null;
        }

        const chosen = choices[randomInt(0, choices.length - 1)];
        remaining.set(chosen.sku, remaining.get(chosen.sku) - 1);
        picks.set(chosen.sku, (picks.get(chosen.sku) || 0) + 1);
    }

    const items = [];

    for (const product of products) {
        const count = picks.get(product.sku) || 0;
        if (count < 1) {
            continue;
        }

        if (product.sold_by_weight) {
            const weight = aggregateWeight(product.available, count);
            if (weight == null) {
                return null;
            }
            items.push({ sku: product.sku, weight });
        } else if (count <= packagedUnits(product.available)) {
            items.push({ sku: product.sku, quantity: count });
        } else {
            return null;
        }
    }

    const purchasedItems = items.reduce((sum, item) => {
        return sum + (item.quantity == null ? 0 : item.quantity);
    }, 0);
    const weightedPicks = Array.from(picks.entries()).reduce((sum, [sku, count]) => {
        const product = products.find((candidate) => candidate.sku === sku);
        return sum + (product && product.sold_by_weight ? count : 0);
    }, 0);

    if (purchasedItems + weightedPicks !== itemCount || items.length === 0) {
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

function emptyResult(transactionNumber, elapsedMs, message, storeId) {
    return {
        transaction_number: transactionNumber,
        store_id: Number.isInteger(storeId) ? storeId : null,
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

async function executePurchase(transactionNumber, stores, accountIds, storeId) {
    const plannedAt = performance.now();
    const payload = buildPurchase(stores, accountIds, storeId);

    if (!payload) {
        return emptyResult(
            transactionNumber,
            performance.now() - plannedAt,
            'A valid purchase cannot be generated',
            storeId
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
async function runTransactions(transactionCount, concurrency, stores, accountIds, assignments) {
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
                    accountIds,
                    assignments[index]
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
        const eligible = eligibleStoreIds(catalog.stores);

        if (parsed.storeCount > eligible.length) {
            const noun = eligible.length === 1 ? 'store' : 'stores';
            return res.status(400).json({
                status: 'error',
                message: `Only ${eligible.length} ${noun} can support a valid purchase.`
            });
        }

        const chosen = sampleDistinct(eligible, parsed.storeCount);
        const assignments = assignStores(chosen, parsed.transactionCount);
        // the snapshot is not reduced here. processCheckout decides stock and funds.
        const transactions = await runTransactions(
            parsed.transactionCount,
            parsed.concurrency,
            catalog.stores,
            catalog.accountIds,
            assignments
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
