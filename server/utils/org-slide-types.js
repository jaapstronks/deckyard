/**
 * Load org-level slide type configuration for AI generation.
 * Shared by both the internal API and the public API v1.
 */

import { getOrganizationById } from '../storage/user-organizations/index.js';
import { listPublishedCustomSlideTypes } from '../storage/custom-slide-types.js';
import { getOrgSettings } from './org-settings.js';
import { isFeatureEnabled } from '../config/flags-snapshot.js';
import { SLIDE_TYPES } from '../../shared/slide-types.js';
import { clusterOffSlideTypes } from '../../shared/slide-types/policy.js';

/**
 * Load the slide types an organization may not insert, for AI filtering and
 * `get_slide_types`: its own `disabledSlideTypes` plus the types whose
 * installation cluster is off, which count as org-disabled (D260).
 * @param {Object} ctx - Object with organizationId (authedUser or apiKey)
 * @returns {Promise<string[]>}
 */
export async function loadDisabledSlideTypes(ctx) {
  return [
    ...new Set([
      ...(await loadOrgDisabledSlideTypes(ctx)),
      ...clusterOffSlideTypes(SLIDE_TYPES, isFeatureEnabled),
    ]),
  ];
}

/**
 * The organization's own curation (`disabledSlideTypes` in its settings).
 * @param {Object} ctx - Object with organizationId (authedUser or apiKey)
 * @returns {Promise<string[]>}
 */
async function loadOrgDisabledSlideTypes(ctx) {
  try {
    const orgId = ctx?.organizationId;
    const org = await getOrganizationById(orgId);
    const settings = getOrgSettings(org);
    return Array.isArray(settings.disabledSlideTypes)
      ? settings.disabledSlideTypes
      : [];
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
