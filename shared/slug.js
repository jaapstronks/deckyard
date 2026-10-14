/** Maximum length of a definition or published URL slug. */
export const MAX_SLUG_LEN = 80;

/**
 * Derive a slug from a human label. Explicitly supplied slugs are validated,
 * never passed through this function.
 * @param {string} input
 * @param {{maxLength?: number, fallback?: string}} [options]
 * @returns {string}
 */
export function generateSlug(
  input,
  { maxLength = MAX_SLUG_LEN, fallback = '' } = {},
) {
  const slug = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
  return slug || fallback;
}

/**
 * Whether an explicit slug has the canonical spelling and allowed length.
 * @param {unknown} slug
 * @param {{minLength?: number, maxLength?: number}} [options]
 * @returns {boolean}
 */
export function isValidSlug(
  slug,
  { minLength = 1, maxLength = MAX_SLUG_LEN } = {},
) {
  return (
    typeof slug === 'string' &&
    slug.length >= minLength &&
    slug.length <= maxLength &&
    /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(slug)
  );
}
