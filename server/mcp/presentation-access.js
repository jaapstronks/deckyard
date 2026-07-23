/**
 * Per-deck access checks for MCP tools.
 *
 * MCP sessions act as a single user identified by email: the API key owner
 * (SSE transport) or DECKYARD_MCP_OWNER_EMAIL (stdio). Tools that fetch a
 * deck by id must verify that this owner may read (and for mutating tools,
 * write) that specific deck — the same collaborator-aware checks the editor
 * routes use.
 *
 * When no owner is configured (stdio without DECKYARD_MCP_OWNER_EMAIL) the
 * session is a local, trusted, single-user process with full filesystem
 * access anyway; per-deck checks are skipped, matching list_presentations'
 * "no owner filter" behavior.
 */

import { getPresentation } from '../storage/presentations.js';
import {
  canActorAccessPresentation,
  canDeletePresentation,
} from '../utils/presentation-authz.js';

/**
 * Load a presentation by id and enforce the owner's access to it.
 *
 * @param {string} repoRoot - Repository root path
 * @param {string} presentationId - Presentation ID
 * @param {string|null} ownerEmail - Acting owner email (null = trusted local session)
 * @param {Object} [options]
 * @param {'read'|'write'|'delete'} [options.access='read'] - Required access level
 * @returns {Promise<Object>} The presentation
 * @throws {Error} If the deck is missing, not readable, or lacks the required access
 */
export async function loadPresentationChecked(
  repoRoot,
  presentationId,
  ownerEmail,
  { access = 'read' } = {}
) {
  if (!presentationId) {
    throw new Error('A presentation id is required (pass `id` or `presentationId`).');
  }
  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) throw new Error(`Presentation not found: ${presentationId}`);

  if (!ownerEmail) return pres; // trusted local session, no owner configured

  // Read is the baseline for every access level. Fail with the same message
  // as "not found" so unreadable decks don't leak their existence.
  if (!(await canActorAccessPresentation(pres, ownerEmail, 'read'))) {
    throw new Error(`Presentation not found or not accessible: ${presentationId}`);
  }

  if (access === 'write' && !(await canActorAccessPresentation(pres, ownerEmail, 'write'))) {
    throw new Error(`You have read-only access to this presentation: ${presentationId}`);
  }

  if (access === 'delete' && !canDeletePresentation({ user: { email: ownerEmail }, pres })) {
    throw new Error(`Only the presentation owner can delete it: ${presentationId}`);
  }

  return pres;
}
