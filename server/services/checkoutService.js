// one checkout transaction, shared by the manual checkout route

const pool = require('../db/pool');

// Approved sale:
//   { saved: true, receipt_id, subtotal, tax, total, payment_status: 'approved' }
// Card declined for lack of funds:
//   { saved: false, message: 'Insufficient funds' }
// Invalid input throws Error('Invalid checkout request') with statusCode 400.
// A missing database connection throws statusCode 500.
// An unknown bank account throws Error('Bank account not found') with statusCode 400.
// Store, stock, product, and SQL failures throw Error with the same message as before.
// The route turns thrown errors into the HTTP response.

// The hundredths already accepted by the weight and quantity checks.
function amountParam(amount) {
    return (Math.round(amount * 100) / 100).toFixed(2);
}

// One SELECT branch per line. PostgreSQL sums the rounded line totals,
// keeps a taxable subtotal, and rounds tax once.
function pricingTotalsSql(lineCount) {
    const parts = [];

    for (let i = 0; i < lineCount; i += 1) {
        const lineParam = i * 2 + 1;
        const treatmentParam = lineParam + 1;
        parts.push(
            `SELECT $${lineParam}::numeric(10,2) AS line_total, $${treatmentParam}::text AS tax_treatment`
        );
    }

    const storeParam = lineCount * 2 + 1;

    return `
        SELECT
            SUM(src.line_total)::numeric(10,2) AS subtotal,
            SUM(CASE
                WHEN src.tax_treatment = 'taxable' THEN src.line_total
                ELSE 0
            END)::numeric(10,2) AS taxable_subtotal,
            ROUND(
                SUM(CASE
                    WHEN src.tax_treatment = 'taxable' THEN src.line_total
                    ELSE 0
                END) * t.tax_rate,
                2
            ) AS tax_amount,
            (
                SUM(src.line_total) + ROUND(
                    SUM(CASE
                        WHEN src.tax_treatment = 'taxable' THEN src.line_total
                        ELSE 0
                    END) * t.tax_rate,
                    2
                )
            )::numeric(10,2) AS total_amount
        FROM (
            ${parts.join('\n            UNION ALL\n            ')}
        ) AS src
        INNER JOIN supermarkets.store s ON s.store_id = $${storeParam}
        INNER JOIN supermarkets.statetax t ON s.state = t.state
        GROUP BY t.tax_rate
    `;
}

