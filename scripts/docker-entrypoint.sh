#!/bin/sh
# Container entrypoint: bring the schema up to date, then start whatever the
# image's CMD asks for.
#
# Only the Postgres path does anything here. File storage has no schema, so in
# that mode this is a pass-through and the container starts exactly as before.
#
# Idempotent by construction: `db:migrate up` records applied migrations in the
# `_migrations` table and re-runs nothing, so a restart, a redeploy and a fresh
# volume all converge on the same schema without an operator step.
set -e

APP_DIR="${APP_DIR:-/app}"

# Postgres is the default, so an unset STORAGE_MODE means Postgres too. Any
# other value is left to the app, which validates STORAGE_MODE at boot and
# names the canonical spellings (server/config/database.js).
storage_mode="${STORAGE_MODE:-postgres}"

if [ "$storage_mode" = "postgres" ]; then
  # `depends_on: condition: service_healthy` already gates on pg_isready, but a
  # healthy Postgres can still refuse the first connection for a beat (it
  # restarts once during first-run initdb). Retry a few times before giving up
  # so a cold `docker compose up` on a fresh volume does not need a second try.
  attempt=1
  max_attempts=10
  until node "${APP_DIR}/server/db/migrate.js" up; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "entrypoint: migrations failed after ${max_attempts} attempts — refusing to start." >&2
      exit 1
    fi
    echo "entrypoint: database not ready (attempt ${attempt}/${max_attempts}), retrying in 3s…" >&2
    attempt=$((attempt + 1))
    sleep 3
  done
fi

# A Postgres-mode boot that would show an empty workspace next to a full data
# directory is refused by the app itself (server/storage/boot-check.js), which
# can see whether the database is actually empty. Nothing to duplicate here.

exec "$@"
