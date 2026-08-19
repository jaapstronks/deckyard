/**
 * Identity resolver — map an external identifier to a stable `users.id`.
 *
 * This is the read-only first step of the identity-decoupling epic (T10, PR 1;
 * see docs/plans/briefs/identity-decoupling.md). Today every ownership/ACL
 * decision keys on an **email string**; the epic rebuilds that layer onto the
 * stable `users.id` UUID. Before any authz site can switch, it needs one place
 * that answers "which user is this identifier?" — that is this module. Nothing
 * is wired onto it in PR 1: it is built, documented and tested, and the authz
 * sites keep comparing emails until a later PR moves them over behind it.
 *
 * ## Why a *multi-identifier* shape, not an email→id swap
 *
 * The tempting shape is "replace the email column with an id column, one email
 * per user". The brief (2026-07-30) rules that out on purpose: a person is not
 * their email. Email is one *external identifier* among several a `users.id`
 * will accumulate — an SSO subject, and a permanent, relocatable, cryptographically
 * verifiable atproto DID (STRATEGY.md T12 / briefs/atproto-interop.md). So the
 * resolver is keyed on an `{ kind, value }` **identifier**, not on an email.
 * Adding a future source is a new `kind` plus a new lookup branch here — never a
 * second column swap across the ownership layer. Only `email` is backed today.
 *
 * ## The "no user record" path is defined, not implicit
 *
 * A well-formed identifier that matches no `users` row is a **normal, expected
 * state**, not an error: external collaborators (invited by email, never a user
 * on this instance) and legacy rows whose address never became an account both
 * live there. The resolver names that state explicitly (`resolved: false`,
 * `external: true`) instead of collapsing it into a bare `null` that a caller
 * might read as "lookup failed".
 * A caller that must keep the external identity (an external-collaborator email)
 * still gets the normalized `value` back. Only a structurally absent/blank
 * identifier returns `null`.
 *
 * @module storage/identity-resolver
 */

import { normalizeEmail } from '../utils/normalize.js';
import { getUserByEmailGlobal } from './identity.js';

/**
 * The kinds of external identifier a `users.id` can be resolved from.
 *
 * `EMAIL` is the only kind backed by a lookup today. `SSO_SUBJECT` and
 * `ATPROTO_DID` are named here so the resolver's contract already reserves them
 * — the epic's whole point is that these arrive as *additional* identifiers on
 * an existing `users.id`, not as replacements for the email column. Adding one
 * is a new branch in {@link resolveIdentity}, not a change to any caller.
 *
 * @readonly
 * @enum {string}
 */
export const IDENTIFIER_KINDS = {
  EMAIL: 'email',
  // Reserved for later PRs — not yet backed by a lookup (see module doc):
  // SSO_SUBJECT: 'sso_subject',
  // ATPROTO_DID: 'atproto_did',
};

/**
 * The result of resolving one external identifier.
 *
 * `resolved` and `external` are mutually exclusive: a returned resolution is
 * either backed by a `users` row (`resolved: true`, `userId` set) or a
 * well-formed identifier with no matching row (`external: true`, `userId: null`).
 * `value` is always the *normalized* identifier that was looked up, so a caller
 * can hold onto an external identity without re-normalizing.
 *
 * @typedef {Object} IdentityResolution
 * @property {string|null} userId - The resolved `users.id`, or null when no user row matches.
 * @property {string} kind - The identifier kind (one of {@link IDENTIFIER_KINDS}).
 * @property {string} value - The normalized identifier value that was looked up.
 * @property {boolean} resolved - True iff `userId` is set (a `users` row matched).
 * @property {boolean} external - True iff the identifier is well-formed but matched no
 *   user row (external collaborator or legacy data) — a defined state, not an error.
 */

/**
 * Resolve an external identifier to a stable `users.id`.
 *
 * Read-only: performs at most one lookup and mutates nothing. With no database
 * handle installed the lookup yields nothing, so every well-formed identifier
 * resolves `external` — the correct answer when there is no `users` table to
 * key on.
 *
 * @param {{ kind?: string, value?: string }} [identifier] - The identifier to resolve.
 *   `kind` defaults to `EMAIL`. `value` is normalized per kind.
 * @returns {Promise<IdentityResolution|null>} The resolution, or `null` when the
 *   identifier is structurally absent/blank (nothing to look up). A well-formed
 *   identifier that matches no user is **not** null — it is `{ resolved: false,
 *   external: true, userId: null, ... }`.
 * @throws {TypeError} When `kind` is not a supported {@link IDENTIFIER_KINDS} value.
 */
export async function resolveIdentity(identifier = {}) {
  const kind = identifier.kind || IDENTIFIER_KINDS.EMAIL;

  if (kind !== IDENTIFIER_KINDS.EMAIL) {
    // A future kind (SSO subject, atproto DID) is a new branch here, not a
    // silent failure — an unknown kind is a programming error, so fail loud.
    throw new TypeError(
      `resolveIdentity: unsupported identifier kind "${kind}"`,
    );
  }

  const value = normalizeEmail(identifier.value);
  if (!value) return null; // structurally absent — nothing to resolve

  const user = await getUserByEmailGlobal(value);
  if (!user) {
    return { userId: null, kind, value, resolved: false, external: true };
  }
  return { userId: user.id, kind, value, resolved: true, external: false };
}

/**
 * Convenience wrapper: resolve an email address to a `users.id`.
 *
 * Equivalent to `resolveIdentity({ kind: IDENTIFIER_KINDS.EMAIL, value: email })`.
 * The one kind wired today, given a direct name so email call sites read clearly
 * while still going through the multi-identifier contract above.
 *
 * @param {string} email - The email address to resolve.
 * @returns {Promise<IdentityResolution|null>} See {@link resolveIdentity}.
 */
export async function resolveIdentityByEmail(email) {
  return resolveIdentity({ kind: IDENTIFIER_KINDS.EMAIL, value: email });
}
