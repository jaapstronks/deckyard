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
 * ## The key is `users.id`, and nothing else
 *
 * A presentation carries an id per role since migration 063: `ownerId` and the
 * `createdBy` pair's `id`. **The id is the only key.** Two identities match when both
 * carry a `users.id` and the two are equal; a stamp whose id column is a
 * defined NULL — a legacy row, an external collaborator who never became a user
 * here — matches *nobody*, and no address is consulted to rescue it.
 *
 * That is a deliberate retirement (D22, decision (a), 2026-08-19). Until then
 * an id-less stamp fell back to comparing e-mail strings, and that fallback was
 * the reason an address had to travel in the response at all: the client mirrors
 * could not decide "is this mine?" without one. Removing the fallback is what
 * lets a response name a person as `{ id, displayName }` — see
 * docs/reference/identity-in-responses.md.
 *
 * What a NULL-id stamp costs is bounded: an ownerless deck is still reachable
 * through `owner_user_id`, which every current write path resolves in the same
 * statement that writes the address. Only rows stamped before an account
 * existed lose their *creator* claim, and the owner claim already covers them.
 *
 * ## The one actor without an id: the auth-off operator
 *
 * With `AUTH_ENABLED=false` there is a single trusted local operator, flagged
 * `unrestricted` (server/auth/auth.js). They are not a database user and never
 * will be, so they carry no id — and on that instance there is nobody to
 * distinguish them from: every stamp is theirs. {@link matchesIdentity} says so
 * outright rather than routing that case through an address comparison, which is
 * what the old fallback quietly did. The flag is set only by the auth-off path,
 * so it cannot widen access on an authenticated instance (`isUnrestricted()` in
 * server/utils/presentation-authz/presentations.js gates the same way).
 *
 * The development bypass (`AUTH_DEV_BYPASS`) *is* a database user: it resolves
 * `dev@local.test` to a real `users` row on session build (server/auth/dev-bypass.js),
 * precisely so it needs no exception here.
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
 * Nothing compares addresses to decide identity any more; this normalizes the
 * one remaining use, {@link hasIdentity}'s "is there an actor at all?".
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
 * @property {boolean} unrestricted - True for the auth-off single operator.
 */

/**
 * Read an actor's identity off a user-shaped object.
 *
 * Accepts the authed user the server builds in `getUserFromRequestAsync`, the
 * same object as `/api/auth/me` hands the client, the actor shape the machine
 * surfaces build in actor-access.js, and the bare `{ email }` objects tests and
 * legacy call sites pass. A missing id is normal, not an error — such an actor
 * simply matches no stamp; see the module header.
 *
 * @param {Object} [user] - The acting user
 * @returns {ActorIdentity}
 */
export function actorIdentity(user) {
  return {
    userId: user?.id || null,
    email: normalizeEmail(user?.email),
    unrestricted: user?.unrestricted === true,
  };
}

/**
 * Whether an actor can be identified at all.
 *
 * Guards the deciders the way the old `if (!userEmail) return false` did: an
 * actor with neither a user id nor an email is anonymous, and anonymous is
 * granted nothing. This is the "is anyone there?" question, not "who is this?" —
 * an actor known only by an address passes here and still matches no ownership
 * stamp, which is what leaves them the grants that rest on being *a* user
 * (organization visibility) without the ones that rest on being *the* user.
 *
 * @param {Object} [user] - The acting user
 * @returns {boolean}
 */
export function hasIdentity(user) {
  const { userId, email } = actorIdentity(user);
  return Boolean(userId || email);
}

/**
 * Whether an actor is the person a `(userId, …)` stamp names.
 *
 * Both sides must carry a `users.id`, and they must be equal. A stamp with no
 * id names nobody. The one exception is the auth-off operator, who is the only
 * person on their instance — see the module header.
 *
 * @param {Object} [user] - The acting user
 * @param {Object} [stamp] - The identity stamped on the record
 * @param {string|null} [stamp.userId] - The stamped `users.id`, if any
 * @returns {boolean}
 */
export function matchesIdentity(user, stamp = {}) {
  const actor = actorIdentity(user);
  // The single trusted operator of an auth-off install: every stamp is theirs.
  if (actor.unrestricted) return true;
  const stampedId = stamp?.userId || null;
  return Boolean(actor.userId && stampedId && actor.userId === stampedId);
}

/**
 * Whether an actor owns a presentation (is its owner *or* its creator).
 *
 * Owner and creator are distinct stamps that grant the same author-level
 * rights, and every decider that asked "is this their deck?" repeated both
 * comparisons. They are one question, so they are one function.
 *
 * One decider deliberately does *not* ask this question: ownership transfer
 * keys on the owner stamp alone ({@link isOwner}), because the creator stamp
 * is never rewritten and would otherwise outlive the hand-over (D43).
 *
 * @param {Object} [user] - The acting user
 * @param {Object} [pres] - The presentation
 * @returns {boolean}
 */
export function isOwnerOrCreator(user, pres) {
  if (!pres || typeof pres !== 'object') return false;
  return (
    matchesIdentity(user, { userId: pres.ownerId }) ||
    // The creator arrives as a display pair — `{ id, displayName }` — because
    // their address does not travel (D22); the owner keeps a flat `ownerId`
    // beside the address a reader of the deck may have. Different shapes, one
    // key: the `users.id` in both.
    matchesIdentity(user, { userId: pres.createdBy?.id })
  );
}

/**
 * Whether an actor is the person the deck's **owner** stamp names.
 *
 * Narrower than {@link isOwnerOrCreator} on purpose: this asks who holds the
 * deck *now*, not who ever held it. The creator stamp is create-only — nothing
 * rewrites `created_by` — so a decider that consults it grants a power the
 * person cannot lose by handing the deck over. That is right for the grants
 * that read as an author's mark (locking a slide, moderating its comments) and
 * wrong for the one grant that disposes of the deck itself: ownership transfer
 * (D43). Hence two functions rather than a flag.
 *
 * @param {Object} [user] - The acting user
 * @param {Object} [pres] - The presentation
 * @returns {boolean}
 */
export function isOwner(user, pres) {
  if (!pres || typeof pres !== 'object') return false;
  return matchesIdentity(user, { userId: pres.ownerId });
}
