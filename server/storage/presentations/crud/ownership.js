/**
 * CRUD ownership operations.
 */

import { writePresentation } from '../io.js';
import { normalizePresentationScope } from '../../../utils/presentation-authz.js';
import { normalizeEmail, nowIso } from '../../../utils/normalize.js';
import { ForbiddenError, ValidationError } from '../../../utils/errors.js';
import { getPresentation } from './read.js';
import { normalizeMeta } from './helpers.js';

/**
 * Claim ownership of a legacy presentation (one without owner/creator).
 * Sets the ownerEmail, createdBy, updatedBy, and optionally the scope.
 *
 * @param {string} repoRoot - Repository root path
 * @param {string} id - Presentation ID
 * @param {Object} opts - Options (ownerEmail, scope)
 * @returns {Promise<Object|null>} Updated presentation or null
 */
export async function claimPresentationOwnership(repoRoot, id, opts = {}) {
  const existing = await getPresentation(repoRoot, id);
  if (!existing) return null;

  // Only allow claiming if there's no owner and no creator
  const owner = normalizeEmail(existing?.ownerEmail);
  const createdBy = normalizeEmail(existing?.createdBy);
  if (owner || createdBy) {
    throw new ForbiddenError('Cannot claim ownership: presentation already has an owner');
  }

  const newOwner = normalizeEmail(opts?.ownerEmail);
  if (!newOwner) {
    throw new ValidationError('Owner email is required');
  }

  const now = nowIso();
  const updated = {
    ...existing,
    ownerEmail: newOwner,
    createdBy: newOwner,
    updatedBy: newOwner,
    modified: now,
    revision: (Number(existing.revision) || 1) + 1,
  };

  // Optionally set scope (default to private)
  if (opts?.scope) {
    updated.scope = normalizePresentationScope(opts.scope);
  }

  await writePresentation(repoRoot, updated);
  return normalizeMeta(updated);
}
