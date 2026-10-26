// this file will contain the database connection pool

const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({
    path: path.resolve(__dirname, '../../.env')
});

console.log('DB_USER loaded:', !!process.env.DB_USER);
console.log('DB_HOST loaded:', !!process.env.DB_HOST);
console.log('DB_NAME loaded:', !!process.env.DB_NAME);
console.log('DB_PASSWORD loaded:', !!process.env.DB_PASSWORD);
console.log('DB_PORT loaded:', !!process.env.DB_PORT);

console.log('Password type:', typeof process.env.DB_PASSWORD);
console.log('Password length:', process.env.DB_PASSWORD?.length);
console.log('Database host:', process.env.DB_HOST);
console.log('Database name:', process.env.DB_NAME);

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

module.exports = pool;