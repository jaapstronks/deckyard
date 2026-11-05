/**
 * The AI call meter (DY-844): what the installation spends on model calls,
 * per organization and person per day, and one instance total per day that
 * the daily ceiling is held against.
 *
 * Two tables, not one, because the two answers have different keys. The
 * organization rows answer "who spent what" and are read by that
 * organization's admins under its own storage scope. The instance row answers
 * "may this call still go out" and is keyed by the date alone, so the ceiling
 * check is one primary-key update that never reads across organizations. It
 * also counts a call no request attributed (a path that runs outside a
 * request), which has no organization row to land in.
 *
 * `actor_email` is part of the key with `''` for a call without a person (a
 * scheduled job acting for nobody in particular); a nullable column cannot be
 * in a primary key. The address never crosses the API boundary: the read path
 * turns it into a display identity (D22). Deleting an organization deletes its
 * rows; deleting a person leaves the rows, which are the organization's spend.
 *
 * `calls` counts model calls, not requests: a wizard run is three plus n.
 * Tokens are what the vendor reported; a vendor that reports none adds 0.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await sql`
    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      actor_email VARCHAR(320) NOT NULL DEFAULT '',
      calls INTEGER NOT NULL DEFAULT 0,
      input_tokens BIGINT NOT NULL DEFAULT 0,
      output_tokens BIGINT NOT NULL DEFAULT 0,
      cache_read_tokens BIGINT NOT NULL DEFAULT 0,
      cache_write_tokens BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (organization_id, date, actor_email)
    )
  `.execute(db);
  await sql`
    CREATE TABLE IF NOT EXISTS ai_usage_instance_daily (
      date DATE PRIMARY KEY,
      calls INTEGER NOT NULL DEFAULT 0
    )
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP TABLE IF EXISTS ai_usage_instance_daily`.execute(db);
  await sql`DROP TABLE IF EXISTS ai_usage_daily`.execute(db);
};
