/**
 * The slide library, the collections and the image library page by keyset
 * (B822, D358).
 *
 * Each of the three lists is ordered by `(created_at desc, id desc)` and
 * continues with `WHERE (created_at, id) < (:value, :id)`; the slide-library
 * trash by `(trashed_at desc, id desc)`. Two things the tables did not yet
 * guarantee:
 *
 *  - `created_at` was nullable on all three (001 and 046 gave it only a
 *    default). No write path stores a NULL, but a NULL never compares, so such
 *    a row would fall off every page after the first. A row without one gets
 *    its `updated_at` (or now) and the column becomes NOT NULL.
 *  - No index served the lists: the planner read the organization's rows and
 *    sorted. This adds the scope followed by the full keyset, per list:
 *      - `slide_library (organization_id, shelf, created_at DESC, id DESC)
 *        WHERE trashed_at IS NULL` — a shelf;
 *      - `slide_library (organization_id, shelf, trashed_at DESC, id DESC)
 *        WHERE trashed_at IS NOT NULL` — a shelf's trash;
 *      - `slide_collections (organization_id, shelf, created_at DESC, id DESC)`;
 *      - `image_library (organization_id, created_at DESC, id DESC)`.
 *
 * One filter compares an address: the image library's "your media"
 * (`section=mine`) is `uploaded_by = :reader`, compared bare as every e-mail
 * column is since 092 (D200). 092 did not fold `image_library.uploaded_by`,
 * whose write stored the address as handed in; the write now goes through
 * `normalizeEmail` and this folds the stored rows the same way (trimmed,
 * lower-cased, blank becomes NULL).
 *
 * `down` drops the indexes and NOT NULL; the backfilled timestamps and the
 * folded addresses stay, they are true enough. Both directions are
 * idempotent.
 */

import { sql } from 'kysely';

const TABLES = ['slide_library', 'slide_collections', 'image_library'];

export const up = async (db) => {
  for (const table of TABLES) {
    await sql`
      UPDATE ${sql.table(table)}
      SET created_at = COALESCE(updated_at, now())
      WHERE created_at IS NULL
    `.execute(db);
    await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN created_at SET NOT NULL`.execute(
      db,
    );
  }
  await sql`
    UPDATE image_library
    SET uploaded_by = nullif(lower(btrim(uploaded_by)), '')
    WHERE uploaded_by IS DISTINCT FROM nullif(lower(btrim(uploaded_by)), '')
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slide_library_list_keyset
    ON slide_library (organization_id, shelf, created_at DESC, id DESC)
    WHERE trashed_at IS NULL
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slide_library_trash_keyset
    ON slide_library (organization_id, shelf, trashed_at DESC, id DESC)
    WHERE trashed_at IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_slide_collections_list_keyset
    ON slide_collections (organization_id, shelf, created_at DESC, id DESC)
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_image_library_list_keyset
    ON image_library (organization_id, created_at DESC, id DESC)
  `.execute(db);
};

export const down = async (db) => {
  for (const index of [
    'idx_slide_library_list_keyset',
    'idx_slide_library_trash_keyset',
    'idx_slide_collections_list_keyset',
    'idx_image_library_list_keyset',
  ]) {
    await sql`DROP INDEX IF EXISTS ${sql.id(index)}`.execute(db);
  }
  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN created_at DROP NOT NULL`.execute(
      db,
    );
  }
};
