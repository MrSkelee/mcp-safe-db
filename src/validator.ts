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
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
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

  // 1. Strip comments
  const withoutComments = trimmed
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();

  if (!withoutComments) {
    return { valid: false, reason: 'Query contains only comments or whitespace.' };
  }

  // 2. Prevent multi-statement attacks
  const statements = withoutComments.split(';').map(s => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    return {
      valid: false,
      reason: 'Multiple SQL statements in a single request are blocked for safety.',
    };
  }

  // 3. Strip string literals ('...' and "...") to avoid false positives on legitimate values
  // e.g. WHERE status = 'DELETED' or WHERE note = 'Please update records'
  const withoutStrings = withoutComments
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');

  const normalized = withoutStrings.toUpperCase();

  // 4. Must start with a read-only keyword
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

  // 5. Check for forbidden mutation keywords outside string literals
  const tokens = normalized.match(/\b[A-Z_]+\b/g) || [];
  for (const token of tokens) {
    if (FORBIDDEN_KEYWORDS.includes(token)) {
      return {
        valid: false,
        reason: `Forbidden SQL operation detected: "${token}". Mutation queries are strictly blocked.`,
      };
    }
  }

  // 6. Safe LIMIT enforcement
  let finalQuery = withoutComments;
  const limitMatch = withoutComments.match(/\bLIMIT\s+(\d+)\s*$/i);

  if (limitMatch) {
    const requestedLimit = parseInt(limitMatch[1], 10);
    if (requestedLimit > maxRows) {
      finalQuery = withoutComments.replace(/\bLIMIT\s+\d+\s*$/i, `LIMIT ${maxRows}`);
    }
  } else {
    // Append LIMIT if not present at the end
    finalQuery = `${withoutComments.replace(/;+$/, '')} LIMIT ${maxRows}`;
  }

  return {
    valid: true,
    sanitizedQuery: finalQuery,
  };
}
