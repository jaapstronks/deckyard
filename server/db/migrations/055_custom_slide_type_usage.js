/**
 * Migration: `usage` on custom slide types.
 *
 * The organization's own rules for filling one of its slide types (sources,
 * cut-off dates, mandatory explanations). It rides along in `get_slide_types`,
 * so an agent reads it before building the slide. Editorial copy about *which*
 * type to pick stays where it is; this is the half an organization writes about
 * itself. See shared/slide-types/usage.js.
 *
 * Additive and nullable: no backfill, nothing to reconcile, and an install that
 * has not migrated yet simply has no rules to state.
 */

export const up = async (db) => {
  await db.schema
    .alterTable('custom_slide_types')
    .addColumn('usage', 'text')
    .execute();
};

export const down = async (db) => {
  await db.schema.alterTable('custom_slide_types').dropColumn('usage').execute();
};
