/**
 * Migration: presentation `scope` → `visibility`, value `'workspace'` →
 * `'organization'` — the stored-data half of vocabulary decisions D10+D11
 * (docs/plans, B41-a).
 *
 * D10: `scope` meant three different things; a presentation's audience is its
 * **visibility** (`'private' | 'organization'`). D11: the tenant entity is an
 * **organization** everywhere in code, DB and API — "workspace" survives only
 * as the UI label. This migration makes the stored data match the contract
 * instead of leaving the storage layer to translate at read time (the beta
 * stance forbids accepts-both seams, `docs/reference/versioning.md`).
 *
 * Four rewrites, all exact:
 *
 * 1. `presentations.scope` → `presentations.visibility`, values updated
 *    (`'workspace'` → `'organization'`; `'private'` untouched). The composite
 *    index from migration 002 follows the column on rename; only its name is
 *    refreshed to keep names truthful.
 * 2. `presentation_versions.presentation_data` — full-deck snapshots embed the
 *    old top-level `scope` key; each is folded to `visibility` with the same
 *    value mapping, so a restored version round-trips in the new vocabulary.
 * 3. `activity_events` — stored `event_type = 'presentation.moved_to_workspace'`
 *    rows become `'presentation.moved_to_organization'`, and the jsonb `data`
 *    keys the writers used (`scope`, `previousScope`, `newScope`) are folded to
 *    `visibility` / `previousVisibility` / `newVisibility` with values mapped.
 * 4. `app_settings.settings.webhooks.presentationMovedToWorkspaceUrl` →
 *    `presentationMovedToOrganizationUrl`, so an operator-configured webhook
 *    keeps firing after the event rename.
 *
 * `down` restores the old column/index/event names and maps values back. The
 * jsonb folds are inverted with the same shape.
 */

import { sql } from 'kysely';

/** Fold jsonb key `from` into key `to`, mapping value `oldVal` → `newVal`. */
const foldKey = (table, column, from, to, oldVal, newVal) => sql`
  UPDATE ${sql.table(table)}
  SET ${sql.ref(column)} = (${sql.ref(column)} - ${sql.lit(from)})
    || jsonb_build_object(
      ${sql.lit(to)},
      CASE WHEN ${sql.ref(column)}->>${sql.lit(from)} = ${sql.lit(oldVal)}
        THEN ${sql.lit(newVal)}
        ELSE ${sql.ref(column)}->>${sql.lit(from)}
      END
    )
  WHERE ${sql.ref(column)} ? ${sql.lit(from)}
`;

export const up = async (db) => {
  // 1. presentations column + values + index name
  await sql`ALTER TABLE presentations RENAME COLUMN scope TO visibility`.execute(
    db,
  );
  await sql`UPDATE presentations SET visibility = 'organization' WHERE visibility = 'workspace'`.execute(
    db,
  );
  await sql`ALTER INDEX IF EXISTS idx_presentations_scope RENAME TO idx_presentations_visibility`.execute(
    db,
  );

  // 2. version snapshots: embedded top-level scope key
  await foldKey(
    'presentation_versions',
    'presentation_data',
    'scope',
    'visibility',
    'workspace',
    'organization',
  ).execute(db);

  // 3. activity events: event type + data keys
  await sql`
    UPDATE activity_events SET event_type = 'presentation.moved_to_organization'
    WHERE event_type = 'presentation.moved_to_workspace'
  `.execute(db);
  await foldKey(
    'activity_events',
    'data',
    'scope',
    'visibility',
    'workspace',
    'organization',
  ).execute(db);
  await foldKey(
    'activity_events',
    'data',
    'previousScope',
    'previousVisibility',
    'workspace',
    'organization',
  ).execute(db);
  await foldKey(
    'activity_events',
    'data',
    'newScope',
    'newVisibility',
    'workspace',
    'organization',
  ).execute(db);

  // 4. app settings: webhook URL key follows the event rename
  await sql`
    UPDATE app_settings
    SET settings = jsonb_set(
      settings,
      '{webhooks,presentationMovedToOrganizationUrl}',
      settings->'webhooks'->'presentationMovedToWorkspaceUrl'
    ) #- '{webhooks,presentationMovedToWorkspaceUrl}'
    WHERE settings->'webhooks' ? 'presentationMovedToWorkspaceUrl'
  `.execute(db);
};

export const down = async (db) => {
  await sql`
    UPDATE app_settings
    SET settings = jsonb_set(
      settings,
      '{webhooks,presentationMovedToWorkspaceUrl}',
      settings->'webhooks'->'presentationMovedToOrganizationUrl'
    ) #- '{webhooks,presentationMovedToOrganizationUrl}'
    WHERE settings->'webhooks' ? 'presentationMovedToOrganizationUrl'
  `.execute(db);

  await foldKey(
    'activity_events',
    'data',
    'newVisibility',
    'newScope',
    'organization',
    'workspace',
  ).execute(db);
  await foldKey(
    'activity_events',
    'data',
    'previousVisibility',
    'previousScope',
    'organization',
    'workspace',
  ).execute(db);
  await foldKey(
    'activity_events',
    'data',
    'visibility',
    'scope',
    'organization',
    'workspace',
  ).execute(db);
  await sql`
    UPDATE activity_events SET event_type = 'presentation.moved_to_workspace'
    WHERE event_type = 'presentation.moved_to_organization'
  `.execute(db);

  await foldKey(
    'presentation_versions',
    'presentation_data',
    'visibility',
    'scope',
    'organization',
    'workspace',
  ).execute(db);

  await sql`ALTER INDEX IF EXISTS idx_presentations_visibility RENAME TO idx_presentations_scope`.execute(
    db,
  );
  await sql`UPDATE presentations SET visibility = 'workspace' WHERE visibility = 'organization'`.execute(
    db,
  );
  await sql`ALTER TABLE presentations RENAME COLUMN visibility TO scope`.execute(
    db,
  );
};
