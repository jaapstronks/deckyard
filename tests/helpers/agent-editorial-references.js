import { enumOptionValues } from '../../shared/slide-types/field-types.js';

/**
 * Check explicit editorial code spans, not English words. A reference names a
 * field path, optionally followed by a JSON enum value: `items.tone="positive"`.
 * Paths are resolved in their own item scope; no global bag of field names.
 * @param {string} prose
 * @param {object[]} fields
 * @returns {string[]} invalid references, in prose order
 */
export function invalidEditorialReferences(prose, fields) {
  const invalid = [];
  for (const [, ref] of String(prose).matchAll(/`([^`]+)`/g)) {
    const match = /^([a-zA-Z]\w*(?:\.[a-zA-Z]\w*)*)(?:=(.+))?$/.exec(ref);
    let field;
    let scope = fields;
    for (const key of match?.[1]?.split('.') || []) {
      field = scope?.find((candidate) => candidate.key === key);
      if (!field) {
        field = null;
        break;
      }
      scope = field.itemFields;
    }
    let valid = Boolean(field);
    if (valid && match[2] !== undefined) {
      try {
        const value = JSON.parse(match[2]);
        valid =
          field.type === 'enum' && enumOptionValues(field).includes(value);
      } catch {
        valid = false;
      }
    }
    if (!valid) invalid.push(ref);
  }
  return invalid;
}
