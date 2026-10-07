import { DatabaseSync } from 'node:sqlite';
import { validateReadOnlyQuery } from './validator.js';

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value: any;
}

export interface TableSummary {
  name: string;
  type: string;
  rowCountEstimate?: number;
}

export class SafeDatabase {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);

    // Hard-enforce read-only mode at the SQLite engine level
    this.db.exec('PRAGMA query_only = ON;');
  }

  /**
   * List all user tables and views in the database.
   */
  public listTables(): TableSummary[] {
    const query = `
      SELECT name, type 
      FROM sqlite_master 
      WHERE type IN ('table', 'view') 
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC;
    `;
    const stmt = this.db.prepare(query);
    const results = stmt.all() as { name: string; type: string }[];
    return results.map(row => ({
      name: row.name,
      type: row.type,
    }));
  }

  /**
   * Returns schema columns and types for a specific table.
   */
  public describeTable(tableName: string): ColumnInfo[] {
    // Sanitize table name (only letters, numbers, underscores)
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid table name: "${tableName}". Table names must only contain alphanumeric characters and underscores.`);
    }

    const stmt = this.db.prepare(`PRAGMA table_info(${tableName});`);
    const cols = stmt.all() as any[];
    return cols.map(c => ({
      name: c.name,
      type: c.type || 'UNKNOWN',
      notnull: c.notnull,
      pk: c.pk,
      dflt_value: c.dflt_value,
    }));
  }

  /**
   * Samples top N rows from a table.
   */
  public sampleTable(tableName: string, count = 3): Record<string, any>[] {
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new Error(`Invalid table name: "${tableName}".`);
    }
    const safeCount = Math.min(Math.max(1, count), 10);
    const stmt = this.db.prepare(`SELECT * FROM ${tableName} LIMIT ${safeCount};`);
    return stmt.all() as Record<string, any>[];
  }

  /**
   * Safely execute a validated read-only SQL query.
   */
  public executeQuery(query: string, maxRows = 50): { rows: Record<string, any>[]; rowCount: number; executedQuery: string; durationMs: number } {
    const validation = validateReadOnlyQuery(query, maxRows);
    if (!validation.valid || !validation.sanitizedQuery) {
      throw new Error(`[SAFETY REJECTION] ${validation.reason}`);
    }

    const start = performance.now();
    const stmt = this.db.prepare(validation.sanitizedQuery);
    const rows = stmt.all() as Record<string, any>[];
    const durationMs = Math.round((performance.now() - start) * 100) / 100;

    return {
      rows,
      rowCount: rows.length,
      executedQuery: validation.sanitizedQuery,
      durationMs,
    };
  }

  public close(): void {
    this.db.close();
  }
}
