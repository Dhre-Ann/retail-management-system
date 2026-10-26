// this file will contain the express server entry point

const express = require('express');
const cors = require('cors');
const pool = require('./db/pool');

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

module.exports = app;