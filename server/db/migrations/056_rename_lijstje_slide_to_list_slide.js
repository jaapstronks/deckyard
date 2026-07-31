/**
 * Rename `lijstje-slide` → `list-slide` across every stored slide.
 *
 * `lijstje-slide` was never a second type: since the drift fix it was literally
 * `{ ...listSlide, ai: false }`, so the two names shared one field schema. Rung 3
 * of the list consolidation (docs/reference/slide-type-removal.md)
 * removes the alias from the registry, so a stored slide that still carries the
 * Dutch name would render as an *archived* slide (shared/slide-types/unresolved.js)
 * instead of a real list. This migration rewrites the name everywhere it is
 * stored so those decks keep rendering as lists.
 *
 * ## Why a numbered migration, not just the script
 *
 * `scripts/migrate-lijstje-slide.js` does the same rename, but nothing runs it
 * automatically — every self-host/fork would keep the old name and see its lists
 * archived after rung 3. A numbered migration runs on *every* install as part of
 * the normal upgrade, which is exactly what rung 3 needs. The script stays for
 * file-store installs (which have no migration runner) and for migrating exports.
 *
 * ## Lossless rename, so it is structural but total
 *
 * Only the type id changes; `content` is untouched. The rewrite is a recursive
 * walk over each jsonb column that rewrites the two keys that ever carry a
 * slide-type id (`type`, `slideType`) when their value is the old name — the SQL
 * mirror of `renameSlideTypeDeep` in the script. A single key-aware walk is
 * correct for every shape: deck slide arrays, per-language i18n versions, version
 * snapshots, library items and comment snapshots all nest slides differently.
 * Idempotent by construction: a second run finds nothing, because the old name
 * is gone.
 *
 * Self-contained in SQL (a `pg_temp` function, like migration 030); it does not
 * import from `scripts/`, because that script is free to change or move.
 *
 * Surfaces (every column exists by this migration; 041 added slide_snapshot,
 * 049 added slide_library.i18n):
 * - presentations.slides, presentations.i18n
 * - presentation_versions.presentation_data
 * - slide_library.content, slide_library.i18n, slide_library.slide_type (scalar)
 * - presentation_comments.slide_snapshot
 */

import { sql } from 'kysely';

const OLD_TYPE = 'lijstje-slide';
const NEW_TYPE = 'list-slide';

/**
 * A recursive jsonb rewriter: for every object it rewrites `type`/`slideType`
 * whose value equals `old_name`, and recurses into every other value; for every
 * array it recurses into each element; scalars are returned unchanged. This is
 * the SQL twin of `renameSlideTypeDeep` in scripts/migrate-lijstje-slide.js.
 */
const RENAME_FUNCTION = `
  CREATE OR REPLACE FUNCTION pg_temp.rename_slide_type(data jsonb, old_name text, new_name text)
  RETURNS jsonb AS $$
  DECLARE
    result jsonb;
    k text;
    v jsonb;
  BEGIN
    IF jsonb_typeof(data) = 'object' THEN
      result := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(data) LOOP
        IF (k = 'type' OR k = 'slideType') AND v = to_jsonb(old_name) THEN
          result := result || jsonb_build_object(k, new_name);
        ELSE
          result := result || jsonb_build_object(k, pg_temp.rename_slide_type(v, old_name, new_name));
        END IF;
      END LOOP;
      RETURN result;
    ELSIF jsonb_typeof(data) = 'array' THEN
      RETURN (
        SELECT COALESCE(jsonb_agg(pg_temp.rename_slide_type(elem, old_name, new_name)), '[]'::jsonb)
        FROM jsonb_array_elements(data) AS elem
      );
    ELSE
      RETURN data;
    END IF;
  END;
  $$ LANGUAGE plpgsql IMMUTABLE;
`;

/** Every jsonb column that can hold a slide object, by table. */
const JSON_TARGETS = [
  { table: 'presentations', columns: ['slides', 'i18n'] },
  { table: 'presentation_versions', columns: ['presentation_data'] },
  { table: 'slide_library', columns: ['content', 'i18n'] },
  { table: 'presentation_comments', columns: ['slide_snapshot'] },
];

/**
 * Rewrite one jsonb column in place, only touching rows whose text actually
 * contains `name` (so untouched rows keep their timestamps).
 */
async function renameColumn(db, table, column, name) {
  await sql`
    UPDATE ${sql.ref(table)}
    SET ${sql.ref(column)} = pg_temp.rename_slide_type(${sql.ref(column)}, ${name}, ${NEW_TYPE})
    WHERE ${sql.ref(column)} IS NOT NULL
      AND ${sql.ref(column)}::text LIKE ${'%' + name + '%'}
  `.execute(db);
}

export const up = async (db) => {
  await sql.raw(RENAME_FUNCTION).execute(db);

  for (const { table, columns } of JSON_TARGETS) {
    for (const column of columns) {
      await renameColumn(db, table, column, OLD_TYPE);
    }
  }

  // slide_library.slide_type is a scalar varchar, not JSON.
  await sql`
    UPDATE slide_library SET slide_type = ${NEW_TYPE} WHERE slide_type = ${OLD_TYPE}
  `.execute(db);
};

// Deliberately irreversible. `lijstje-slide` and `list-slide` collapsed into one
// type, so after this runs there is no way to tell a slide that was originally
// `lijstje-slide` from one that was always `list-slide` — reversing would rename
// every list, not just the migrated ones. The rename is lossless, so there is
// nothing a rollback would need to recover.
export const down = async () => {
  // no-op — see the comment above.
};
