/** Shared limits for descriptive image alternatives, including AI output. */
export const ALT_TEXT_CONSTRAINTS = Object.freeze({
  maxLength: 180,
  overflow: 'truncate',
});

/**
 * Shorten text at a word boundary, reserving one UTF-16 code unit for an
 * ellipsis. Length follows HTML maxlength and field validation. A single long
 * word is clipped, never between a surrogate pair; short values stay intact.
 * @param {string} value
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateFieldText(value, maxLength) {
  if (value.length <= maxLength) return value;
  let prefix = value.slice(0, maxLength - 1);
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  const boundary = prefix.search(/\s+\S*$/u);
  if (boundary > 0) prefix = prefix.slice(0, boundary);
  return prefix.trimEnd() + '…';
}

/**
 * Canonical value for an explicitly truncating field. Other text retains its
 * strict maxLength refusal. Collections recurse through their declarations.
 * @param {unknown} value
 * @param {Object} field
 * @returns {unknown}
 */
export function normalizeFieldValue(value, field) {
  if (
    field?.type === 'string' &&
    field.overflow === 'truncate' &&
    Number.isInteger(field.maxLength) &&
    field.maxLength > 0 &&
    typeof value === 'string'
  )
    return truncateFieldText(value, field.maxLength);
  if (field?.type === 'items' && Array.isArray(value)) {
    const items = value.map((item) =>
      normalizeFieldContent(field.itemFields, item),
    );
    return items.some((item, index) => item !== value[index]) ? items : value;
  }
  return value;
}

/**
 * Fold declared values without modifying the caller's content or item objects.
 * @param {Array<Object>} fields
 * @param {Object} content
 * @returns {Object} normalized content
 */
export function normalizeFieldContent(fields, content) {
  if (!content || typeof content !== 'object' || Array.isArray(content))
    return content;
  let result = content;
  for (const field of fields || []) {
    if (!Object.hasOwn(content, field.key)) continue;
    const value = normalizeFieldValue(content[field.key], field);
    if (value === content[field.key]) continue;
    if (result === content) result = { ...content };
    result[field.key] = value;
  }
  return result;
}
