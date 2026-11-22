// Idempotent setup used before a simulation starts.
// Runs the same schema and seed files as Admin. CREATE TABLE IF NOT EXISTS
// and ON CONFLICT DO NOTHING add what is missing and leave existing rows,
// inventory quantities, bank balances, and receipts unchanged.

const fs = require('fs/promises');
const path = require('path');
const pool = require('../db/pool');

const sqlDir = path.join(__dirname, '..', '..', 'sql');

const REQUIRED_TABLES = [
    ['supermarkets', 'statetax'],
    ['supermarkets', 'store'],
    ['supermarkets', 'product'],
    ['supermarkets', 'inventory'],
    ['supermarkets', 'receipt'],
    ['supermarkets', 'receiptitem'],
    ['supermarkets', 'payment'],
    ['banking', 'bankaccount']
];

const REFERENCE_TABLES = [
    ['supermarkets', 'statetax'],
    ['supermarkets', 'store'],
    ['supermarkets', 'product'],
    ['supermarkets', 'inventory'],
    ['banking', 'bankaccount']
];

function setupError(message) {
    const error = new Error(message);
    error.initialization = true;
    return error;
}

async function readSetupSql() {
    try {
        const [schemaSql, seedSql] = await Promise.all([
            fs.readFile(path.join(sqlDir, 'schema.sql'), 'utf8'),
            fs.readFile(path.join(sqlDir, 'seed.sql'), 'utf8')
        ]);
        return { schemaSql, seedSql };
    } catch (error) {
        throw setupError(
            `Simulation did not start: the schema or seed file could not be read. ${error.message}`
        );
    }
}

async function missingTables(client) {
    const found = await client.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND (table_schema, table_name) IN (
            ('supermarkets', 'statetax'),
            ('supermarkets', 'store'),
            ('supermarkets', 'product'),
            ('supermarkets', 'inventory'),
            ('supermarkets', 'receipt'),
            ('supermarkets', 'receiptitem'),
            ('supermarkets', 'payment'),
            ('banking', 'bankaccount')
          )
    `);
    const present = new Set(
        found.rows.map((row) => `${row.table_schema}.${row.table_name}`)
    );
    return REQUIRED_TABLES
        .filter(([schema, name]) => !present.has(`${schema}.${name}`))
        .map(([schema, name]) => `${schema}.${name}`);
}

async function missingReferenceData(client) {
    const counts = await client.query(`
        SELECT
            (SELECT COUNT(*)::int FROM supermarkets.statetax) AS statetax,
            (SELECT COUNT(*)::int FROM supermarkets.store) AS store,
            (SELECT COUNT(*)::int FROM supermarkets.product) AS product,
            (SELECT COUNT(*)::int FROM supermarkets.inventory) AS inventory,
            (SELECT COUNT(*)::int FROM banking.bankaccount) AS bankaccount
    `);
    const row = counts.rows[0] || {};
    return REFERENCE_TABLES
        .filter(([, name]) => !(Number(row[name]) > 0))
        .map(([schema, name]) => `${schema}.${name}`);
}

// Creates missing tables and missing reference rows, then commits.
// Throws before any checkout when setup cannot be finished.
async function ensureSimulationDatabase() {
    const { schemaSql, seedSql } = await readSetupSql();
    let client;

    try {
        client = await pool.connect();
    } catch (error) {
        throw setupError(`Simulation did not start: database setup failed. ${error.message}`);
    }

    try {
        await client.query('BEGIN');
        await client.query(schemaSql);
        await client.query(seedSql);

        const tables = await missingTables(client);
        if (tables.length) {
            throw setupError(
                `Simulation did not start: required tables are still missing (${tables.join(', ')}).`
            );
        }

        const references = await missingReferenceData(client);
        if (references.length) {
            throw setupError(
                `Simulation did not start: required reference data is still missing (${references.join(', ')}).`
            );
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.initialization) {
            throw error;
        }
        throw setupError(`Simulation did not start: database setup failed. ${error.message}`);
    } finally {
        client.release();
    }
}

module.exports = { ensureSimulationDatabase };
