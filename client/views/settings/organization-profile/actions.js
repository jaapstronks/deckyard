/**
 * Organization profile reads and mutations (organization UI, slice 6).
 *
 * Unlike the member actions next door, none of these toast on failure. Both
 * mutations are driven from a surface that stays on screen and can say what
 * went wrong in place — the form's own status line, the delete dialog's — so
 * the rejection is handed back rather than reported here.
 */

import { api } from '../../../lib/api.js';

/** Profile fields this screen owns, in the order the form shows them. */
export const PROFILE_FIELDS = ['name', 'displayName', 'description', 'logoUrl'];

/**
 * Load the organization behind the current session.
 *
 * @param {string} organizationId - Organization to read.
 * @returns {Promise<{ organization: Object, membership: Object }>}
 */
export async function fetchOrganization(organizationId) {
  const res = await api(
    `/api/organizations/${encodeURIComponent(organizationId)}`,
  );
  return {
    organization: res?.organization || null,
    membership: res?.membership || null,
  };
}

/**
 * Write the changed profile fields.
 *
 * Only the fields that actually changed are sent. The route treats a key's
 * presence as intent — `'description' in body` clears the column when the value
 * is empty — so sending the whole form would turn an unrelated save into a
 * rewrite of every field, and would race anyone editing the other half of the
 * profile at the same time.
 *
 * @param {Object} options
 * @param {string} options.organizationId - Organization to update.
 * @param {Object} options.updates - Changed fields only.
 * @returns {Promise<Object>} The organization as the server now holds it.
 */
export async function saveOrganizationProfile({ organizationId, updates }) {
  const res = await api(
    `/api/organizations/${encodeURIComponent(organizationId)}`,
    {
      method: 'PATCH',
      body: updates,
    },
  );
  return res?.organization || null;
}

/**
 * Delete the organization and everything that hangs off it.
 *
 * @param {Object} options
 * @param {string} options.organizationId - Organization to delete.
 * @returns {Promise<void>}
 */
export async function deleteOrganization({ organizationId }) {
  await api(`/api/organizations/${encodeURIComponent(organizationId)}`, {
    method: 'DELETE',
  });
}

/**
 * Which profile fields differ from what was loaded.
 *
 * An empty string is sent as `null`, because that is what the route stores for
 * one ("" is falsy there) and comparing the two forms of "nothing" as different
 * values would make every empty field look edited on every save.
 *
 * @param {Object} original - Organization as loaded.
 * @param {Object} draft - Values currently in the form.
 * @returns {Object} The changed subset, ready to send.
 */
export function changedFields(original, draft) {
  const updates = {};
  for (const field of PROFILE_FIELDS) {
    const before = normalize(original?.[field]);
    const after = normalize(draft?.[field]);
    if (before !== after) updates[field] = after;
  }
  return updates;
}

/**
 * A profile value in the one shape both sides can be compared in.
 * @param {*} value - Raw field value.
 * @returns {string|null}
 */
function normalize(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}
