import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { validateReadOnlyQuery } from '../dist/validator.js';
import { SafeDatabase } from '../dist/db.js';

const TEST_DB = path.resolve('test-database.db');

// Setup test database
test.before(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = new DatabaseSync(TEST_DB);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT DEFAULT 'user'
    );
    INSERT INTO users (name, email, role) VALUES ('Alice', 'alice@test.com', 'admin');
    INSERT INTO users (name, email, role) VALUES ('Bob', 'bob@test.com', 'user');
    INSERT INTO users (name, email, role) VALUES ('Charlie', 'charlie@test.com', 'user');
  `);
  db.close();
});

test.after(() => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

test('Validator: allows legitimate SELECT queries', () => {
  const res = validateReadOnlyQuery('SELECT * FROM users WHERE id = 1');
  assert.equal(res.valid, true);
  assert.match(res.sanitizedQuery, /SELECT \* FROM users WHERE id = 1 LIMIT 50/);
});

test('Validator: blocks DROP TABLE', () => {
  const res = validateReadOnlyQuery('DROP TABLE users');
  assert.equal(res.valid, false);
  assert.match(res.reason, /Only read-only statements/);
});

test('Validator: blocks DELETE', () => {
  const res = validateReadOnlyQuery('DELETE FROM users');
  assert.equal(res.valid, false);
  assert.match(res.reason, /Only read-only statements/);
});

test('Validator: blocks multi-statement injection (SELECT 1; DROP TABLE users)', () => {
  const res = validateReadOnlyQuery('SELECT * FROM users; DROP TABLE users;');
  assert.equal(res.valid, false);
  assert.match(res.reason, /Multiple SQL statements/);
});

test('Validator: blocks comment-based trickery', () => {
  const res = validateReadOnlyQuery('/* comment */ DROP TABLE users');
  assert.equal(res.valid, false);
});

test('Validator: caps high LIMIT clauses', () => {
  const res = validateReadOnlyQuery('SELECT * FROM users LIMIT 1000', 50);
  assert.equal(res.valid, true);
  assert.match(res.sanitizedQuery, /LIMIT 50/);
});

test('Database: listTables returns user tables', () => {
  const safeDb = new SafeDatabase(TEST_DB);
  const tables = safeDb.listTables();
  assert.equal(tables.length, 1);
  assert.equal(tables[0].name, 'users');
  safeDb.close();
});

test('Database: describeTable returns correct columns', () => {
  const safeDb = new SafeDatabase(TEST_DB);
  const cols = safeDb.describeTable('users');
  assert.equal(cols.length, 4);
  assert.equal(cols[0].name, 'id');
  assert.equal(cols[1].name, 'name');
  safeDb.close();
});

test('Database: sampleTable returns rows', () => {
  const safeDb = new SafeDatabase(TEST_DB);
  const rows = safeDb.sampleTable('users', 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Alice');
  safeDb.close();
});

test('Database: executeQuery executes read query and engine blocks mutation', () => {
  const safeDb = new SafeDatabase(TEST_DB);
  const result = safeDb.executeQuery('SELECT name FROM users ORDER BY id ASC');
  assert.equal(result.rowCount, 3);
  assert.equal(result.rows[0].name, 'Alice');

  // Attempt write
  assert.throws(() => {
    safeDb.executeQuery('UPDATE users SET name = "Hacked"');
  }, /SAFETY REJECTION/);

  safeDb.close();
});
