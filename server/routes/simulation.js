// automated checkout simulation
// one catalog snapshot, then processCheckout on a bounded worker pool

const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const { processCheckout } = require('../services/checkoutService');
const { ensureSimulationDatabase } = require('../services/databaseInit');

const router = express.Router();

const DEFAULT_TRANSACTION_COUNT = 10;
const DEFAULT_CONCURRENCY = 3;
const MIN_ITEMS = 10;
const MAX_ITEMS = 20;
const MIN_WEIGHT_CENTS = 25;
const MAX_WEIGHT_CENTS = 150;
const RECENT_RECEIPT_LIMIT = 100;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const EARLY_CANCEL_TTL_MS = 5 * 60 * 1000;
const EARLY_CANCEL_LIMIT = 1000;

// runId -> { cancelled }. Workers read the flag before taking another checkout.
const activeRuns = new Map();
// A Stop can reach the server before its run request does. Remember it briefly.
const earlyCancels = new Map();

function pruneEarlyCancels(now) {
    for (const [runId, at] of earlyCancels) {
        if (now - at > EARLY_CANCEL_TTL_MS || earlyCancels.size > EARLY_CANCEL_LIMIT) {
            earlyCancels.delete(runId);
        }
    }
}

function takeEarlyCancel(runId) {
    pruneEarlyCancels(Date.now());
    const found = earlyCancels.has(runId);
    earlyCancels.delete(runId);
    return found;
}

