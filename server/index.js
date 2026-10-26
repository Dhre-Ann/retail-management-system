// this file will contain the express server entry point

const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');
const fs = require('fs/promises');
const path = require('path');
const app = express();

app.use(express.json());
app.use(cors());

// start the server
app.listen(3000, () => {
    console.log('Server is running on port 3000');
});

// test the db connection
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() AS server_time');

        res.json({
            status: 'success',
            message: 'Connected to PostgreSQL successfully!',
            server_time: result.rows[0].server_time
        });
    } catch (error) {
        console.error('Database connection error:', error.message);

        res.status(500).json({
            status: 'error',
            message: 'Unable to connect to PostgreSQL'
        });
    }
});




// endpoint to create tables
app.post('/api/create-tables', async (req, res) => {
    const client = await pool.connect();

    try {
        const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
        const sql = await fs.readFile(schemaPath, 'utf8');

        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');

        res.json({
            status: 'success',
            message: 'Database tables created successfully.'
        });

    } catch (error) {
        await client.query('ROLLBACK');

        console.error('Error creating tables:', error.message);

        res.status(500).json({
            status: 'error',
            message: error.message
        });

    } finally {
        client.release();
    }
});

// endpoint to initialize with seed data
app.post('/api/initialize', async (req, res) => {
    const client = await pool.connect();

    try {
        const seedPath = path.join(__dirname, '..', 'sql', 'seed.sql');
        const sql = await fs.readFile(seedPath, 'utf8');

        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');

        res.json({
            status: 'success',
            message: 'Database seeded successfully.'
        });

    } catch (error) {
        await client.query('ROLLBACK');

        console.error('Error seeding data:', error.message);

        res.status(500).json({
            status: 'error',
            message: error.message
        });

    } finally {
        client.release();
    }
});

// endpoint to query stores table and return a list of stores as JSON
app.get('/api/stores', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supermarkets.store');
        res.json(result.rows);
    } catch (error) {
        console.error('Error querying stores table:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Unable to query stores'
        });
    }
});

// endpoint to get products
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM supermarkets.product');
        res.json(result.rows);
    } catch (error) {
        console.error('Error querying products table:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Unable to query products'
        });
    }
});

// endpoint to get inventory for store
app.get('/api/inventory/:storeId', async (req, res) => {
    try {
        const { storeId } = req.params;

        const result = await pool.query(
            'SELECT * FROM supermarkets.inventory WHERE store_id = $1',
            [storeId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error('Error querying inventory:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Unable to query inventory'
        });
    }
});

// get receipt by id
app.get('/api/receipts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM supermarkets.receipt WHERE receipt_id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Receipt not found'
            });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error querying receipts table:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Unable to query receipts'
        });
    }
});

// endpoint to get bank accounts
app.get('/api/bank-accounts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM banking.bankaccount');
        res.json(result.rows);
    } catch (error) {
        console.error('Error querying bank accounts table:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Unable to query bank accounts'
        });
    }
});

// allowed tables and their schemas
const allowedTables = {
    statetax: 'supermarkets',
    store: 'supermarkets',
    product: 'supermarkets',
    inventory: 'supermarkets',
    receipt: 'supermarkets',
    receiptitem: 'supermarkets',
    payment: 'supermarkets',
    bankaccount: 'banking'
};

// endpoint to browse table records (minimum 10 records)
app.get('/api/tables/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const schema = allowedTables[tableName];

    if (!schema) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid table name'
        });
    }

    // Default to 10 rows, allow 25, 50, or 100
    const limit = req.query.limit === undefined
        ? 10
        : Number(req.query.limit);

    const allowedLimits = [10, 25, 50, 100];

    if (!allowedLimits.includes(limit)) {
        return res.status(400).json({
            status: 'error',
            message: 'Limit must be 10, 25, 50, or 100'
        });
    }

    try {
        const result = await pool.query(
            `SELECT * FROM ${schema}.${tableName} LIMIT $1`,
            [limit]
        );

        res.json(result.rows);

    } catch (error) {
        console.error('Error browsing table:', error.message);

        res.status(500).json({
            status: 'error',
            message: 'Unable to browse table'
        });
    }
});

