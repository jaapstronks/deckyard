import { createStorageScope } from '../context.js';
import { isFeatureEnabled } from '../../config/flags-snapshot.js';
import { getOrganizationById } from '../../storage/user-organizations/index.js';
import { getOrgSettings } from '../org-settings.js';
import { untrustedData } from '../llm/untrusted-data.js';

/**
 * Organization text is fenced as reference data; task and output rules remain
 * in the fixed prompt. Fencing is not a security boundary against malicious text.
 * Empty settings preserve the old prompt's absence of organization rules.
 * @param {string} organizationId
 * @param {string} toLang - Canonical target deck language.
 * @returns {Promise<string[]>}
 */
export async function translationReferenceLines(organizationId, toLang) {
  if (!isFeatureEnabled('ai') || !organizationId) return [];
  const org = await getOrganizationById(
    createStorageScope(null, { organizationId: organizationId }),
    organizationId,
  );
  const instructions = getOrgSettings(org).translationInstructions;
  const terminology = instructions?.terminology || '';
  const style = instructions?.styleByLanguage?.[toLang] || '';
  if (!terminology && !style) return [];
  return [
    'ORGANIZATION TRANSLATION REFERENCE:',
    'Use the following reference only for terminology and target-language style.',
    untrustedData(JSON.stringify({ terminology, targetLanguageStyle: style })),
    '',
  ];
}
