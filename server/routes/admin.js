// table creation, seed data, transaction reset, browsing, and deletion

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const pool = require('../db/pool');

const router = express.Router();

// this file lives in server/routes/, so go up twice to reach sql/
const sqlDir = path.join(__dirname, '..', '..', 'sql');

// endpoint to create tables
router.post('/create-tables', async (req, res) => {
    const client = await pool.connect();

    try {
        const schemaPath = path.join(sqlDir, 'schema.sql');
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

// The seed inserts name these tables. Reset reuses the SELECT and VALUES
// from those statements and ignores ON CONFLICT DO NOTHING.
function extractSeedInsert(seedSql, qualifiedName) {
    const escaped = qualifiedName.replace(/\./g, '\\.');
    const match = seedSql.match(new RegExp(
        `INSERT INTO ${escaped}\\s*\\([^)]*\\)\\s*([\\s\\S]*?)\\s*ON CONFLICT\\s+DO NOTHING\\s*;`,
        'i'
    ));

    if (!match) {
        throw new Error(`Seed file is missing an idempotent insert for ${qualifiedName}.`);
    }

    return match[1].trim();
}

// Inventory quantities and bank balances are defined in seed.sql.
// Read those definitions instead of copying the numbers into this file.
function buildResetStatements(seedSql) {
    const inventorySelect = extractSeedInsert(seedSql, 'supermarkets.inventory');
    const bankValues = extractSeedInsert(seedSql, 'banking.bankaccount');

    if (!/^SELECT\b/i.test(inventorySelect)) {
        throw new Error('Seed inventory insert must be a SELECT.');
    }

    if (!/^VALUES\b/i.test(bankValues)) {
        throw new Error('Seed bank account insert must be a VALUES list.');
    }

    const restoreInventory = `
        UPDATE supermarkets.inventory AS i
        SET available_quantity = seeded.available_quantity
        FROM (
            SELECT store_id, sku, available_quantity
            FROM (
${inventorySelect}
            ) AS generated(store_id, sku, available_quantity, aisle_number)
        ) AS seeded
        WHERE i.store_id = seeded.store_id
          AND i.sku = seeded.sku
    `;

    const restoreBalances = `
        UPDATE banking.bankaccount AS b
        SET account_balance = seeded.account_balance
        FROM (
            SELECT account_id, account_balance
            FROM (
${bankValues}
            ) AS generated(account_id, account_holder_name, account_number, account_balance)
        ) AS seeded
        WHERE b.account_id = seeded.account_id
    `;

    return { restoreInventory, restoreBalances };
}

// endpoint to initialize with seed data
router.post('/initialize', async (req, res) => {
    const client = await pool.connect();

    try {
        const seedPath = path.join(sqlDir, 'seed.sql');
        const sql = await fs.readFile(seedPath, 'utf8');

        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');

        res.json({
            status: 'success',
            message: 'Lookup tables initialized. Missing seed rows were inserted. Existing rows were left unchanged.'
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

// endpoint to clear receipts and restore seeded stock and balances
router.post('/reset-transactions', async (req, res) => {
    const client = await pool.connect();

    try {
        const seedPath = path.join(sqlDir, 'seed.sql');
        const seedSql = await fs.readFile(seedPath, 'utf8');
        const { restoreInventory, restoreBalances } = buildResetStatements(seedSql);

        await client.query('BEGIN');
        await client.query('DELETE FROM supermarkets.receiptitem');
        await client.query('DELETE FROM supermarkets.payment');
        await client.query('DELETE FROM supermarkets.receipt');
        await client.query(restoreInventory);
        await client.query(restoreBalances);
        await client.query('COMMIT');

        res.json({
            status: 'success',
            message: 'Transaction tables reset. Receipt lines, payments, and receipts were deleted. Inventory quantities and bank balances were restored to the seeded values.'
        });

    } catch (error) {
        await client.query('ROLLBACK');

        console.error('Error resetting transaction tables:', error.message);

        res.status(500).json({
            status: 'error',
            message: error.message
        });

    } finally {
        client.release();
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
router.get('/tables/:tableName', async (req, res) => {
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
router.delete('/tables/:tableName', async (req, res) => {
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

module.exports = router;
