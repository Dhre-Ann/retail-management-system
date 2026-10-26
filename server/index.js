// this file will contain the express server entry point

const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');
const fs = require('fs/promises');
const path = require('path');

// console.log('Imported pool:', pool);
// console.log('Type of pool.query:', typeof pool.query);

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


// --------------- TRANSACTIONS ---------------

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




module.exports = app;