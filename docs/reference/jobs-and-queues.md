# Jobs and queues

The two ways work happens outside a request: a **BullMQ queue** on Redis for
heavy per-request work, and **interval jobs** in the server process for
recurring maintenance. Written 2026-08-05 against HEAD.

Individual consumers document their own semantics —
[`bulk-export.md`](bulk-export.md) covers the `heavy` queue's one job end to
end, and [`analytics.md`](analytics.md) covers what the analytics cleanup
deletes. This document describes the **shared layer** underneath them: the
Redis connection, the synchronous fallback when there is no Redis, worker
registration, job identity and result retrieval, and the four interval jobs
that never touch BullMQ at all.

## Purpose & scope

Some work is too slow to hold a request open for: rendering a deck to PDF,
building a multi-deck backup ZIP. Deckyard puts that on a queue when it can,
and does it inline when it cannot. **Redis is optional** — that is the load-
bearing property of this layer. Every producer asks `addJob()` for a job and
gets back `{ jobId, queued }`; when `queued` is false the caller does the work
synchronously and the caller's own code path answers the request. So a
single-container install with no Redis is a supported shape, not a degraded
one, and no feature is gated on the queue existing.

Separately, a running instance has recurring maintenance that has nothing to do
with any request: expiring tokens, trimming analytics, revoking lapsed share
links, sending the weekly digest. Those are plain `setInterval` loops started at
boot in `server/server.js` and stopped on shutdown. They are deliberately *not*
BullMQ jobs: they need no distribution, no retries and no result, and running
them on every instance of a multi-instance deploy is at worst redundant, not
wrong. Each is also runnable as a one-off from the CLI.

## Module map

The shared queue layer (`server/jobs/queue/`, 5 modules, 1.039 lines):

- `server/jobs/queue/connection.js` — the whole shared layer: queue names,
  per-queue default job options, `initializeQueues()`, `addJob()`,
  `getJobStatus()`, `registerWorker()`, `getQueueStats()`, `closeQueues()`.
- `server/jobs/queue/workers/index.js` — `initializeWorkers()`, which starts
  the three workers below in order and reports which came up.
- `server/jobs/queue/workers/export-worker.js` — the `export` queue: pptx,
  handoff-zip, pdf-slides, notes-docx, notes-md, html.
- `server/jobs/queue/workers/translate-worker.js` — the `translate` queue.
  Currently has no producer; see *Implementation status*.
- `server/jobs/queue/workers/bulk-export-worker.js` — the `heavy` queue's
  `bulk-export` job, plus the per-user active/last-completed bookkeeping.

The interval jobs (`server/jobs/`):

- `server/jobs/auth-cleanup.js` — expired magic-link and password-reset tokens,
  and old auth audit logs. Hourly.
- `server/jobs/analytics-cleanup.js` — old view sessions and slide views, IP
  anonymization, expired leads. Daily.
- `server/jobs/retention-cleanup.js` — `api_usage_daily`, expired share links,
  `activity_events`, expired slide locks. Daily.
- `server/jobs/digest-email.js` — the weekly engagement digest. Daily check,
  aligned to a wall-clock hour.

Two more sweeps live outside `server/jobs/` because they belong to their
subsystem rather than to maintenance, but they are the same shape (a `setInterval`
started from `server/server.js`):

- `server/utils/sandbox-cleanup.js` — expired guest decks, see
  [`sandbox-mode.md`](sandbox-mode.md).
- `server/utils/live-session-cleanup.js` — present-session and follow-code TTL,
  see [`live-sessions.md`](live-sessions.md).

Supporting and consuming modules:

- `server/utils/redis-client.js` — the one Redis connection, shared with the
  rate limiter and the permission cache.
- `server/storage/scope.js` — `jobScope()`, how a detached worker states which
  organization it acts in.
- `server/routes/api/jobs.js` — status, download and queue stats.
- `server/export/pipeline.js` — the export producer (queue-or-sync).
- `server/routes/api/bulk-export.js` — the bulk-export producer.

## Data model

The queue layer holds **no database tables**. Everything lives in Redis (the
BullMQ job records) or in process memory (the result stores), and both are
expendable: a restart loses in-flight jobs and stored results, which is why no
route treats a job as durable state.

Per-queue defaults (`DEFAULT_JOB_OPTIONS` in `connection.js`):

| Queue | Attempts | Backoff | Keep completed | Keep failed |
|---|---|---|---|---|
| `export` | 2 | exponential, 5 s | 1 h | 24 h |
| `translate` | 2 | exponential, 10 s | 1 h | 24 h |
| `heavy` | 1 | — | 30 min | 24 h |

