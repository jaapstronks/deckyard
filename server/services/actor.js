/**
 * Who a service call acts as (D253).
 *
 * A service in `server/services/` takes `(scope, identity, input)`; this module
 * names the identity half. There is one actor type on all three contracts, so a
 * rule decided in a service reads the same whoever asked:
 *
 *   - the internal `/api` routes pass the session's `authedUser` (its `id` is
 *     already resolved, so the identity resolver short-circuits);
 *   - the public v1 API passes `ctx.authedUser`: the key owner, with the key's
 *     organization;
 *   - MCP passes `actorOf(context)`: the session owner, with the session's
 *     organization.
 *
 * A share-link guest is not an actor: they have no `users` row, only the
 * `share_link_guests` row they verified an address against. A service that
 * admits guests (comments) takes `{ actor }` **or** `{ guest, shareLink }`,
 * never both, and only the internal contract ever produces a guest.
 *
 * The deciders in `server/utils/presentation-authz/actor-access.js` take this
 * type; that is where "an actor is an identity *and* an organization" is
 * explained.
 *
 * @module server/services/actor
 */

/**
 * The acting person.
 *
 * @typedef {Object} Actor
 * @property {string|null} [id] - `users.id`, when the contract already resolved
 *   it; otherwise the deciders resolve it from `email`.
 * @property {string} email - The identity the contract holds (session user,
 *   API-key owner, MCP session owner). Also the attribution address.
 * @property {string|null} [organizationId] - The organization the session or
 *   key acts in.
 * @property {string} [name] - Display name, when the contract knows one.
 * @property {true} [unrestricted] - The single trusted local operator: the
 *   auth-off user (`server/auth/auth.js`, internal contract) or an MCP stdio
 *   session without a configured owner (`server/mcp/presentation-access.js`).
 */

/**
 * A verified share-link guest, as the internal contract resolves it from the
 * `share_guest_session` cookie.
 *
 * @typedef {Object} GuestIdentity
 * @property {{ id: string, email: string, name?: string, verifiedAt?: string|null }} guest
 * @property {{ presentationId: string, permission: string, revokedAt?: string|null, expiresAt?: string|null }} shareLink
 */

/**
 * The identity half of a service call: an actor, or (where a service admits
 * one) a guest.
 *
 * @typedef {{ actor: Actor } | GuestIdentity} ServiceIdentity
 */

export {};
