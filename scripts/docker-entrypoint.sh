#!/bin/sh
# Container entrypoint: bring the schema up to date, then start whatever the
# image's CMD asks for.
#
# PostgreSQL is Deckyard's only storage backend, so this always runs — there is
# no mode in which the container has no schema to migrate. (STORAGE_MODE is still
# validated by the app at boot, which names the one canonical spelling:
# server/config/database.js.)
#
# Idempotent by construction: `db:migrate up` records applied migrations in the
# `_migrations` table and re-runs nothing, so a restart, a redeploy and a fresh
# volume all converge on the same schema without an operator step. The Node
# install path has the same step in scripts/install.sh.
set -e

APP_DIR="${APP_DIR:-/app}"

# Guard against a stale host .env leaking DATABASE_HOST=localhost into the
# container. On the host that value is correct (Postgres really is on
# localhost for `npm run start`); inside this container localhost is the app
# itself, not the database. compose's `${DATABASE_HOST:-postgres}` default
# cannot rescue it — an explicit value in .env wins over the default — so the
# app would otherwise spin retrying a connection to itself with no hint why.
# Fail fast and say exactly what to change.
case "${DATABASE_HOST:-postgres}" in
  localhost | 127.0.0.1 | ::1)
    echo "entrypoint: DATABASE_HOST=${DATABASE_HOST} points the container at itself, not the database." >&2
    echo "  Inside the Deckyard container 'localhost' is the app, not Postgres." >&2
    echo "  The bundled database is reachable as host 'postgres' (the compose service name)." >&2
    echo "  This value almost always comes from a leftover host .env meant for 'npm run start'." >&2
    echo "  Fix: remove the DATABASE_HOST line from .env (compose defaults it to 'postgres')," >&2
    echo "       or set DATABASE_HOST=postgres, then re-run." >&2
    exit 1
    ;;
esac

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

# A Postgres-mode boot that would show an empty workspace next to a full data
# directory is refused by the app itself (server/storage/boot-check.js), which
# can see whether the database is actually empty. Nothing to duplicate here.

exec "$@"
