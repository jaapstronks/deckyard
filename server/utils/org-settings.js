/**
 * Safely extract settings object from an organization record.
 * @param {Object} org - Organization record
 * @returns {Object} Settings object, or empty object if missing/invalid
 */
export function getOrgSettings(org) {
  return org?.settings && typeof org.settings === 'object' ? org.settings : {};
}

/** Remove admin-only translation rules from a settings response. */
export function publicOrgSettings(settings) {
  const { translationInstructions: _private, ...publicSettings } =
    settings || {};
  return publicSettings;
}

/** Generic organization routes never expose translation rules. */
export function publicOrganization(organization) {
  return {
    ...organization,
    settings: publicOrgSettings(organization.settings),
  };
}
