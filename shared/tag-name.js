/**
 * What a tag name may be — one rule, read by the server and the editor.
 *
 * The rule used to exist three times and agree nowhere: `PUT .../tags` checked
 * only that the body held an array, the tag writer silently dropped blank and
 * over-long names, and `createTag` threw its own 400 for a subset of the same
 * cases. Two names the column could not carry — one with a NUL byte, and a
 * pair that PostgreSQL's `lower()` folds together while JavaScript's does not —
 * reached the database and came back as a 500 (B370).
 *
 * The rule lives here so the client can refuse a name at the point the user
 * types it and the server can refuse the same name from any other client. The
 * server is the enforcer; this module is the rule, not a trust boundary.
 *
 * **What is not here**: deciding whether two names are the *same* tag. The
 * database owns that — `idx_tags_org_name` is unique on
 * `(organization_id, lower(name))`, and `lower()` is PostgreSQL's, not
 * JavaScript's. A second fold in application code is a second authority on tag
 * identity, and that disagreement is what crashed the write.
 *
 * @module shared/tag-name
 */

/** The widest a tag name may be — `tags.name` is a `varchar(100)`. */
export const MAX_TAG_NAME_LENGTH = 100;

/**
 * Control characters, NUL included. A tag name is a label a person reads, and
 * none of these render as one; PostgreSQL refuses NUL in text outright
 * (`22021`), which used to reach the client as a 500.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * @typedef {'blank'|'too_long'|'control_character'} TagNameProblem
 */

/**
 * Check one tag name.
 *
 * Trimming is a normalization: `' Sales '` and `'Sales'` are the same label,
 * and dropping the padding changes nothing the user meant. Everything else is
 * a **refusal** rather than a repair — a name that cannot be stored is said
 * out loud, never quietly discarded.
 *
 * @param {*} raw
 * @returns {{ok: true, name: string}|{ok: false, code: TagNameProblem}}
 */
export function checkTagName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, code: 'blank' };
  if (name.length > MAX_TAG_NAME_LENGTH) return { ok: false, code: 'too_long' };
  if (CONTROL_CHARACTERS.test(name)) {
    return { ok: false, code: 'control_character' };
  }
  return { ok: true, name };
}

/**
 * The English sentence for each problem. The server sends these as the
 * refusal's `message`; the client looks the code up in its own translations
 * and falls back to these.
 * @type {Readonly<Record<TagNameProblem, string>>}
 */
export const TAG_NAME_MESSAGES = Object.freeze({
  blank: 'A tag name cannot be empty.',
  too_long: `A tag name is at most ${MAX_TAG_NAME_LENGTH} characters.`,
  control_character: 'A tag name cannot contain control characters.',
});