async function processCheckout(payload) {
    const { store_id, payment_method, account_id, items } = payload;

    // validating the request before opening a transaction
    if (!Number.isInteger(store_id) ||
        !['cash', 'card'].includes(payment_method) ||
        !Array.isArray(items) || items.length === 0 ||
        (payment_method === 'card' && !Number.isInteger(account_id)) ||
        (payment_method === 'cash' && account_id != null)) {
        const error = new Error('Invalid checkout request');
        error.statusCode = 400;
        throw error;
    }

    // request validated successfully
    // connecting to the database
    const client = await pool.connect().catch(() => null);

    if (!client) {
        const error = new Error('Database connection failed');
        error.statusCode = 500;
        throw error;
    }

    try {
        await client.query('BEGIN');

        // retrieving store and state tax
        const storeResult = await client.query(`
            SELECT s.store_id, t.tax_rate
            FROM supermarkets.store s
            INNER JOIN supermarkets.statetax t ON s.state = t.state
            WHERE s.store_id = $1
        `, [store_id]);

        // checking if store exists
        if (!storeResult.rows.length) {
            throw new Error('Store not found');
        }

        const purchasedItems = [];
        const seen = new Set();

        // validating products, retrieving prices, and locking inventory
        // note: sorting SKUs gives concurrent checkouts a consistent lock order
        const sortedItems = [...items].sort((a, b) =>
            String(a?.sku ?? '').localeCompare(String(b?.sku ?? ''))
        );

        for (const item of sortedItems) {
            if (!item || typeof item.sku !== 'string' ||
                seen.has(item.sku)) {
                throw new Error('Invalid or duplicate SKU');
            }

            seen.add(item.sku);

            const result = await client.query(`
                SELECT p.sku, p.unit_price, p.tax_treatment,
                       p.sold_by_weight, i.available_quantity
                FROM supermarkets.product p
                INNER JOIN supermarkets.inventory i ON i.sku = p.sku
                WHERE p.sku = $1 AND i.store_id = $2
                FOR UPDATE OF i
            `, [item.sku, store_id]);

            if (!result.rows.length) {
                throw new Error(`Product ${item.sku} is not stocked here`);
            }

            const product = result.rows[0];
            const weighed = product.sold_by_weight;

            const amount = weighed
                ? Number(item.weight)
                : Number(item.quantity);

            if (weighed
                ? item.quantity != null || !Number.isFinite(amount) ||
                  amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8
                : item.weight != null || !Number.isSafeInteger(amount) ||
                  amount <= 0) {
                throw new Error(`Invalid quantity or weight for ${item.sku}`);
            }

            if (Number(product.available_quantity) < amount) {
                throw new Error(`Insufficient stock for ${item.sku}`);
            }

            // price and line total come from PostgreSQL while the inventory lock is held
            const priced = await client.query(`
                SELECT p.unit_price,
                       p.tax_treatment,
                       ROUND(p.unit_price * $3::numeric, 2) AS line_total
                FROM supermarkets.product p
                INNER JOIN supermarkets.inventory i ON i.sku = p.sku
                WHERE p.sku = $1 AND i.store_id = $2
            `, [item.sku, store_id, amountParam(amount)]);

            if (!priced.rows.length) {
                throw new Error(`Product ${item.sku} is not stocked here`);
            }

            const line = priced.rows[0];

            purchasedItems.push({
                sku: item.sku,
                quantity: weighed ? null : amount,
                weight: weighed ? amount : null,
                unit_price: line.unit_price,
                line_total: line.line_total,
                tax_treatment: line.tax_treatment,
                amount
            });
        }

        const totalParams = [];
        for (const line of purchasedItems) {
            totalParams.push(line.line_total, line.tax_treatment);
        }
        totalParams.push(store_id);

        const totalsResult = await client.query(
            pricingTotalsSql(purchasedItems.length),
            totalParams
        );

        if (!totalsResult.rows.length) {
            throw new Error('Store not found');
        }

        const totals = totalsResult.rows[0];
        const subtotal = totals.subtotal;
        const taxAmount = totals.tax_amount;
        const totalAmount = totals.total_amount;

        // check and debit bank account for card payments
        if (payment_method === 'card') {
            const debit = await client.query(`
                UPDATE banking.bankaccount
                SET account_balance = account_balance - $1
                WHERE account_id = $2
                  AND account_balance >= $1
                RETURNING account_id
            `, [totalAmount, account_id]);

            if (!debit.rows.length) {
                const account = await client.query(`
                    SELECT account_id
                    FROM banking.bankaccount
                    WHERE account_id = $1
                `, [account_id]);

                await client.query('ROLLBACK');

                if (!account.rows.length) {
                    // already rolled back, so the catch below must not roll back again
                    const error = new Error('Bank account not found');
                    error.statusCode = 400;
                    error.rolledBack = true;
                    throw error;
                }

                return {
                    saved: false,
                    message: 'Insufficient funds'
                };
            }
        }

        // generating receipt ID and inserting receipt
        await client.query('SELECT pg_advisory_xact_lock(3380, 1)');

        const receiptResult = await client.query(`
            INSERT INTO supermarkets.receipt
                (receipt_id, store_id, receipt_date, receipt_time,
                 subtotal, tax_amount, total_amount)
            VALUES (
                (SELECT COALESCE(MAX(receipt_id), 0) + 1
                 FROM supermarkets.receipt),
                $1, CURRENT_DATE, LOCALTIME,
                $2, $3, $4
            )
            RETURNING receipt_id
        `, [
            store_id,
            subtotal,
            taxAmount,
            totalAmount
        ]);

        const receiptId = receiptResult.rows[0].receipt_id;

        // inserting receipt lines and deducting inventory
        for (let i = 0; i < purchasedItems.length; i++) {
            const item = purchasedItems[i];

            await client.query(`
                INSERT INTO supermarkets.receiptitem
                    (receipt_id, receipt_line_number, sku,
                     quantity, weight, unit_price, line_total)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                receiptId, i + 1, item.sku,
                item.quantity, item.weight,
                item.unit_price, item.line_total
            ]);

            await client.query(`
                UPDATE supermarkets.inventory
                SET available_quantity = available_quantity - $1
                WHERE store_id = $2 AND sku = $3
            `, [item.amount, store_id, item.sku]);
        }

        // recording the approved payment
        await client.query('SELECT pg_advisory_xact_lock(3380, 2)');

        await client.query(`
            INSERT INTO supermarkets.payment
                (payment_id, receipt_id, account_id, payment_method,
                 amount, payment_date, payment_time, payment_status)
            VALUES (
                (SELECT COALESCE(MAX(payment_id), 0) + 1
                 FROM supermarkets.payment),
                $1, $2, $3, $4, CURRENT_DATE, LOCALTIME, 'approved'
            )
        `, [
            receiptId,
            payment_method === 'card' ? account_id : null,
            payment_method,
            totalAmount
        ]);

        // committing the transaction
        await client.query('COMMIT');

        return {
            saved: true,
            receipt_id: receiptId,
            subtotal: Number(subtotal),
            tax: Number(taxAmount),
            total: Number(totalAmount),
            payment_status: 'approved'
        };

    } catch (error) {
        if (!error.rolledBack) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('Checkout error:', error.message);
        }

        throw error;
    } finally {
        client.release();
    }
}

module.exports = { processCheckout };
