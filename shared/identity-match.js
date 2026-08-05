/**
 * Identity matching — "is this actor that person?"
 *
 * This is the one place, on **both sides of the wire**, that answers whether an
 * acting user *is* the identity stamped on a deck (its owner, its creator). The
 * server's deciders (`presentation-authz/`), the collection and machine-client
 * filters, and the client's advisory mirrors (`comment-authz.js`,
 * `slide-lock-authz.js`, the share modal) all route through here, so the rule
 * exists once rather than being re-derived per surface — which is how the client
 * and server came to disagree about who an owner was in the first place (T10;
 * see docs/plans/briefs/identity-decoupling.md).
 *
 * It lives in `shared/` for that reason and imports nothing: the rule is pure
 * comparison, and a client mirror that had to import server code would be no
 * mirror at all.
 *
 * ## The key is `users.id`, with email as the fallback identifier
 *
 * A presentation carries two parallel stamps per role since migration 063:
 * `ownerId`/`ownerEmail`, `createdById`/`createdBy`. The id is the key:
 *
 *   1. **Both sides carry an id → the ids decide.** No email is consulted.
 *   2. **Either side lacks one → the emails decide**, exactly as before.
 *
 * Case 2 is not a second key, it is the *defined absence* of the first one, and
 * it covers three real shapes the resolver already names (identity-resolver.js):
 * file mode, which has no `users` table and keeps identity in the deck JSON;
 * legacy/external rows whose email never matched a `users` row, so the id column
 * is a defined NULL; and the auth-off operator and dev bypass, which are not
 * database users at all. Those shapes must keep working, which is why the
 * fallback exists — not to let a caller choose which key to identify someone by.
 *
 * The two keys cannot disagree on data this codebase writes: every write path
 * resolves the id *from* the email in the same statement (the dual-key invariant,
 * PR 2/PR 3), and nothing updates a `users.email` afterwards. Where they ever
 * did disagree the id wins by rule 1 — that is the whole point of a stable key,
 * and it is why this module prefers rather than merely supplements it.
 *
 * The functions here are pure: they read the objects handed to them and touch no
 * storage. Resolving an email-only actor (an API key owner) to a `users.id`
 * happens at the boundary, in server/utils/presentation-authz/actor-access.js,
 * before it reaches this module.
 *
 * The client's copies are **advisory UI only** — they decide which affordance to
 * show, never whether an operation is allowed. Enforcement is the server's, on
 * the same rule.
 *
 * @module shared/identity-match
 */

/**
 * Normalize an email for comparison: trimmed, lowercased, '' when absent.
 *
 * A local copy rather than an import, because this module is shared and the
 * server's `normalizeEmail` (which answers `null`) lives in server code. Same
 * comparison, no dependency.
 *
 * @param {string} [email]
 * @returns {string}
 */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * The identity an actor carries into an authorization decision.
 *
 * @typedef {Object} ActorIdentity
 * @property {string|null} userId - Stable `users.id`, when the actor has one.
 * @property {string} email - Normalized email, or '' when the actor has none.
 */

/**
 * Read an actor's identity off a user-shaped object.
 *
 * Accepts the authed user the server builds in `getUserFromRequestAsync`, the
 * same object as `/api/auth/me` hands the client, the actor shape the machine
 * surfaces build in actor-access.js, and the bare `{ email }` objects tests and
 * legacy call sites pass. A missing id is normal, not an error — see the module
 * header.
 *
 * @param {Object} [user] - The acting user
 * @returns {ActorIdentity}
 */
export function actorIdentity(user) {
  return {
    userId: user?.id || null,
    email: normalizeEmail(user?.email),
  };
}

/**
 * Whether an actor can be identified at all.
 *
 * Guards the deciders the way the old `if (!userEmail) return false` did: an
 * actor with neither a user id nor an email is anonymous, and anonymous never
 * matches an ownership stamp. It now passes on an id alone, so a future
 * identity source (SSO subject, atproto DID) that arrives without an email is
 * not silently locked out.
 *
 * @param {Object} [user] - The acting user
 * @returns {boolean}
 */
export function hasIdentity(user) {
  const { userId, email } = actorIdentity(user);
  return Boolean(userId || email);
}

/**
 * Whether an actor is the person a `(userId, email)` stamp names.
 *
 * @param {Object} [user] - The acting user
 * @param {Object} [stamp] - The identity stamped on the record
 * @param {string|null} [stamp.userId] - The stamped `users.id`, if any
 * @param {string} [stamp.email] - The stamped email, if any
 * @returns {boolean}
 */
export function matchesIdentity(user, stamp = {}) {
  const actor = actorIdentity(user);
  const stampedId = stamp?.userId || null;

  // 1. Both sides carry the stable key: it alone decides.
  if (actor.userId && stampedId) return actor.userId === stampedId;

  // 2. One side has no id (file mode, external/legacy row, auth-off operator):
  //    fall back to the email identifier, which is what those shapes carry.
  const stampedEmail = normalizeEmail(stamp?.email);
  return Boolean(actor.email && stampedEmail && actor.email === stampedEmail);
}

/**
 * Whether an actor owns a presentation (is its owner *or* its creator).
 *
 * Owner and creator are distinct stamps that grant the same author-level
 * rights, and every decider that asked "is this their deck?" repeated both
 * comparisons. They are one question, so they are one function.
 *
 * @param {Object} [user] - The acting user
 * @param {Object} [pres] - The presentation
 * @returns {boolean}
 */
export function isOwnerOrCreator(user, pres) {
  if (!pres || typeof pres !== 'object') return false;
  return (
    matchesIdentity(user, { userId: pres.ownerId, email: pres.ownerEmail }) ||
    matchesIdentity(user, { userId: pres.createdById, email: pres.createdBy })
  );
}
