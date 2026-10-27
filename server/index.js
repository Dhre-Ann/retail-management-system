// this file will contain the express server entry point

const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');
const adminRoutes = require('./routes/admin');
const catalogRoutes = require('./routes/catalog');
const checkoutRoutes = require('./routes/checkout');
const simulationRoutes = require('./routes/simulation');
const reportRoutes = require('./routes/reports');

const app = express();

app.use(express.json());
app.use(cors());

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

// routers are mounted at /api so each file keeps the rest of the original path
app.use('/api', adminRoutes);
app.use('/api', catalogRoutes);
app.use('/api', checkoutRoutes);
app.use('/api', simulationRoutes);
app.use('/api', reportRoutes);

// start the server
app.listen(3000, () => {
    console.log('Server is running on port 3000');
});

module.exports = app;
