/**
 * SQL Safety & Cybersecurity Validator
 * Multi-layer defense against SQL injection, data exfiltration, and mutation.
 */

const FORBIDDEN_KEYWORDS = [
  // Mutation keywords
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
  // Database / Environment manipulation
  'ATTACH',
  'DETACH',
  'VACUUM',
  'REINDEX',
  'PRAGMA', // Pragma commands are blocked in queries; schema inspection uses describeTable tool
  // Extension & System execution vectors
  'LOAD_EXTENSION',
  'WRITEFILE',
  'READFILE',
  'SHELL',
  'SYSTEM',
  'EDIT',
];

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedQuery?: string;
}

/**
 * Validates a SQL query and guarantees strict read-only execution.
 */
export function validateReadOnlyQuery(query: string, maxRows = 50): ValidationResult {
  if (!query || typeof query !== 'string') {
    return { valid: false, reason: 'Query cannot be empty.' };
  }

  // Maximum query length to prevent buffer/ReDoS attacks (max 8KB)
  if (query.length > 8192) {
    return { valid: false, reason: 'Query exceeds maximum allowed length of 8KB.' };
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

  // 4. Must start with an approved read-only keyword
  const isReadOnlyStart =
    normalized.startsWith('SELECT') ||
    normalized.startsWith('WITH') ||
    normalized.startsWith('EXPLAIN');

  if (!isReadOnlyStart) {
    return {
      valid: false,
      reason: 'Only read-only statements (SELECT, WITH, EXPLAIN) are allowed.',
    };
  }

  // 5. Check for forbidden security/mutation tokens outside string literals
  const tokens = normalized.match(/\b[A-Z_]+\b/g) || [];
  for (const token of tokens) {
    if (FORBIDDEN_KEYWORDS.includes(token)) {
      return {
        valid: false,
        reason: `Forbidden SQL operation or security risk detected: "${token}".`,
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