// endpoint to delete all rows from a table
app.delete('/api/tables/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const schema = allowedTables[tableName];

    if (!schema) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid table name'
        });
    }

    try {
        const result = await pool.query(
            `DELETE FROM ${schema}.${tableName}`
        );

        res.json({
            status: 'success',
            message: `${result.rowCount} rows deleted from ${tableName}.`
        });

    } catch (error) {
        console.error('Error deleting rows:', error.message);

        res.status(500).json({
            status: 'error',
            message: 'Unable to delete rows. The table may be referenced by other tables.'
        });
    }
});

// endpoint to simulate a checkout transaction
app.post('/api/checkout', async (req, res) => {
    const { store_id, payment_method, account_id, items } = req.body;

    // validating the request before opening a transaction
    if (!Number.isInteger(store_id) ||
        !['cash', 'card'].includes(payment_method) ||
        !Array.isArray(items) || items.length === 0 ||
        (payment_method === 'card' && !Number.isInteger(account_id)) ||
        (payment_method === 'cash' && account_id != null)) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid checkout request'
        });
    }
    // request validated successfully
    // connecting to the database
    const client = await pool.connect().catch(() => null);

    if (!client) {
        return res.status(500).json({
            status: 'error',
            message: 'Database connection failed'
        });
    }

    try {
        await client.query('BEGIN');

        // retrieving store and state tax
        const storeResult = await client.query(`
            SELECT s.store_id, t.tax_rate
            FROM supermarkets.store s
            JOIN supermarkets.statetax t ON s.state = t.state
            WHERE s.store_id = $1
        `, [store_id]);

        // checking if store exists
        if (!storeResult.rows.length) {
            throw new Error('Store not found');
        }

        const taxRate = Number(storeResult.rows[0].tax_rate);
        let subtotalCents = 0;
        let taxableCents = 0;
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
                JOIN supermarkets.inventory i ON i.sku = p.sku
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

            // rounding each line to cents
            const lineCents = Math.round(
                Number(product.unit_price) * amount * 100
            );

            subtotalCents += lineCents;

            if (product.tax_treatment === 'taxable') {
                taxableCents += lineCents;
            }

            purchasedItems.push({
                sku: item.sku,
                quantity: weighed ? null : amount,
                weight: weighed ? amount : null,
                unit_price: product.unit_price,
                line_total: (lineCents / 100).toFixed(2),
                amount
            });
        }

        const taxCents = Math.round(taxableCents * taxRate);
        const totalCents = subtotalCents + taxCents;
        const total = (totalCents / 100).toFixed(2);

        // check and debit bank account for card payments
        if (payment_method === 'card') {
            const debit = await client.query(`
                UPDATE banking.bankaccount
                SET account_balance = account_balance - $1
                WHERE account_id = $2
                  AND account_balance >= $1
                RETURNING account_id
            `, [total, account_id]);

            if (!debit.rows.length) {
                const account = await client.query(`
                    SELECT account_id
                    FROM banking.bankaccount
                    WHERE account_id = $1
                `, [account_id]);

                await client.query('ROLLBACK');

                if (!account.rows.length) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Bank account not found'
                    });
                }

                return res.json({
                    saved: false,
                    message: 'Insufficient funds'
                });
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
            (subtotalCents / 100).toFixed(2),
            (taxCents / 100).toFixed(2),
            total
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
            total
        ]);

        // committing the transaction
        await client.query('COMMIT');

        res.json({
            saved: true,
            receipt_id: receiptId,
            subtotal: subtotalCents / 100,
            tax: taxCents / 100,
            total: totalCents / 100,
            payment_status: 'approved'
        });

    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});

        console.error('Checkout error:', error.message);

        res.status(400).json({
            status: 'error',
            message: error.message
        });
    } finally {
        client.release();
    }
});



