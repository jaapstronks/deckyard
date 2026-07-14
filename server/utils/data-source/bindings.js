/**
 * Binding engine for live data sources.
 *
 * Applies fetched data to slide content fields using dot-notation paths
 * like `metrics[0].value` or `rows[2].c3`.
 */

/**
 * Parse a binding target path into segments.
 * Examples:
 *   'title'            -> [{ key: 'title' }]
 *   'metrics[0].value' -> [{ key: 'metrics' }, { index: 0 }, { key: 'value' }]
 *   'rows[2].c3'       -> [{ key: 'rows' }, { index: 2 }, { key: 'c3' }]
 *
 * @param {string} path - Dot-notation path with optional array indices
 * @returns {Array<{key?: string, index?: number}>}
 */
export function parsePath(path) {
  const segments = [];
  const parts = String(path || '').split('.');

  for (const part of parts) {
    const match = part.match(/^([^[]+)\[(\d+)\]$/);
    if (match) {
      segments.push({ key: match[1] });
      segments.push({ index: parseInt(match[2], 10) });
    } else if (part) {
      segments.push({ key: part });
    }
  }

  return segments;
}

/**
 * Get a value from an object using a parsed path.
 *
 * @param {Object} obj - Source object
 * @param {Array} segments - Parsed path segments
 * @returns {*} Value at path, or undefined
 */
export function getByPath(obj, segments) {
  let current = obj;
  for (const seg of segments) {
    if (current == null) return undefined;
    if ('key' in seg) {
      current = current[seg.key];
    } else if ('index' in seg) {
      if (!Array.isArray(current)) return undefined;
      current = current[seg.index];
    }
  }
  return current;
}

/**
 * Set a value on an object using a parsed path, creating intermediate
 * objects/arrays as needed.
 *
 * @param {Object} obj - Target object (mutated in place)
 * @param {Array} segments - Parsed path segments
 * @param {*} value - Value to set
 */
export function setByPath(obj, segments, value) {
  if (!segments.length) return;

  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = segments[i + 1];

    if ('key' in seg) {
      if (current[seg.key] == null) {
        current[seg.key] = 'index' in next ? [] : {};
      }
      current = current[seg.key];
    } else if ('index' in seg) {
      if (!Array.isArray(current)) return;
      while (current.length <= seg.index) {
        const nextSeg = segments[i + 1];
        current.push('index' in (nextSeg || {}) ? [] : {});
      }
      current = current[seg.index];
    }
  }

  const last = segments[segments.length - 1];
  if ('key' in last) {
    current[last.key] = value;
  } else if ('index' in last && Array.isArray(current)) {
    while (current.length <= last.index) current.push(undefined);
    current[last.index] = value;
  }
}

/**
 * Apply bindings to slide content using fetched data.
 *
 * @param {Object} content - Slide content object (will be deep-cloned)
 * @param {Array<{target: string, source: string}>} bindings - Binding definitions
 * @param {Object} fetchedData - Data from the provider, keyed by source identifiers
 * @returns {{ content: Object, applied: number, errors: string[] }}
 */
export function applyBindings(content, bindings, fetchedData) {
  const result = JSON.parse(JSON.stringify(content || {}));
  let applied = 0;
  const errors = [];

  for (const binding of bindings) {
    const { target, source } = binding;
    const value = fetchedData[source];

    if (value === undefined) {
      errors.push(`Source "${source}" not found in fetched data`);
      continue;
    }

    try {
      const segments = parsePath(target);
      setByPath(result, segments, value);
      applied++;
    } catch (err) {
      errors.push(`Failed to apply binding ${source} -> ${target}: ${err.message}`);
    }
  }

  return { content: result, applied, errors };
}
