/**
 * Store every slide-library language version under its canonical key (B482).
 *
 * Migration 083 did this for decks. The library had its own write seam, and
 * until B482 it stored the `i18n` of a create as sent: a version under `en`
 * landed as-is, where `pickVersion`-style readers (they read the canonical key
 * only) never find it. The UI always sent canonical keys, with one exception:
 * when the slide had no version to copy, the modal keyed the one it built by
 * the deck's `i18n.active`, which 1.0.0 stored unnormalized. So a stored alias
 * is unlikely but not ruled out.
 *
 * `dominant` comes along: `mergeLibraryI18n` writes `versions[dominant]` on
 * every content PATCH, so an alias `dominant` would mint the alias key again
 * on the next edit.
 *
 * Rule, per row (the same as 083 for the keys):
 * - an alias key (`en`) whose canonical key (`en-GB`) the item does not carry
 *   is **renamed** to it;
 * - anything else (an off-axis key, or an alias next to its canonical key) is
 *   **left alone and logged** with the item id: choosing between two versions
 *   of one language is an operator's call on real content;
 * - an alias `dominant` becomes its canonical value; one off the axis is
 *   logged.
 *
 * Only rows with a non-canonical key or `dominant` are read (SQL filter).
 * Idempotent: a second run renames nothing and logs the same leftovers.
 */

import { sql } from 'kysely';

import { createLogger } from '../../utils/logger.js';

const log = createLogger('migration-084');

// The axis and its aliases as they stood when this migration was written — a
// literal, like 083's, so a later run does what was tested.
const CANONICAL_LANGS = Object.freeze([
  'nl',
  'en-GB',
  'de',
  'fr',
  'es',
  'pt',
  'it',
  'pl',
  'fi',
  'da',
  'sv',
  'no',
]);
const LANG_ALIASES = Object.freeze({ en: 'en-GB' });

/**
 * @param {string} lang
 * @returns {string|null} the canonical form, or `null` off the axis
 */
function canonicalLang(lang) {
  if (Object.hasOwn(LANG_ALIASES, lang)) return LANG_ALIASES[lang];
  return CANONICAL_LANGS.includes(lang) ? lang : null;
}

/**
 * Canonicalize the version keys and `dominant` of one library `i18n` block.
 *
 * @param {unknown} i18n
 * @returns {{ i18n: object|null, leftovers: string[] }} `i18n` is the
 *   rewritten block, or `null` when nothing changed; `leftovers` names what
 *   stays for an operator.
 */
export function canonicalizeLibraryI18n(i18n) {
  if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) {
    return { i18n: null, leftovers: [] };
  }
  const leftovers = [];
  let changed = false;
  let next = i18n;

  const versions = i18n.versions;
  if (versions && typeof versions === 'object' && !Array.isArray(versions)) {
    const nextVersions = {};
    for (const [key, version] of Object.entries(versions)) {
      const canonical = canonicalLang(key);
      if (canonical === key) {
        nextVersions[key] = version;
      } else if (canonical && !Object.hasOwn(versions, canonical)) {
        nextVersions[canonical] = version;
        changed = true;
      } else {
        nextVersions[key] = version;
        leftovers.push(`versions.${key}`);
      }
    }
    next = { ...next, versions: nextVersions };
  }

  if (typeof i18n.dominant === 'string') {
    const canonical = canonicalLang(i18n.dominant);
    if (!canonical) leftovers.push(`dominant ${i18n.dominant}`);
    else if (canonical !== i18n.dominant) {
      next = { ...next, dominant: canonical };
      changed = true;
    }
  }

  return { i18n: changed ? next : null, leftovers };
}

const LANG_LIST = sql.join(CANONICAL_LANGS);

/**
 * True for a row whose `i18n.versions` has a key off the canonical set, or
 * whose `i18n.dominant` is a string off it.
 */
const needsCanonicalizing = sql`(
  EXISTS (
    SELECT 1 FROM jsonb_object_keys(
      CASE WHEN jsonb_typeof(i18n -> 'versions') = 'object'
           THEN i18n -> 'versions' ELSE '{}'::jsonb END
    ) AS k(key)
    WHERE k.key NOT IN (${LANG_LIST})
  )
  OR (jsonb_typeof(i18n -> 'dominant') = 'string'
      AND i18n ->> 'dominant' NOT IN (${LANG_LIST}))
)`;

/**
 * The library rows `up` reads. Exported so the real-PostgreSQL test can pin
 * the filter.
 *
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<{id: string, i18n: unknown}[]>}
 */
export function selectNonCanonicalLibraryRows(db) {
  return db
    .selectFrom('slide_library')
    .select(['id', 'i18n'])
    .where(needsCanonicalizing)
    .execute();
}

export const up = async (db) => {
  let changed = 0;
  for (const row of await selectNonCanonicalLibraryRows(db)) {
    const { i18n, leftovers } = canonicalizeLibraryI18n(row.i18n);
    if (leftovers.length) {
      log.warn(
        `slide_library ${row.id}: i18n keeps non-canonical ` +
          `${leftovers.join(', ')}; fix by hand`,
      );
    }
    if (!i18n) continue;
    await db
      .updateTable('slide_library')
      .set({ i18n: JSON.stringify(i18n) })
      .where('id', '=', row.id)
      .execute();
    changed += 1;
  }
  if (changed) log.info(`slide_library: canonicalized i18n on ${changed}`);
};

/** Nothing to undo: the old key named a version no reader could reach. */
export const down = async () => {};