Each worker keeps its own in-process **result store**, a `Map` with a
`setTimeout` eviction: 1 hour for export and translate results (base64 buffers),
2 hours for bulk export (a temp file path, whose file is unlinked on eviction).
The result carries `ownerEmail`, which is what the download route authorizes
against.

Job ids on the wire are **prefixed with the queue**: `export-<id>`,
`translate-<id>`, `heavy-<id>`. `parseJobId()` splits the prefix back off. A job
that ran synchronously gets an id of the form `sync-<timestamp>-<random>`, and
the status route recognizes that shape and answers "completed" without
consulting Redis.

The interval jobs own no state either; each writes its deletions straight
through a storage facade.

## Flows

### 1. Boot and shutdown

`server/server.js`, in order: `startSandboxCleanupLoop()`,
`startLiveSessionCleanupLoop()`, `startHeartbeat()`, then the four interval jobs
(`scheduleAuthCleanup`, `scheduleDigestEmailJob`, `scheduleAnalyticsCleanup`,
`scheduleRetentionCleanup`), then `await initializeQueues()` and
`await initializeWorkers()`.

`initializeQueues()` is idempotent and memoized on its own promise. It returns
`false` — not an error — when `isRedisConfigured()` is false or the client will
not connect, having logged "using synchronous fallback". BullMQ itself is a
**dynamic import** inside that function, so an install without Redis never
loads it.

On `SIGTERM`/`SIGINT` the shutdown path announces maintenance to open editors,
stops the heartbeat, closes collab, calls `.stop()` on each of the four interval
jobs, and then — after the HTTP server closes — `closeQueues()`, which closes
workers first and queues second.

Every interval handle is `unref()`d, so a job loop never keeps the process
alive on its own.

### 2. Producing a job

The two producers share one shape. `addJob(queueName, jobName, data, options)`
returns `{ jobId, queued }`:

- **`queued: true`** — the caller answers **202** with a `pollUrl`
  (`/api/jobs/<prefixed-id>`) and stops. Exports do this in
  `server/export/pipeline.js`; the request is already authorized at that point
  (`getPresentation` on the session context, then `canReadPresentation` with the
  collaborator permission), so nothing unauthorized reaches the queue.
- **`queued: false`** — the queue is unavailable, and the caller falls through
  to its synchronous builder. The export handler runs the normal export
  pipeline; `bulk-export.js` calls `buildBulkExport` inline, stores the result
  under the sync id, and answers 200 with `sync: true`. `?sync=1` on an export
  forces this branch even when Redis is up.

The payload always carries what the worker cannot look up for itself:
`repoRoot`, `ownerEmail` (the requester) and `organizationId` (the workspace the
request acted in).

### 3. Consuming a job

`registerWorker(queueName, processor, { concurrency })` dynamically imports
BullMQ's `Worker`, wires `completed` / `failed` / `error` logging, and pushes
the worker onto the module-level list `closeQueues()` drains. It returns `null`
without trying when Redis is not configured, so `initializeWorkers()` on a
Redis-less install simply reports zero workers.

Concurrency is set per worker and is the only throttle: export 2, translate 1
(LLM rate limits), bulk export 1.

A worker runs detached from the request that queued it, so it has no session and
no storage scope. It builds one from the payload: `jobScope(job.data, '<reason>')`
returns the stated `organizationId` when there is one, and otherwise
`singleWorkspaceScope()`, which answers with the configured organization on a
single-workspace install and **throws** under `MULTI_WORKSPACE_ENABLED` — where
"the default one" has stopped being an answer. See
[`tenant-isolation.md`](tenant-isolation.md).

Workers report progress with `job.updateProgress(n)` at fixed milestones, and
store their output in the module's result store keyed by job id.

### 4. Polling and downloading

- `GET /api/jobs/:id` — parses the prefix, short-circuits `sync-` ids to
  "completed", otherwise reads BullMQ state (`waiting`, `active`, `completed`,
  `failed`, `delayed`), progress and attempt count.
- `GET /api/jobs/:id/download` — streams or sends the stored result.

Both gate a completed result on `ownsStoredResult(result, authedUser)`: the
result's stamped `ownerEmail` must equal the caller's email, and a missing value
on either side fails closed. Job ids are enumerable integers, so a non-owner is
answered **404**, not 403 — a 403 would confirm the job exists (security-audit
H3).

