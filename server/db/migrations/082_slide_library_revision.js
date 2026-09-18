/**
 * An optimistic-concurrency revision for slide-library items (D170, B335).
 *
 * A library item is edited the way a deck is saved: the client sends the
 * revision it loaded as `If-Match`, and the UPDATE carries that revision in
 * its WHERE, so two editors cannot silently overwrite each other. Same shape
 * as `presentations.revision` — an integer, not a timestamp ETag, because a
 * second form for one concept is drift.
 *
 * `not null default 0`: every existing row starts at 0, which is also what a
 * client that loaded it before this migration will not have — it has no
 * revision at all and must reload, which is the point.
 */

export const up = async (db) => {
  await db.schema
    .alterTable('slide_library')
    .addColumn('revision', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();
};

export const down = async (db) => {
  await db.schema.alterTable('slide_library').dropColumn('revision').execute();
};
