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
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'active'
    );
    INSERT INTO users (name, email, role, status) VALUES ('Alice', 'alice@test.com', 'admin', 'active');
    INSERT INTO users (name, email, role, status) VALUES ('Bob', 'bob@test.com', 'user', 'DELETED');
    INSERT INTO users (name, email, role, status) VALUES ('Charlie', 'charlie@test.com', 'user', 'UPDATE_PENDING');
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

test('Validator: allows legitimate queries with forbidden words inside string literals', () => {
  const res = validateReadOnlyQuery("SELECT * FROM users WHERE status = 'DELETED'");
  assert.equal(res.valid, true);
  assert.match(res.sanitizedQuery, /SELECT \* FROM users WHERE status = 'DELETED' LIMIT 50/);
});

test('Validator: allows Common Table Expressions (WITH cte AS ...)', () => {
  const res = validateReadOnlyQuery('WITH admins AS (SELECT * FROM users WHERE role = "admin") SELECT * FROM admins');
  assert.equal(res.valid, true);
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

test('Security: blocks LOAD_EXTENSION attack vector', () => {
  const res = validateReadOnlyQuery("SELECT load_extension('malicious.dll')");
  assert.equal(res.valid, false);
  assert.match(res.reason, /LOAD_EXTENSION/);
});

test('Security: blocks ATTACH DATABASE attack vector', () => {
  const res = validateReadOnlyQuery("ATTACH DATABASE 'other.db' AS other");
  assert.equal(res.valid, false);
});

test('Security: blocks oversize query exceeding 8KB', () => {
  const giant = 'SELECT * FROM users WHERE ' + 'id = 1 AND '.repeat(1000);
  const res = validateReadOnlyQuery(giant);
  assert.equal(res.valid, false);
  assert.match(res.reason, /8KB/);
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
  assert.equal(cols.length, 5);
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

test('Database: executeQuery executes read query with string literals safely', () => {
  const safeDb = new SafeDatabase(TEST_DB);
  const result = safeDb.executeQuery("SELECT name FROM users WHERE status = 'DELETED'");
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].name, 'Bob');

  // Attempt write
  assert.throws(() => {
    safeDb.executeQuery('UPDATE users SET name = "Hacked"');
  }, /SAFETY REJECTION/);

  safeDb.close();
});

test('Database: OS-level readOnly mode blocks write even if raw SQL is attempted', () => {
  const safeDb = new SafeDatabase(TEST_DB);
  try {
    assert.throws(() => {
      safeDb.db.exec("INSERT INTO users (id, name, email) VALUES (99, 'Evil', 'evil@test.com')");
    }, /readonly database/);
  } finally {
    safeDb.close();
  }
});

test('Security: PRAGMA query_only = OFF cannot bypass OS-level readOnly lock', () => {
  const safeDb = new SafeDatabase(TEST_DB);
  try {
    assert.throws(() => {
      safeDb.db.exec('PRAGMA query_only = OFF;');
      safeDb.db.exec("INSERT INTO users (id, name, email) VALUES (99, 'Hacked', 'h@test.com')");
    }, /readonly database/);
  } finally {
    safeDb.close();
  }
});
