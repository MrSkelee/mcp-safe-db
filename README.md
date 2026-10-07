# 🛡️ mcp-safe-db

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![Model Context Protocol](https://img.shields.io/badge/Protocol-MCP-purple.svg)](https://modelcontextprotocol.io/)

> **Zero-risk, strictly read-only SQL database inspector for AI agents** (Claude Desktop, Antigravity, Cursor, Cline).

Let your AI explore schemas, inspect tables, and run `SELECT` queries without risking accidental `DROP`, `UPDATE`, or `DELETE`.

---

## ⚡ The Problem

Giving an AI assistant database access is scary:
- A hallucinated `UPDATE` query without a `WHERE` clause can wipe production or local dev data.
- Semicolon injection (`SELECT 1; DROP TABLE users;`) can execute hidden destructive actions.
- Unbounded queries (`SELECT *`) blow up context windows and burn API tokens.

**mcp-safe-db** solves this with a **Dual-Layer Defense**:
1. **Layer 1 (Parser Guard)**: Strict AST & regex validation blocks mutation keywords, multiple statements, and comment bypasses. High limits are capped to 50 rows automatically.
2. **Layer 2 (Engine Lock)**: SQLite engine is locked with `PRAGMA query_only = ON;`. Even if a query bypasses parsing, the database engine physically rejects write operations.

---

## 🚀 Quickstart (30 seconds)

### Direct execution via `npx`
```bash
npx mcp-safe-db ./path/to/database.sqlite
```

---

## 🛠️ Configuration

### 1. Claude Desktop
Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "safe-db": {
      "command": "npx",
      "args": ["-y", "mcp-safe-db", "/absolute/path/to/your/database.sqlite"]
    }
  }
}
```

### 2. Antigravity IDE / Cursor / Cline
Add to your `mcp_config.json`:

```json
{
  "mcpServers": {
    "safe-db": {
      "command": "node",
      "args": ["dist/index.js", "./demo.sqlite"]
    }
  }
}
```

---

## 🧰 Available Tools for AI

| Tool | Description | Safe Guard |
| :--- | :--- | :--- |
| `list_tables` | Lists all user tables and views | Filters out internal SQLite tables |
| `describe_table` | Inspects columns, data types, and primary keys | Sanitized table name validation |
| `sample_table` | Returns the first 3 rows of any table | Hard-capped to max 10 rows |
| `safe_query` | Executes arbitrary `SELECT` queries | Rejects mutations, auto-caps `LIMIT` |

---

## 🧪 Testing

```bash
npm test
```

Runs the 10 automated security and safety tests.

---

## 📄 License

MIT © 2026
