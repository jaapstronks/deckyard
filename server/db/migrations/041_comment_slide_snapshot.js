/**
 * Slide snapshot on comments (comments via public API v1 + MCP write).
 *
 * Stores the commented slide's JSON ({ id, type, content }) as it was when
 * the comment was created, so agents can see what the reviewer was looking
 * at even after the slide changed or was deleted. Only the affected slide
 * is snapshotted (not the whole deck) to keep rows small. Comments created
 * before this migration keep NULL — the API reports that honestly.
 */

export const up = async (db) => {
  await db.schema
    .alterTable('presentation_comments')
    .addColumn('slide_snapshot', 'jsonb')
    .execute();
};

export const down = async (db) => {
  await db.schema
    .alterTable('presentation_comments')
    .dropColumn('slide_snapshot')
    .execute();
};
