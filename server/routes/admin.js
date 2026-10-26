// table creation, seed data, browsing, and deletion

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
