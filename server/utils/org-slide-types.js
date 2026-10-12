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
import { resolveScope } from '../storage/scope.js';

/**
 * Load the slide types an organization may not insert, for AI filtering and
 * `get_slide_types`: its own `disabledSlideTypes` plus the types whose
 * installation cluster is off, which count as org-disabled (D260).
 * @param {import('../storage/scope.js').StorageScope} scope
 * @returns {Promise<string[]>}
 */
export async function loadDisabledSlideTypes(scope) {
  const { organizationId } = resolveScope(scope, 'loadDisabledSlideTypes');
  return [
    ...new Set([
      ...(await loadOrgDisabledSlideTypes(organizationId)),
      ...clusterOffSlideTypes(SLIDE_TYPES, isFeatureEnabled),
    ]),
  ];
}

/**
 * The organization's own curation (`disabledSlideTypes` in its settings).
 * @param {string} organizationId
 * @returns {Promise<string[]>}
 */
async function loadOrgDisabledSlideTypes(organizationId) {
  const org = await getOrganizationById(organizationId);
  const settings = getOrgSettings(org);
  return Array.isArray(settings.disabledSlideTypes)
    ? settings.disabledSlideTypes
    : [];
}

/**
 * The slide types an organization offers to the model: what it may not
 * insert, and its published custom types. Every AI generation path offers
 * this one catalog, imports and MCP included (B659); spread it into the
 * generator's options.
 * @param {import('../storage/scope.js').StorageScope} scope
 * @returns {Promise<{ disabledSlideTypes: string[], customSlideTypes: Array }>}
 */
export async function loadSlideTypeOffer(scope) {
  resolveScope(scope, 'loadSlideTypeOffer');
  const [disabledSlideTypes, customSlideTypes] = await Promise.all([
    loadDisabledSlideTypes(scope),
    loadCustomSlideTypes(scope),
  ]);
  return { disabledSlideTypes, customSlideTypes };
}

/**
 * Load published custom slide types for the given organization.
 * Used to include custom types in AI generation prompts.
 * @param {import('../storage/scope.js').StorageScope} scope
 * @returns {Promise<Array>}
 */
export async function loadCustomSlideTypes(scope) {
  resolveScope(scope, 'loadCustomSlideTypes');
  return listPublishedCustomSlideTypes(scope);
}
