/**
 * Per-deck access for MCP tools — the MCP adapter over
 * {@link loadPresentationForActor} (`server/services/presentations.js`, B519).
 *
 * MCP sessions act as a single user identified by email: the API key owner
 * (SSE transport) or DECKYARD_MCP_OWNER_EMAIL (stdio). The service loads the
 * deck and decides with that owner as the actor — the same collaborator-aware
 * deciders the editor routes and the public API use — and throws `NotFoundError`
 * (no such deck in this scope) or `ForbiddenError` (the deck is there, the
 * right is not; D255). The tool dispatcher renders either as a tool error.
 *
 * When no owner is configured (stdio without DECKYARD_MCP_OWNER_EMAIL) the
 * session is a local, trusted, single-user process with full filesystem
 * access anyway. It acts as the unrestricted operator, the same actor an
 * auth-disabled install hands its one user, matching list_presentations'
 * "no owner filter" behavior.
 */

import { loadPresentationForActor } from '../services/presentations.js';

/**
 * Load a presentation by id and enforce the owner's access to it.
 *
 * The session's own organization comes off the storage scope — an SSE session
 * acts in the organization its API key belongs to — so the organization-wide
 * grant is decided against the session, not against the deck being checked
 * (L10).
 *
 * @param {Object} storageScope - Storage scope (see server/storage/scope.js)
 * @param {string} presentationId - Presentation ID
 * @param {string|null} ownerEmail - Acting owner email (null = trusted local session)
 * @param {Object} [options]
 * @param {'read'|'write'|'delete'|'manage'|'comment'} [options.access='read'] - Required access level
 * @returns {Promise<Object>} The presentation
 * @throws {Error} Without an id; `NotFoundError` / `ForbiddenError` from the service
 */
export async function loadPresentationChecked(
  storageScope,
  presentationId,
  ownerEmail,
  { access = 'read' } = {},
) {
  if (!presentationId) {
    throw new Error(
      'A presentation id is required (pass `id` or `presentationId`).',
    );
  }
  return loadPresentationForActor(
    storageScope,
    { actor: mcpActor(storageScope, ownerEmail) },
    presentationId,
    { access },
  );
}

/**
 * The actor an MCP session acts as: its owner in the organization of its own
 * storage scope, never the deck's (L10), or the unrestricted operator for a
 * trusted local session without an owner. Every MCP handling that asks a
 * service builds its actor here, so a deck the session may load is a deck it
 * may copy or comment on under the same identity.
 *
 * @param {Object} storageScope - The session's storage scope.
 * @param {string|null} ownerEmail - Acting owner email (null = trusted local session)
 * @returns {import('../services/actor.js').Actor}
 */
export function mcpActor(storageScope, ownerEmail) {
  return ownerEmail
    ? {
        email: ownerEmail,
        organizationId: storageScope?.organizationId || null,
      }
    : { email: null, unrestricted: true };
}