- `GET /api/jobs/queue/:name/stats` — instance-admin only; returns waiting /
  active / completed / failed / delayed counts, or `available: false` when there
  is no Redis.

### 5. An interval job

All four share one shape, and it is worth stating because it is the reason they
are safe to run unattended:

1. `schedule…()` reads its interval, defines `runJob()`, and **runs it once
   immediately** — so a fresh boot does not wait a full period.
2. A module-level `isRunning` flag makes a slow run skip the next tick instead
   of overlapping.
3. `runJob()` catches and logs everything: a failing cleanup never takes the
   process down.
4. The returned handle exposes `stop()`, which shutdown calls.
5. A `process.argv[1]` guard at the bottom makes the module runnable directly
   (`node server/jobs/retention-cleanup.js`) for a one-off run.

The digest job is the one variant: instead of a bare interval it computes the
delay to the next `runAtHour`, fires a `setTimeout`, and only then settles into
a 24-hour interval — so digests go out at a predictable wall-clock hour rather
than at whatever time the process happened to boot.

## Config & flags

| Variable | Effect |
|---|---|
| `REDIS_URL` | Full connection URL. When set (or `REDIS_HOST` is), the queue system initializes; otherwise everything runs synchronously. |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` | The discrete-parameter alternative to `REDIS_URL`. |
| `REDIS_ENABLED=false` | Explicitly disables Redis even when a URL or host is configured — the supported way to force the synchronous path. |
| `ANALYTICS_RETENTION_DAYS`, `ANALYTICS_IP_ANONYMIZATION_DAYS` | Seed the defaults for `settings.analytics.retention.*`; the cleanup job reads the settings value (admin UI wins). See [`analytics.md`](analytics.md) and [`analytics-privacy.md`](analytics-privacy.md). |
| `ACTIVITY_RETENTION_DAYS` | Retention for `activity_events`, default 180. Those rows carry actor emails, which is why they expire at all. |

The intervals themselves are not env-configurable: they are defaults in each
module (auth 1 h, analytics 24 h, retention 24 h, digest 24 h at `runAtHour`),
overridable only by the caller that schedules them.

## Authz & tenancy

- **Producing** is authorized before the job exists. The export producer
  re-checks read access on the deck; bulk export runs behind its own route
  guard and a one-active-export-per-user limit.
- **Consuming** carries no session. The organization travels in the payload and
  becomes a storage scope through `jobScope()`; nothing in a worker falls back
  to the default organization. This is one of the three "no session" cases named
  in [`tenant-isolation.md`](tenant-isolation.md).
- **Retrieving** is owner-stamped, not deck-authorized: the result belongs to
  the person who asked for it. A collaborator with read access on the deck
  cannot download someone else's export of it.
- **Queue stats** require the instance `isAdmin` flag.
- **Interval jobs** are instance-global maintenance and take no organization at
  all — R3 in `tenant-isolation.md`. They sweep every workspace's rows in one
  pass, which is correct for a cleanup and would be wrong for anything a user
  reads.

## Implementation status

Normative target: **one shared queue layer, one way to schedule recurring work,
and Redis optional throughout.** Where the code stands, as of 2026-08-05:

- **The queue layer matches the target.** Three queues, one connection module,
  one worker registry, and a fallback that is exercised by every install without
  Redis rather than being theoretical.
- **The `translate` queue has a worker but no producer.** `translate-worker.js`
  is registered at boot and `routes/api/jobs.js` can report and serve its
  results, but nothing calls `addJob(QUEUE_NAMES.TRANSLATE, …)`: the translate
  routes (`server/routes/api/presentations/translate.js`,
  `translate-missing.js`) do the work inline in the request. The queue, the
  worker and its result store are therefore dead code today. Finish-or-strip is
  a decision, not a doc note — recorded in the reference-doc-gaps brief.
- **Result stores are per-process, not shared.** Two app instances behind a load
  balancer share the *queue* but not the *results*: a poll or download that
  lands on the instance that did not run the job finds nothing. Single-instance
  deployments — every supported shape today — are unaffected, but the queue's
  distribution promise stops at the result boundary.
- **Interval jobs run on every instance.** Each is idempotent and delete-shaped,
  so concurrent runs waste work rather than corrupt it. There is no leader
  election, and none is needed at the current deployment shapes.
- **Interval jobs are not observable.** They log, and nothing else: no last-run
  timestamp, no admin surface, no failure signal beyond stderr. The queue has
  `/api/jobs/queue/:name/stats`; the interval jobs have no counterpart.
