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
  'PRAGMA',
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

export function validateReadOnlyQuery(query: string, maxRows = 50): ValidationResult {
  if (!query || typeof query !== 'string') {
    return { valid: false, reason: 'Query cannot be empty.' };
  }

  if (query.length > 8192) {
    return { valid: false, reason: 'Query exceeds maximum allowed length of 8KB.' };
  }

  const trimmed = query.trim();

  // Strip comments
  const withoutComments = trimmed
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim();

  if (!withoutComments) {
    return { valid: false, reason: 'Query contains only comments or whitespace.' };
  }

  // Block multi-statement queries
  const statements = withoutComments.split(';').map(s => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    return {
      valid: false,
      reason: 'Multiple SQL statements in a single request are blocked for safety.',
    };
  }

  // Strip string literals to prevent false positives on values like 'DELETED'
  const withoutStrings = withoutComments
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');

  const normalized = withoutStrings.toUpperCase();

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

  // Check forbidden keywords outside string literals
  const tokens = normalized.match(/\b[A-Z_]+\b/g) || [];
  for (const token of tokens) {
    if (FORBIDDEN_KEYWORDS.includes(token)) {
      return {
        valid: false,
        reason: `Forbidden SQL operation or security risk detected: "${token}".`,
      };
    }
  }

  // Enforce row limit
  let finalQuery = withoutComments;
  const limitMatch = withoutComments.match(/\bLIMIT\s+(\d+)\s*$/i);

  if (limitMatch) {
    const requestedLimit = parseInt(limitMatch[1], 10);
    if (requestedLimit > maxRows) {
      finalQuery = withoutComments.replace(/\bLIMIT\s+\d+\s*$/i, `LIMIT ${maxRows}`);
    }
  } else {
    finalQuery = `${withoutComments.replace(/;+$/, '')} LIMIT ${maxRows}`;
  }

  return {
    valid: true,
    sanitizedQuery: finalQuery,
  };
}
