import { sql } from 'kysely';

export const up = async (db) => {
  await sql`ALTER TABLE presentations ADD COLUMN extensions jsonb NOT NULL DEFAULT '[]'::jsonb`.execute(
    db,
  );
};

export const down = async (db) => {
  await sql`ALTER TABLE presentations DROP COLUMN extensions`.execute(db);
};
