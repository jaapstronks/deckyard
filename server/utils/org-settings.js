/**
 * Safely extract settings object from an organization record.
 * @param {Object} org - Organization record
 * @returns {Object} Settings object, or empty object if missing/invalid
 */
export function getOrgSettings(org) {
  return org?.settings && typeof org.settings === 'object' ? org.settings : {};
}
