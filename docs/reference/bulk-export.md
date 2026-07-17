# Bulk Export / Backup

Lets a signed-in user download all their presentations (plus optional version history, image library, slide library, and themes) as a single ZIP archive from **Settings → Data Export**. The export runs as a background job on the `heavy` queue with live progress, and completion triggers an in-app notification, an SSE event, and an email.

Scope is per-user: presentations where the user is `ownerEmail` or `createdBy`. There is no organization-wide/admin export, no import/restore, and no scheduled backups — those were later phases in the original plan and were not built. Job state and results are held in memory, so a server restart drops active-export tracking and pending downloads.

## API

Endpoints use the regular session auth (not API keys) and are not part of the public OpenAPI spec.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/bulk-export` | Start an export job |
| GET | `/api/bulk-export/status` | Active job or last completed export for this user |
| GET | `/api/jobs/:id` | Poll job state/progress (shared job infra) |
| GET | `/api/jobs/:id/download` | Stream the finished ZIP |

**POST `/api/bulk-export`** — JSON body of booleans (all default false; presentations are always included): `includeVersions`, `includeImageLibrary`, `includeSlideLibrary`, `includeThemes`.

- `202` `{ ok, jobId, statusUrl, downloadUrl }` when queued via BullMQ (job IDs are prefixed `heavy-`).
- `200` with additional `sync: true` when Redis is unavailable — the export ran synchronously and is immediately downloadable.
- `429` if the user already has an active export (one at a time per user).
- `401` without a session.

**GET `/api/bulk-export/status`** — `{ active: true, jobId, statusUrl, downloadUrl }` while running; `{ active: false, lastExport: { jobId, downloadUrl, completedAt } }` if a finished ZIP is still within its TTL; otherwise `lastExport: null`.

**GET `/api/jobs/:id`** — `{ id, state, progress, ... }`; on `completed` adds `result` (stats) and `downloadUrl`; on `failed` adds `error`. Sync jobs (`heavy-sync-...`) always report completed.

**GET `/api/jobs/:id/download`** — streams the ZIP as `application/zip` (`deckyard-backup.zip`). Ownership is enforced: a bulk result stores `ownerEmail` and any other authed user gets `403`. Expired/unknown results give `404`.

## Job lifecycle

1. POST validates auth, rejects if an export is already active for the user, and enqueues a `bulk-export` job on the `heavy` queue (concurrency 1). Without Redis it falls back to running the export inline.
2. The worker calls `buildBulkExport()`, reporting progress 0–100 (collect presentations → versions → image library → slide library → themes → resolve images → build ZIP).
3. The ZIP is written to a temp file (`os.tmpdir()/deckyard-export-<uuid>.zip`, DEFLATE level 6, streamed — never buffered whole in memory).
4. The result (file path + metadata) is stored in an in-memory map with a **2-hour TTL**; a timer then unlinks the temp file and drops the entry. The "last completed export" pointer per user only resolves while the result is still stored.
5. On success the worker fires (non-blocking): an `export_ready` in-app notification linking to `/settings#export`, a `notification:new` SSE broadcast to the user, and an "export ready" email.

## Archive layout

```
manifest.json                     exportedAt, exportedBy, stats, warnings
presentations/<id>.json           full presentation documents (always included)
versions/<presId>/<versionId>.json   (includeVersions)
image-library/index.json          (includeImageLibrary)
slide-library/personal.json       (includeSlideLibrary)
slide-library/team.json           (includeSlideLibrary)
themes/<id>.json                  (includeThemes; org-scoped theme list)
assets/<sha256-16><ext>           referenced images, deduplicated by content hash
assets/url-map.json               original URL → assets/<file> mapping
```

Image collection walks slide content (fields like `bgImage`, `image`, `src`, `url`, `logoUrl`, incl. i18n versions, image-library entries and theme logos). Local paths (`/uploads/`, `/assets/`, `/custom/assets/`, `/custom/themes/`) are read from disk with a path-traversal guard; remote URLs are fetched with a 30s timeout and a concurrency limit of 5 (10 when >50 URLs). Failures are counted in `manifest.stats` and listed in `manifest.warnings`, never fatal. Note: `stats.totalSizeBytes` is set after zipping, so it appears in API responses but not in the in-ZIP `manifest.json`.

## UI

`client/views/settings/tabs/export-tab.js` renders the **Data Export** tab in Settings: option checkboxes, a Start button, a progress bar (polls `/api/jobs/:id` every 2s, with phase labels derived from the progress percentage), and a Download button when done. It also listens on the notifications SSE stream for `export_ready`, and on tab load calls `/api/bulk-export/status` to resume polling an in-flight export or re-offer the last completed download. "Hide progress" only hides the UI; the job keeps running and the notification/email still arrive.

## Limits and cleanup

- One active export per user (`429` otherwise); the heavy queue processes one bulk export at a time server-wide.
- Downloads expire 2 hours after completion; the temp ZIP is deleted on expiry.
- Active/last-export tracking and stored results are process-local (in-memory maps), so multi-instance deployments and restarts don't share or persist them. No database table is involved.
- Exports over 500 MB add a warning to the manifest but are not blocked.

## Files involved

| File | Role |
|------|------|
| `server/routes/api/bulk-export.js` | POST/start + status endpoints, sync fallback, per-user rate limit |
| `server/export/bulk-export.js` | Export engine: collects data, resolves images, builds the ZIP |
| `server/jobs/queue/workers/bulk-export-worker.js` | Heavy-queue worker, result store + TTL cleanup, active-export tracking, notifications |
| `server/routes/api/jobs.js` | Shared job status + download endpoints (streams heavy-queue results from disk) |
| `server/integrations/email/senders-export.js` | "Export ready" email |
| `client/views/settings/tabs/export-tab.js` | Settings → Data Export tab (options, progress, download) |
