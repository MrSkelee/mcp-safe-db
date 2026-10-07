/**
 * SQL Safety Validator
 * Ensures only harmless, read-only queries are executed.
 */

const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE',
  'REPLACE',
  'GRANT',
  'REVOKE',
  'EXEC',
  'EXECUTE',
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
  'INTO',
];

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedQuery?: string;
}

/**
 * Validates a SQL query and guarantees read-only execution.
 */
export function validateReadOnlyQuery(query: string, maxRows = 50): ValidationResult {
  if (!query || typeof query !== 'string') {
    return { valid: false, reason: 'Query cannot be empty.' };
  }

  const trimmed = query.trim();

  // Strip comments to prevent hidden keyword injection
  const stripped = trimmed
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // multi-line comments
    .replace(/--.*$/gm, ' ')            // single-line comments
    .trim();

  if (!stripped) {
    return { valid: false, reason: 'Query contains only comments or whitespace.' };
  }

  // Prevent multiple statements separated by semicolons (e.g. "SELECT 1; DROP TABLE users;")
  const statements = stripped.split(';').map(s => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    return {
      valid: false,
      reason: 'Multiple SQL statements in a single request are blocked for safety.',
    };
  }

  const normalized = stripped.toUpperCase();

  // Must begin with a read-only keyword
  const isReadOnlyStart =
    normalized.startsWith('SELECT') ||
    normalized.startsWith('WITH') ||
    normalized.startsWith('EXPLAIN') ||
    normalized.startsWith('PRAGMA TABLE_INFO');

  if (!isReadOnlyStart) {
    return {
      valid: false,
      reason: 'Only read-only statements (SELECT, WITH, EXPLAIN) are allowed.',
    };
  }

  // Check for forbidden mutation keywords
  const tokens = normalized.match(/\b[A-Z_]+\b/g) || [];
  for (const token of tokens) {
    if (FORBIDDEN_KEYWORDS.includes(token)) {
      return {
        valid: false,
        reason: `Forbidden SQL operation detected: "${token}". Mutation queries are strictly blocked.`,
      };
    }
  }

  // Check and cap LIMIT to prevent blowing up the AI agent's context window
  let finalQuery = stripped;
  const limitMatch = stripped.match(/\bLIMIT\s+(\d+)/i);

  if (limitMatch) {
    const requestedLimit = parseInt(limitMatch[1], 10);
    if (requestedLimit > maxRows) {
      finalQuery = stripped.replace(/\bLIMIT\s+\d+/i, `LIMIT ${maxRows}`);
    }
  } else {
    // Automatically append LIMIT if not specified
    finalQuery = `${stripped.replace(/;+$/, '')} LIMIT ${maxRows}`;
  }

  return {
    valid: true,
    sanitizedQuery: finalQuery,
  };
}
