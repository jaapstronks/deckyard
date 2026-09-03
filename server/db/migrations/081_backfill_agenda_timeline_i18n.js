/**
 * Finish migration 030: convert `agenda-timeline-slide` in the columns it skipped.
 *
 * 030 (May 2026) consolidated `agenda-timeline-slide` into `timeline-slide` —
 * type renamed, items folded (`time`/`label` -> `date`, `body` -> `text`) — and
 * wrote `presentations.slides`, `slide_library`, and the `slides` array inside
 * `presentation_versions.presentation_data`. It skipped `i18n` on purpose, with
 * two arguments in its own comment. Both have since expired:
 *
 *  - *"the renderer has back-compat for the old field names"* — true of the
 *    fields, but rung 3 of the removal took the **type** off the registry
 *    (`shared/slide-types/removed.js`), so a slide left on it renders as an
 *    *archived* slide and its field names stop mattering. B225 removed that
 *    renderer fallback as well; there is one spelling now.
 *  - *"the i18n structure varies and SQL is complex"* — migration 056 has
 *    walked those same jsonb columns with a recursive `pg_temp` function ever
 *    since, so the shape is a solved problem.
 *
 * What was left behind is a deck whose one slide id is a `timeline-slide` in
 * the dominant version and an archived slide in every translation. In the CIIIC
 * fork on 2026-09-03: 0 in `presentations.slides`, **80** in
 * `presentations.i18n.versions[*]` across ~20 live decks, and 150 in
 * `presentation_versions` (D80).
 *
 * ## Why both this and a funnel step
 *
 * The v12 -> v13 step in `shared/slide-types/schema-version.js` is what makes
 * the conversion *correct*: `migratePresentation()` runs on every read, write
 * and import, on every backend, so no install can miss it and no deck is served
 * on the retired type again. This migration is what makes it *persistent* and
 * *complete* — it writes the columns without waiting for the next save, and it
 * reaches the surfaces the read funnel never passes through (version snapshots,
 * `slide_library`, comment snapshots). That is the division of labour step 0 of
 * `docs/reference/slide-type-removal.md` sets out.
 *
 * Self-contained SQL (`pg_temp` functions), like 030 and 056: a migration is a
 * historical record, so it does not import the funnel step it mirrors — that
 * code is free to change. The COALESCE order is 030's, so a deck converted by
 * either path comes out the same.
 *
 * Idempotent by construction: after this runs no stored object carries the
 * retired type, so a second run matches nothing.
 *
 * Surfaces:
 * - presentations.slides, presentations.i18n
 * - presentation_versions.presentation_data (both its `slides` and its `i18n`)
 * - presentation_comments.slide_snapshot
 * - slide_library.slide_type (scalar), slide_library.content, slide_library.i18n
 */

import { sql } from 'kysely';

const OLD_TYPE = 'agenda-timeline-slide';
const NEW_TYPE = 'timeline-slide';

/**
 * The item fold, as migration 030 wrote it: `time`/`label` collapse into
 * `date`, `body` into `text`, first present spelling wins, and the legacy keys
 * are dropped. Every other key an item carries is kept — the funnel step keeps
 * them too, so the two paths agree on more than the three fields they rewrite.
 */
const ITEMS_FUNCTION = `
  CREATE OR REPLACE FUNCTION pg_temp.convert_agenda_items(items jsonb)
  RETURNS jsonb AS $$
  SELECT CASE
    WHEN jsonb_typeof(items) <> 'array' THEN items
    ELSE COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN jsonb_typeof(item) = 'object'
            THEN (item - 'time' - 'label' - 'body') || jsonb_build_object(
              'date', COALESCE(item->>'time', item->>'label', item->>'date', ''),
              'title', COALESCE(item->>'title', ''),
              'text', COALESCE(item->>'text', item->>'body', '')
            )
            ELSE item
          END
          ORDER BY ord
        )
        FROM jsonb_array_elements(items) WITH ORDINALITY AS t(item, ord)
      ),
      '[]'::jsonb
    )
  END
  $$ LANGUAGE sql IMMUTABLE;
`;

/** A slide *content* object: fold its items when it has any. */
const CONTENT_FUNCTION = `
  CREATE OR REPLACE FUNCTION pg_temp.convert_agenda_content(content jsonb)
  RETURNS jsonb AS $$
  SELECT CASE
    WHEN jsonb_typeof(content) <> 'object' OR jsonb_typeof(content->'items') <> 'array'
    THEN content
    ELSE content || jsonb_build_object('items', pg_temp.convert_agenda_items(content->'items'))
  END
  $$ LANGUAGE sql IMMUTABLE;
`;

