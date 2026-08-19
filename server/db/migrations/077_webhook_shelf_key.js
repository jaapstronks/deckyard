/**
 * Migration: the shelf webhook settings key
 * `app_settings.settings.webhooks.slideAddedToTeamLibraryUrl` →
 * `slideAddedToOrganizationLibraryUrl` — the stored-data half of B92, the last
 * remainder of vocabulary decision D27 (B53 sweep (b), B90; see
 * `docs/reference/vocabulary.md`).
 *
 * The shelf axis is `shelf`, its shared value `'organization'` (migration 076),
 * and its identifiers say *Organization* (B90). Two names for that one meaning
 * survived on the webhook surface, because they are an operator-configured
 * stored setting plus a public payload contract: the settings key above and the
 * event string `slide.added_to_team_library`, which the code now spells
 * `slide.added_to_organization_library`. The beta stance forbids an
 * accepts-both read seam (`docs/reference/versioning.md`), so the stored key is
 * rewritten to match the contract instead of being translated at read time.
 *
 * One rewrite, on the model of migration 074 block 4
 * (`presentationMovedToWorkspaceUrl` → `presentationMovedToOrganizationUrl`):
 * `app_settings` is a singleton row (migration 059) holding the whole settings
 * object as one jsonb bag, so the key is moved inside `settings->'webhooks'`
 * with `jsonb_set` + `#-`. An operator-configured URL keeps firing after the
 * rename — for the renamed event, whose new `event` value and `x-sb-event`
 * header the receiver sees from the next delivery on.
 *
 * A fresh install that still imports a legacy `settings.json` gets the rename
 * too: migration 059 back-fills the singleton row from disk *before* this one
 * runs, and it stores the parsed object as-is, so an old key imported there is
 * moved by the sweep that follows.
 *
 * Nothing else stores either name: webhook deliveries are not logged (no
 * attempt table, `docs/reference/webhooks.md`), and the event string never
 * reached `activity_events` — those carry their own vocabulary
 * (`server/storage/activity-events.js`).
 *
 * `down` moves the key back.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    UPDATE app_settings
    SET settings = jsonb_set(
      settings,
      '{webhooks,slideAddedToOrganizationLibraryUrl}',
      settings->'webhooks'->'slideAddedToTeamLibraryUrl'
    ) #- '{webhooks,slideAddedToTeamLibraryUrl}'
    WHERE settings->'webhooks' ? 'slideAddedToTeamLibraryUrl'
  `.execute(db);
};

export const down = async (db) => {
  await sql`
    UPDATE app_settings
    SET settings = jsonb_set(
      settings,
      '{webhooks,slideAddedToTeamLibraryUrl}',
      settings->'webhooks'->'slideAddedToOrganizationLibraryUrl'
    ) #- '{webhooks,slideAddedToOrganizationLibraryUrl}'
    WHERE settings->'webhooks' ? 'slideAddedToOrganizationLibraryUrl'
  `.execute(db);
};
