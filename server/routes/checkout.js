// checkout requests and receipt lookup

const express = require('express');
const pool = require('../db/pool');
const { processCheckout } = require('../services/checkoutService');

const router = express.Router();

// get receipt by id
router.get('/receipts/:id', async (req, res) => {
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

// manual checkout. The transaction itself is in checkoutService.
router.post('/checkout', async (req, res) => {
    try {
        const result = await processCheckout(req.body);
        res.json(result);
    } catch (error) {
        res.status(error.statusCode || 400).json({
            status: 'error',
            message: error.message
        });
    }
});

module.exports = router;
