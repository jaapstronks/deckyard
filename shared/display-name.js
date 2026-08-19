/**
 * Display-name derivation — the one place that turns an identifier into
 * something a human reads.
 *
 * Lives in `shared/` for the same reason `identity-match.js` does: the server
 * now stamps `displayName` onto every API response that names a person (D22),
 * and the client still has to derive one for the identities it holds locally
 * (its own session, a presence peer). Two copies of "capitalize the local
 * part" is how the client and the server came to disagree about who someone
 * was in the first place, so the rule exists once and both sides import it.
 *
 * It imports nothing on purpose. In particular it does **not** answer
 * "Unknown" for a blank input: that is a user-facing string, and the two sides
 * localize differently (the client through `ui-i18n`, the server not at all).
 * A blank input yields `''` — the absence, not a rendering of it — and each
 * side decides what to show for it. See `client/lib/user/user-format.js` for
 * the localized wrapper.
 *
 * @module shared/display-name
 */

/**
 * Derive a display name from an email address.
 *
 * The local part is the only human-meaningful piece of an address, so it is
 * split on the separators people actually use (`.`, `_`, `-`), capitalized,
 * and capped at three words — enough for "Jaap Willem Stronks", short enough
 * that a role address like `no-reply-automation-bot@` cannot blow out a card.
 *
 * A value with no `@` is returned as-is: callers pass stored display names
 * through here too, and a real name must survive untouched.
 *
 * @param {string} [email] - Email address, or an already-human name.
 * @returns {string} The derived display name, or `''` when there is nothing to
 *   derive from. Never `null` — callers branch on emptiness, not on type.
 */
export function displayNameFromEmail(email) {
  const raw = String(email || '').trim();
  if (!raw) return '';
  if (!raw.includes('@')) return raw;
  const local = raw.split('@')[0];
  const cleaned = local
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return raw;
  const cap = (s) => s.slice(0, 1).toUpperCase() + s.slice(1);
  return parts.slice(0, 3).map(cap).join(' ');
}
