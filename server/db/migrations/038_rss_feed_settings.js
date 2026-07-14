/**
 * RSS feed settings migration.
 * RSS config is stored in organizations.settings JSONB — no schema change needed.
 * This migration reserves the sequence number.
 */

export async function up() {
  // No-op: RSS settings live in organizations.settings JSONB.
}

export async function down() {
  // No-op: nothing to revert.
}
