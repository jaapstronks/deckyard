/**
 * Shared storage helpers for custom-slide-types and font-families.
 * DRY: these functions were duplicated across both storage modules.
 */

const MAX_SLUG_LEN = 80;

export function parseJson(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'object') return val; // already parsed by Kysely
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

export function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN);
}

export function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.length > MAX_SLUG_LEN) return false;
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);
}

export async function getUserIdByEmail(db, orgId, email) {
  const user = await db
    .selectFrom('users')
    .select('id')
    .where('organization_id', '=', orgId)
    .where('email', '=', email)
    .executeTakeFirst();
  return user?.id || null;
}
