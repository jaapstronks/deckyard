/**
 * YAML parser for frontmatter.
 *
 * Uses the `yaml` npm package for full YAML support (nested objects, arrays,
 * multiline values). Falls back to an empty object on parse errors.
 *
 * Same export signature as the original lightweight implementation.
 */

import { parse as yamlParse } from 'yaml';

/**
 * Parse a YAML block into a plain object.
 * @param {string} text - Raw YAML text (no surrounding `---` fences).
 * @returns {Record<string, any>}
 */
export function parseSimpleYaml(text) {
  if (!text || typeof text !== 'string') return {};

  try {
    const result = yamlParse(text);
    // yaml.parse can return non-objects for scalar YAML
    if (result === null || result === undefined || typeof result !== 'object' || Array.isArray(result)) {
      return {};
    }
    return result;
  } catch {
    return {};
  }
}
