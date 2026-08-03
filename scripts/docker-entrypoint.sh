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

storage_mode=$(printf '%s' "${STORAGE_MODE:-}" | tr '[:upper:]' '[:lower:]')

if [ "$storage_mode" = "postgres" ] || [ "$storage_mode" = "postgresql" ]; then
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

  # Never let a Postgres-mode boot quietly present an empty workspace next to a
  # full data directory. This is a warning, not a stop: the hard boot-guard
  # lands with the storage default flip (see
  # docs/plans/briefs/storage-path-consolidation.md, PR D).
  if [ -d "${APP_DIR}/server/data/presentations" ] &&
     [ -n "$(ls -A "${APP_DIR}/server/data/presentations" 2>/dev/null || true)" ]; then
    echo "entrypoint: WARNING — STORAGE_MODE=postgres, but server/data/presentations is not empty." >&2
    echo "entrypoint: that file-storage data is NOT served in Postgres mode. Either import it" >&2
    echo "entrypoint: (docker compose exec app npm run db:migrate:data) or set STORAGE_MODE=file" >&2
    echo "entrypoint: in .env to keep using file storage." >&2
  fi
fi

exec "$@"
