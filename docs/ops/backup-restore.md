# Back up and restore

A Deckyard installation keeps its state in two places. Back up both, and rehearse a restore once before you need it: a back-up that was never restored is a hope, not a back-up.

| Where                                                  | What                                                                                                                  | Back up? |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------- |
| PostgreSQL                                             | Everything but media bytes: decks, versions, themes, users, organizations, settings, comments, analytics, live state. | Yes      |
| Uploads: `server/uploads/` (a volume) or the S3 bucket | Uploaded images, fonts and files. The database refers to them by key.                                                 | Yes      |
| `server/data/deck-thumbs/`                             | Deck thumbnails, a cache rebuilt on demand.                                                                           | No       |
| The container image                                    | Rebuilt from the repo at the tag you run.                                                                             | No       |

Your `.env` (or the platform's environment) holds secrets rather than state, and belongs in your secret store, not next to the dump. Keep `AUTH_SECRET` the same after a restore, or everyone is signed out.

## Back up

**The database**, as a custom-format dump (compressed, and `pg_restore` can pick from it). On the compose stack:

```bash
docker compose exec -T postgres sh -c \
  'pg_dump -Fc --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > deckyard-$(date +%F).dump
```

Against any other PostgreSQL, run `pg_dump -Fc --no-owner --no-acl "$DATABASE_URL" > deckyard-$(date +%F).dump` with a client whose major version is at least the server's. `--no-owner --no-acl` makes the dump restorable under a different role name, which is what a restore onto a new platform needs.

**The uploads**, at the same moment:

```bash
tar czf deckyard-uploads-$(date +%F).tgz server/uploads     # a volume or bind mount
aws s3 sync s3://<bucket> ./deckyard-media-$(date +%F)      # S3 mode, or your provider's own tool
```

A dump taken while people edit is consistent in itself; uploads taken a minute later may hold a file the dump does not know yet, which is harmless. The other way round (a dump that refers to an upload you did not copy) shows as a missing image, so copy the uploads **after** the dump.

## Restore

Into an **empty** database, then let the migrations bring the schema to the release you run:

```bash
docker compose stop app
docker compose exec -T postgres sh -c \
  'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c \
  'pg_restore --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < deckyard-2026-09-29.dump
tar xzf deckyard-uploads-2026-09-29.tgz && sudo chown -R 1000:1000 server/uploads
docker compose start app                      # the entrypoint applies pending migrations
docker compose exec app node scripts/doctor.js
```

Outside compose it is the same four steps: an empty database, `pg_restore --no-owner --no-acl -d "$DATABASE_URL" <dump>`, `npm run db:migrate` (the container does this at start), and `npm run doctor`. A dump from an older release restores into a newer one this way; the reverse (a dump from a newer release into an older image) is not supported.

## Rehearse it once

Restore into a throwaway database next to the real one and check the result, without touching production:

```bash
docker run -d --name deckyard-restore-test -p 55432:5432 \
  -e POSTGRES_USER=deckyard -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=deckyard postgres:16-alpine
docker exec -i deckyard-restore-test pg_restore --no-owner --no-acl -U deckyard -d deckyard < deckyard-2026-09-29.dump
export DATABASE_URL=postgres://deckyard:restore@localhost:55432/deckyard DATABASE_SSL=false
npm run db:migrate && npm run doctor           # in a checkout at the tag you run
docker exec deckyard-restore-test psql -U deckyard -d deckyard -Atc 'select count(*) from presentations'
docker rm -f deckyard-restore-test
```

The doctor should show `Database` and `Migrations` green and the deck count should match production. Start the server against it (`PORT=4199 npm run start`) and open a deck if you want to see it with your own eyes. This recipe was run on 2026-09-29 against a development database of 51 decks: restored, migrated, doctor green, decks served.

## On a PaaS

- **Coolify** can schedule dumps of a PostgreSQL resource (the database's back-up settings), kept on the server or sent to an S3 destination. That covers the database; a media volume is not in it, so copy it separately or use S3 for media.
- **Managed PostgreSQL** (Railway, Render, Fly, a cloud provider) takes its own snapshots. Check the retention, and still take an occasional `pg_dump`: a snapshot restores only on that provider, a dump restores anywhere.
- **Volumes** are rarely in the platform's back-up. Media in S3 with bucket versioning is the simpler guarantee on a PaaS.

Whatever the platform, the restore ends the same way: migrations, then the doctor.
