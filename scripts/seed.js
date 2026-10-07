import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

if (fs.existsSync('demo.sqlite')) {
  fs.unlinkSync('demo.sqlite');
}

const db = new DatabaseSync('demo.sqlite');
db.exec(`
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    country TEXT,
    tier TEXT DEFAULT 'free'
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER,
    amount REAL,
    status TEXT,
    created_at TEXT
  );

  INSERT INTO customers VALUES (1, 'Alice Smith', 'alice@company.com', 'US', 'pro');
  INSERT INTO customers VALUES (2, 'Bob Jones', 'bob@acme.org', 'UK', 'enterprise');
  INSERT INTO customers VALUES (3, 'Charlie Brown', 'charlie@gmail.com', 'DE', 'free');

  INSERT INTO orders VALUES (101, 1, 149.99, 'completed', '2026-10-01');
  INSERT INTO orders VALUES (102, 2, 499.00, 'processing', '2026-10-07');
  INSERT INTO orders VALUES (103, 1, 49.99, 'completed', '2026-10-07');
`);
db.close();

console.log('demo.sqlite created successfully!');
