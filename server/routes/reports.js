// back office reports

const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// endpoint to get sales per store - Q1
router.get('/reports/sales-by-store', async (req, res) => {
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
router.get('/reports/top-products', async (req, res) => {
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
router.get('/reports/tax-by-state', async (req, res) => {
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
router.get('/reports/sales-by-state', async (req, res) => {
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
router.get('/reports/low-stock', async (req, res) => {
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
router.get('/reports/payments-by-method', async (req, res) => {
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

module.exports = router;
