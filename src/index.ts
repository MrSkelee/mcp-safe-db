#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { SafeDatabase } from './db.js';
import fs from 'node:fs';
import path from 'node:path';

// Parse database file path from CLI args or environment
const args = process.argv.slice(2);
const dbArg = args[0] || process.env.DATABASE_PATH;

if (!dbArg) {
  console.error('Error: Database path is required.');
  console.error('Usage: mcp-safe-db <path-to-database.sqlite>');
  console.error('   or set DATABASE_PATH environment variable.');
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), dbArg);
if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: Database file not found at: ${resolvedPath}`);
  process.exit(1);
}

let db: SafeDatabase;
try {
  db = new SafeDatabase(resolvedPath);
} catch (err: any) {
  console.error(`Failed to connect to database: ${err.message}`);
  process.exit(1);
}

const server = new Server(
  {
    name: 'mcp-safe-db',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Tool Definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_tables',
        description: 'Lists all available user tables and views in the database.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'describe_table',
        description: 'Returns schema information (columns, types, primary keys) for a specific table.',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'The name of the table to inspect.',
            },
          },
          required: ['tableName'],
        },
      },
      {
        name: 'sample_table',
        description: 'Returns the first few rows of a table to inspect data format and values without custom SQL.',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'The name of the table to sample.',
            },
            count: {
              type: 'number',
              description: 'Number of rows to sample (default: 3, max: 10).',
            },
          },
          required: ['tableName'],
        },
      },
      {
        name: 'safe_query',
        description: 'Safely executes a read-only SQL SELECT query. Write/mutation operations (INSERT, UPDATE, DELETE, DROP) are strictly blocked.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The read-only SQL query to execute (e.g. "SELECT * FROM users WHERE active = 1").',
            },
            maxRows: {
              type: 'number',
              description: 'Maximum rows to return (default: 50, maximum: 100).',
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

// Handle Tool Execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_tables': {
        const tables = db.listTables();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(tables, null, 2),
            },
          ],
        };
      }

      case 'describe_table': {
        const tableName = String(args?.tableName || '');
        if (!tableName) {
          throw new McpError(ErrorCode.InvalidParams, 'tableName is required');
        }
        const schema = db.describeTable(tableName);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(schema, null, 2),
            },
          ],
        };
      }

      case 'sample_table': {
        const tableName = String(args?.tableName || '');
        if (!tableName) {
          throw new McpError(ErrorCode.InvalidParams, 'tableName is required');
        }
        const count = typeof args?.count === 'number' ? args.count : 3;
        const rows = db.sampleTable(tableName, count);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      }

      case 'safe_query': {
        const query = String(args?.query || '');
        if (!query) {
          throw new McpError(ErrorCode.InvalidParams, 'query is required');
        }
        const maxRows = typeof args?.maxRows === 'number' ? args.maxRows : 50;
        const result = db.executeQuery(query, maxRows);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Database Error: ${error.message}`,
        },
      ],
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