/**
 * A recursive jsonb rewriter: every object that *is* a slide on the retired
 * type (`type` = the old name) is converted in place — type and items — and
 * every other object and array is walked. One key-aware walk is correct for
 * every shape a slide is stored in: deck slide arrays, per-language i18n
 * versions, version snapshots and comment snapshots all nest them differently.
 * The SQL twin of `convertAgendaTimelineSlides` in schema-version.js.
 */
const CONVERT_FUNCTION = `
  CREATE OR REPLACE FUNCTION pg_temp.convert_agenda_timeline(data jsonb, old_name text, new_name text)
  RETURNS jsonb AS $$
  DECLARE
    result jsonb;
    k text;
    v jsonb;
  BEGIN
    IF jsonb_typeof(data) = 'object' THEN
      IF data->>'type' = old_name THEN
        IF data ? 'content' THEN
          RETURN data || jsonb_build_object(
            'type', new_name,
            'content', pg_temp.convert_agenda_content(data->'content')
          );
        END IF;
        RETURN data || jsonb_build_object('type', new_name);
      END IF;
      result := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(data) LOOP
        result := result || jsonb_build_object(k, pg_temp.convert_agenda_timeline(v, old_name, new_name));
      END LOOP;
      RETURN result;
    ELSIF jsonb_typeof(data) = 'array' THEN
      RETURN (
        SELECT COALESCE(jsonb_agg(pg_temp.convert_agenda_timeline(elem, old_name, new_name) ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(data) WITH ORDINALITY AS t(elem, ord)
      );
    ELSE
      RETURN data;
    END IF;
  END;
  $$ LANGUAGE plpgsql IMMUTABLE;
`;

/** Per-language slide-library content (`i18n.versions[lang].content`). */
const LIBRARY_I18N_FUNCTION = `
  CREATE OR REPLACE FUNCTION pg_temp.convert_agenda_library_i18n(i18n jsonb)
  RETURNS jsonb AS $$
  DECLARE
    versions jsonb;
    lang text;
    version jsonb;
  BEGIN
    IF jsonb_typeof(i18n) <> 'object' OR jsonb_typeof(i18n->'versions') <> 'object' THEN
      RETURN i18n;
    END IF;
    versions := '{}'::jsonb;
    FOR lang, version IN SELECT * FROM jsonb_each(i18n->'versions') LOOP
      IF jsonb_typeof(version) = 'object' THEN
        version := version || jsonb_build_object('content', pg_temp.convert_agenda_content(version->'content'));
      END IF;
      versions := versions || jsonb_build_object(lang, version);
    END LOOP;
    RETURN i18n || jsonb_build_object('versions', versions);
  END;
  $$ LANGUAGE plpgsql IMMUTABLE;
`;

/** Every jsonb column that can hold a whole slide object, by table. */
const JSON_TARGETS = [
  { table: 'presentations', columns: ['slides', 'i18n'] },
  { table: 'presentation_versions', columns: ['presentation_data'] },
  { table: 'presentation_comments', columns: ['slide_snapshot'] },
];

/**
 * Rewrite one jsonb column in place, touching only rows whose text actually
 * names the retired type — so untouched rows keep their timestamps.
 */
async function convertColumn(db, table, column) {
  await sql`
    UPDATE ${sql.ref(table)}
    SET ${sql.ref(column)} = pg_temp.convert_agenda_timeline(${sql.ref(column)}, ${OLD_TYPE}, ${NEW_TYPE})
    WHERE ${sql.ref(column)} IS NOT NULL
      AND ${sql.ref(column)}::text LIKE ${'%' + OLD_TYPE + '%'}
  `.execute(db);
}

export const up = async (db) => {
  for (const fn of [
    ITEMS_FUNCTION,
    CONTENT_FUNCTION,
    CONVERT_FUNCTION,
    LIBRARY_I18N_FUNCTION,
  ]) {
    await sql.raw(fn).execute(db);
  }

  for (const { table, columns } of JSON_TARGETS) {
    for (const column of columns) {
      await convertColumn(db, table, column);
    }
  }

  // A library row stores the type in a scalar column and the slide content at
  // the top level of `content`, so the slide-shaped walk above cannot see it.
  // 030 converted these rows; this catches any created since.
  await sql`
    UPDATE slide_library
    SET
      slide_type = ${NEW_TYPE},
      content = pg_temp.convert_agenda_content(content),
      i18n = pg_temp.convert_agenda_library_i18n(i18n)
    WHERE slide_type = ${OLD_TYPE}
  `.execute(db);
};

// Deliberately irreversible, for the same reason 056 is: after this runs there
// is no way to tell a slide that was originally `agenda-timeline-slide` from
// one that was always `timeline-slide`, so reversing would convert every
// timeline in the install. 030 ships a best-effort `down` from the days when
// both types existed; nothing is gained by a second, later one.
export const down = async () => {
  // no-op — see the comment above.
};
