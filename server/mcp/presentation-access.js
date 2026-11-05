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
import { resolveIdentityByEmail } from '../storage/identity-resolver.js';
import { ValidationError } from '../utils/errors.js';

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
 * @throws {ValidationError} Without an id; `NotFoundError` / `ForbiddenError` from the service
 */
export async function loadPresentationChecked(
  storageScope,
  presentationId,
  ownerEmail,
  { access = 'read' } = {},
) {
  if (!presentationId) {
    throw new ValidationError(
      'A presentation id is required (pass `presentationId`).',
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

/**
 * Why a stdio session cannot act as its configured owner, or `null` (DY-843).
 *
 * A deck is created with the owner's `users.id` beside the address; an owner
 * with no `users` row resolves `external` and the deck is stamped without
 * one. Ownership is decided on that id, so every later read of the deck was
 * `forbidden` with no hint why. The stdio entrypoint asks this before it
 * serves, with the same lookup the create uses, and refuses to start.
 *
 * @param {Object} storageScope - The scope the session's tools act in
 * @param {string|null} ownerEmail - DECKYARD_MCP_OWNER_EMAIL, or null
 * @returns {Promise<string|null>} the refusal text, or null when it can act
 */
export async function stdioOwnerError(storageScope, ownerEmail) {
  if (!ownerEmail) return null;
  const resolution = await resolveIdentityByEmail(storageScope, ownerEmail);
  if (resolution?.userId) return null;
  return (
    `DECKYARD_MCP_OWNER_EMAIL is ${JSON.stringify(ownerEmail)}, but no user ` +
    'with that address exists in this installation. Decks created in this ' +
    'session would belong to nobody who can open them. Sign in to the web ' +
    'app once with that address, set the variable to an existing user, or ' +
    'unset it to act as the local operator.'
  );
}
