/**
 * Server configuration utilities.
 */

/**
 * Get allowed hosts for URL generation and validation.
 * Returns an array of allowed host values from ALLOWED_HOSTS env variable.
 * If not configured, returns an empty array (allows any host).
 * @returns {string[]} Array of allowed hosts
 */
export function getAllowedHosts() {
  const envValue = process.env.ALLOWED_HOSTS || '';
  if (!envValue.trim()) {
    return [];
  }
  return envValue
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}