export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractJsonObject(text) {
  // Try direct JSON first, then a minimal "find first {...}" fallback.
  const direct = safeJsonParse(text);
  if (direct && typeof direct === 'object') return direct;

  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const maybe = safeJsonParse(s.slice(start, end + 1));
    if (maybe && typeof maybe === 'object') return maybe;
  }
  return null;
}

/**
 * Extract JSON and validate with a Zod schema
 *
 * @param {string} text - Raw text that may contain JSON
 * @param {Object} schema - Zod schema for validation
 * @returns {Object} { data: Object|null, issues: Array<string>, raw: Object|null }
 */
export function extractAndValidateJson(text, schema) {
  const raw = extractJsonObject(text);

  if (!raw) {
    return {
      data: null,
      issues: ['Failed to extract JSON from response'],
      raw: null,
    };
  }

  if (!schema || typeof schema.safeParse !== 'function') {
    // No schema provided, return raw data
    return { data: raw, issues: [], raw };
  }

  const result = schema.safeParse(raw);

  if (result.success) {
    return { data: result.data, issues: [], raw };
  }

  // Collect validation issues but still return raw data
  // (AI output is fixed rather than rejected)
  const issues = result.error.errors.map((e) => {
    const path = e.path.join('.');
    return `${path || 'root'}: ${e.message}`;
  });

  return {
    data: raw, // Return raw data even if validation fails
    issues,
    raw,
  };
}