// Whitelisted intervals. The SQL value is a bound parameter, never concatenated.
const RECEIPT_INTERVALS = {
    '5min': { label: '5 minutes', sql: '5 minutes' },
    '15min': { label: '15 minutes', sql: '15 minutes' },
    '1hour': { label: '1 hour', sql: '1 hour' },
    '24hour': { label: '24 hours', sql: '24 hours' }
};

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

    if (body.run_id !== undefined &&
        (typeof body.run_id !== 'string' || !RUN_ID_PATTERN.test(body.run_id))) {
        return {
            error: 'run_id must be 8 to 64 letters, digits, hyphens, or underscores'
        };
    }

    return {
        transactionCount: transactionCount.value,
        concurrency: concurrency.value,
        storeCount: body.store_count,
        runId: body.run_id
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

function cancelledResult(transactionNumber, storeId) {
    return {
        transaction_number: transactionNumber,
        store_id: Number.isInteger(storeId) ? storeId : null,
        payment_method: null,
        selection_count: 0,
        status: 'cancelled',
        receipt_id: null,
        total: null,
        execution_ms: null,
        message: 'Not started because the simulation was stopped'
    };
}

// each worker finishes one checkout before taking another index.
// After Stop, no worker takes a new index; checkouts already started finish normally.
async function runTransactions(transactionCount, concurrency, stores, accountIds, assignments, run) {
    const results = new Array(transactionCount);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < transactionCount && !(run && run.cancelled)) {
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

    for (let i = 0; i < transactionCount; i += 1) {
        if (!results[i]) {
            results[i] = cancelledResult(i + 1, assignments[i]);
        }
    }

    return results;
}

function failureReasons(transactions) {
    const counts = new Map();

    for (const tx of transactions) {
        if (tx.status !== 'failed') {
            continue;
        }
        const message = tx.message || 'Checkout failed';
        counts.set(message, (counts.get(message) || 0) + 1);
    }

    return Array.from(counts, ([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
}

function summarize(requested, transactions, totalElapsedMs, stopRequested = false) {
    let approved = 0;
    let declined = 0;
    let failed = 0;
    let cancelled = 0;
    let salesCents = 0;
    let sumMs = 0;
    let minMs = Infinity;
    let maxMs = -Infinity;

    for (const tx of transactions) {
        // never started, so it has no timing and no revenue
        if (tx.status === 'cancelled') {
            cancelled += 1;
            continue;
        }

        // Revenue is approved receipts only. Declined and failed totals are ignored.
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

    const attempted = transactions.length - cancelled;
    const completed = approved + declined;

    return {
        requested,
        attempted,
        completed,
        approved,
        declined,
        failed,
        cancelled,
        stop_requested: Boolean(stopRequested),
        failure_reasons: failureReasons(transactions),
        total_sales: salesCents / 100,
        average_ms: attempted ? roundMs(sumMs / attempted) : 0,
        min_ms: attempted ? roundMs(minMs) : 0,
        max_ms: attempted ? roundMs(maxMs) : 0,
        total_elapsed_ms: roundMs(totalElapsedMs)
    };
}

function receiptActivityRow(row) {
    return {
        receipt_id: Number(row.receipt_id),
        store_id: Number(row.store_id),
        store_name: row.store_name == null ? null : String(row.store_name),
        receipt_date: row.receipt_date == null ? null : String(row.receipt_date),
        receipt_time: row.receipt_time == null ? null : String(row.receipt_time),
        subtotal: roundMoney(row.subtotal),
        tax_amount: roundMoney(row.tax_amount),
        total_amount: roundMoney(row.total_amount),
        payment_method: row.payment_method == null ? null : String(row.payment_method),
        payment_status: row.payment_status == null ? null : String(row.payment_status)
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

router.get('/simulate/receipts', async (req, res) => {
    const interval = RECEIPT_INTERVALS[req.query.interval];

    if (!interval) {
        return res.status(400).json({
            status: 'error',
            message: 'interval must be one of 5min, 15min, 1hour, or 24hour'
        });
    }

    try {
        const result = await pool.query(`
            SELECT
                r.receipt_id,
                r.store_id,
                s.store_name,
                to_char(r.receipt_date, 'YYYY-MM-DD') AS receipt_date,
                to_char(r.receipt_time, 'HH24:MI:SS') AS receipt_time,
                r.subtotal,
                r.tax_amount,
                r.total_amount,
                p.payment_method,
                p.payment_status
            FROM supermarkets.receipt r
            JOIN supermarkets.store s ON s.store_id = r.store_id
            LEFT JOIN supermarkets.payment p ON p.receipt_id = r.receipt_id
            WHERE (r.receipt_date + r.receipt_time) >= LOCALTIMESTAMP - $1::interval
            ORDER BY r.receipt_date DESC, r.receipt_time DESC, r.receipt_id DESC
            LIMIT $2
        `, [interval.sql, RECENT_RECEIPT_LIMIT + 1]);

        const truncated = result.rows.length > RECENT_RECEIPT_LIMIT;
        res.json({
            interval: req.query.interval,
            label: interval.label,
            truncated,
            rows: result.rows.slice(0, RECENT_RECEIPT_LIMIT).map(receiptActivityRow)
        });
    } catch (error) {
        console.error('Recent receipts error:', error.message);
        const missing = /does not exist/i.test(error.message);
        res.status(500).json({
            status: 'error',
            message: missing
                ? 'Recent receipts failed: the receipt tables are missing. Run Simulation to create them, then try again.'
                : 'Unable to load recent receipts.'
        });
    }
});

// Stop for one run. Repeated calls are safe and change nothing after the first.
router.post('/simulate/:runId/cancel', (req, res) => {
    const { runId } = req.params;

    if (!RUN_ID_PATTERN.test(runId)) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid simulation run id'
        });
    }

    const run = activeRuns.get(runId);

    if (!run) {
        earlyCancels.set(runId, Date.now());
        pruneEarlyCancels(Date.now());
        return res.json({
            status: 'success',
            state: 'not_running',
            message: 'No running simulation has this id. If it starts, it will not run any checkouts.'
        });
    }

    const already = run.cancelled;
    run.cancelled = true;
    res.json({
        status: 'success',
        state: already ? 'already_stopping' : 'stopping',
        message: already
            ? 'Stop was already requested for this simulation.'
            : 'Stop requested. No new checkouts will start. Checkouts already running will finish.'
    });
});

router.post('/simulate', async (req, res) => {
    const parsed = parseSimulationRequest(req.body);

    if (parsed.error) {
        return res.status(400).json({
            status: 'error',
            message: parsed.error
        });
    }

    const runId = parsed.runId || crypto.randomUUID();

    if (activeRuns.has(runId)) {
        return res.status(409).json({
            status: 'error',
            message: 'A simulation with this run id is already running.'
        });
    }

    // registered before setup so a Stop during initialization is not lost
    const run = { cancelled: takeEarlyCancel(runId) };
    activeRuns.set(runId, run);

    try {
        await runSimulation(parsed, runId, run, res);
    } finally {
        activeRuns.delete(runId);
    }
});

async function runSimulation(parsed, runId, run, res) {
    try {
        await ensureSimulationDatabase();
    } catch (error) {
        console.error('Simulation initialization error:', error.message);
        return res.status(500).json({
            status: 'error',
            message: error.message || 'Simulation did not start: database setup failed.'
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
            assignments,
            run
        );

        res.json({
            run_id: runId,
            summary: summarize(
                parsed.transactionCount,
                transactions,
                performance.now() - started,
                run.cancelled
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
}

module.exports = router;
module.exports.summarize = summarize;
