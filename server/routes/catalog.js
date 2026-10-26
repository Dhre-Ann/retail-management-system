// stores, products, inventory, and bank accounts

const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// endpoint to query stores table and return a list of stores as JSON
router.get('/stores', async (req, res) => {
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
router.get('/products', async (req, res) => {
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
router.get('/inventory/:storeId', async (req, res) => {
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

// endpoint to get bank accounts
router.get('/bank-accounts', async (req, res) => {
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

module.exports = router;