// ---------------------- BACK OFFICE REPORTS ----------------------

// endpoint to get sales per store - Q1
app.get('/api/reports/sales-by-store', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                status: 'error',
                message: 'Start date and end date are required'
            });
        }

        const result = await pool.query(`
            SELECT
                s.store_id,
                s.store_name,
                s.city,
                s.state,
                COUNT(r.receipt_id) AS num_receipts,
                COALESCE(SUM(r.total_amount), 0) AS total_sales
            FROM supermarkets.store s
            LEFT JOIN supermarkets.receipt r
                ON r.store_id = s.store_id
                AND r.receipt_date BETWEEN $1 AND $2
            GROUP BY s.store_id, s.store_name, s.city, s.state
            ORDER BY total_sales DESC
        `, [start_date, end_date]);

        res.json(result.rows);

    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// endpoint to get top selling products - Q2
app.get('/api/reports/top-products', async (req, res) => {
    try {
        const limit = Number(req.query.limit ?? 10);

        if (![10, 25, 50, 100].includes(limit)) {
            return res.status(400).json({
                status: 'error',
                message: 'Limit must be 10, 25, 50, or 100'
            });
        }

        const result = await pool.query(`
            SELECT
                p.sku,
                p.product_name,
                p.category,
                COALESCE(SUM(ri.quantity), 0) AS units_sold,
                COALESCE(SUM(ri.weight), 0) AS lbs_sold,
                COALESCE(SUM(ri.line_total), 0) AS revenue
            FROM supermarkets.receiptitem ri
            JOIN supermarkets.product p
                ON p.sku = ri.sku
            GROUP BY p.sku, p.product_name, p.category
            ORDER BY revenue DESC
            LIMIT $1
        `, [limit]);

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// endpoint to get tax collected per state - Q3
app.get('/api/reports/tax-by-state', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                st.state,
                st.tax_rate,
                COUNT(r.receipt_id) AS num_receipts,
                COALESCE(SUM(r.subtotal), 0) AS subtotal,
                COALESCE(SUM(r.tax_amount), 0) AS tax_collected
            FROM supermarkets.statetax st
            JOIN supermarkets.store s
                ON s.state = st.state
            LEFT JOIN supermarkets.receipt r
                ON r.store_id = s.store_id
            GROUP BY st.state, st.tax_rate
            ORDER BY tax_collected DESC
        `);

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// endpoint to get sales total per state - Q4
app.get('/api/reports/sales-by-state', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                s.state,
                COUNT(r.receipt_id) AS num_receipts,
                COALESCE(SUM(r.total_amount), 0) AS total_sales
            FROM supermarkets.store s
            LEFT JOIN supermarkets.receipt r
                ON r.store_id = s.store_id
            GROUP BY s.state
            ORDER BY total_sales DESC
        `);

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// endpoint to get low-stock items per state - Q5
app.get('/api/reports/low-stock', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                s.state,
                s.store_id,
                s.store_name,
                p.sku,
                p.product_name,
                i.available_quantity,
                p.unit_of_measure
            FROM supermarkets.inventory i
            JOIN supermarkets.store s
                ON s.store_id = i.store_id
            JOIN supermarkets.product p
                ON p.sku = i.sku
            WHERE i.available_quantity < 10
            ORDER BY s.state, i.available_quantity ASC
        `);

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// endpoint to get payments by method - Q6
app.get('/api/reports/payments-by-method', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                payment_method,
                payment_status,
                COUNT(*) AS num_payments,
                COALESCE(SUM(amount), 0) AS total_amount
            FROM supermarkets.payment
            GROUP BY payment_method, payment_status
            ORDER BY payment_method, payment_status
        `);

        res.json(result.rows);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});


// ---------------------- END BACK OFFICE REPORTS ----------------------





module.exports = app;