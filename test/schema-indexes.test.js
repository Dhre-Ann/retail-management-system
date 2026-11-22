'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { describe, test } = require('node:test');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'sql', 'schema.sql'), 'utf8');
const reports = fs.readFileSync(path.join(root, 'server', 'routes', 'reports.js'), 'utf8');
const simulation = fs.readFileSync(path.join(root, 'server', 'routes', 'simulation.js'), 'utf8');

const EXPECTED_INDEXES = [
  'ON supermarkets.store (state)',
  'ON supermarkets.receipt (store_id)',
  'ON supermarkets.receipt ((receipt_date + receipt_time))',
  'ON supermarkets.receiptitem (sku)',
  'ON supermarkets.payment (account_id)'
];

// Columns already indexed by a PRIMARY KEY or UNIQUE constraint.
const ALREADY_INDEXED = [
  'ON supermarkets.statetax (state)',
  'ON supermarkets.store (store_id)',
  'ON supermarkets.product (sku)',
  'ON supermarkets.inventory (store_id, sku)',
  'ON banking.bankaccount (account_id)',
  'ON banking.bankaccount (account_number)',
  'ON supermarkets.receipt (receipt_id)',
  'ON supermarkets.receiptitem (receipt_id, receipt_line_number)',
  'ON supermarkets.payment (payment_id)',
  'ON supermarkets.payment (receipt_id)'
];

function indexStatements(sql) {
  return sql
    .split(';')
    .map((part) => part.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => /^CREATE INDEX\b/i.test(part));
}

describe('schema indexes', () => {
  test('adds the five secondary indexes and does not repeat key indexes', () => {
    const statements = indexStatements(schema);

    assert.equal(statements.length, EXPECTED_INDEXES.length);
    for (const statement of statements) {
      assert.match(statement, /^CREATE INDEX IF NOT EXISTS idx_/);
      assert.doesNotMatch(statement, /\bUNIQUE\b/i);
      assert.doesNotMatch(statement, /\bCONCURRENTLY\b/i);
    }

    for (const expected of EXPECTED_INDEXES) {
      assert.ok(
        statements.some((statement) => statement.includes(expected)),
        expected
      );
    }

    for (const covered of ALREADY_INDEXED) {
      assert.equal(
        statements.some((statement) => statement.includes(covered)),
        false,
        covered
      );
    }
  });

  test('matches the queries those indexes support and leaves existing rows alone', () => {
    assert.match(reports, /JOIN supermarkets\.store s\s+ON s\.state = st\.state/);
    assert.match(reports, /ON r\.store_id = s\.store_id/);
    assert.match(reports, /ON p\.sku = ri\.sku/);
    assert.match(
      simulation,
      /WHERE \(r\.receipt_date \+ r\.receipt_time\) >= LOCALTIMESTAMP - \$1::interval/
    );
    assert.match(
      schema,
      /FOREIGN KEY \(account_id\)\s+REFERENCES banking\.bankaccount\(account_id\)/
    );

    assert.match(schema, /CREATE TABLE IF NOT EXISTS/);
    assert.doesNotMatch(schema, /\bGENERATED\b/i);
    assert.doesNotMatch(schema, /^\s*(DELETE|UPDATE|TRUNCATE|DROP|ALTER TABLE)\b/im);
  });
});
