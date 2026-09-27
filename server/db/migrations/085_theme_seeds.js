/** Shared seed records and organization records occupy disjoint theme scopes. */
import { sql } from 'kysely';

export const up = async (db) => {
  await sql`ALTER TABLE themes ALTER COLUMN organization_id DROP NOT NULL`.execute(
    db,
  );
  await sql`ALTER TABLE themes ADD COLUMN seed_hash text`.execute(db);
  await sql`ALTER TABLE themes ADD CONSTRAINT themes_seed_scope_check CHECK ((organization_id IS NULL) = (seed_hash IS NOT NULL))`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX idx_themes_seed_slug ON themes (slug) WHERE organization_id IS NULL`.execute(
    db,
  );
};

export const down = async (db) => {
  await sql`DROP INDEX idx_themes_seed_slug`.execute(db);
  await sql`ALTER TABLE themes DROP CONSTRAINT themes_seed_scope_check`.execute(
    db,
  );
  await sql`ALTER TABLE themes DROP COLUMN seed_hash`.execute(db);
  await sql`ALTER TABLE themes ALTER COLUMN organization_id SET NOT NULL`.execute(
    db,
  );
};
