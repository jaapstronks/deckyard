/**
 * Load org-level slide type configuration for AI generation.
 * Shared by both the internal API and the public API v1.
 */

import { getOrganizationById } from '../storage/user-organizations/index.js';
import { listPublishedCustomSlideTypes } from '../storage/custom-slide-types.js';
import { getOrgSettings } from './org-settings.js';

/**
 * Load org-level disabled slide types for AI filtering.
 * @param {Object} ctx - Object with organizationId (authedUser or apiKey)
 * @returns {Promise<string[]>}
 */
export async function loadDisabledSlideTypes(ctx) {
  try {
    const orgId = ctx?.organizationId;
    const org = await getOrganizationById(orgId);
    const settings = getOrgSettings(org);
    return Array.isArray(settings.disabledSlideTypes) ? settings.disabledSlideTypes : [];
  } catch {
    return [];
  }
}

/**
 * Load published custom slide types for the given organization.
 * Used to include custom types in AI generation prompts.
 * @param {Object} ctx - Object with organizationId (authedUser or apiKey)
 * @returns {Promise<Array>}
 */
export async function loadCustomSlideTypes(ctx) {
  try {
    const orgId = ctx?.organizationId;
    return await listPublishedCustomSlideTypes({ organizationId: orgId });
  } catch {
    return [];
  }
}
