# Instance health

Which surfaces of this install are actually used: which slide types are
authored and viewed, on which public surfaces decks are seen, which export
formats, audience interactions, MCP tools and v1 operations people reach for.
The counters exist so that a pruning discussion can end in a number instead
of "maybe someone uses it" (A7.3, D26, D245–D251).

This is **instance telemetry, not visitor analytics.** It holds no person, no
deck, no organization and no device; nothing in it can be traced back to who
did what, and nothing leaves the instance. Visitor analytics (view sessions,
slide views, GDPR erasure) is a different subsystem:
[`analytics-privacy.md`](analytics-privacy.md).

## The table

`instance_health (axis varchar(32), key varchar(128), day date, count
integer, primary key (axis, key, day))` — migration
`server/db/migrations/089_instance_health.js`, plus an index on `day`.

One row per key per axis per UTC day. A sighting upserts today's row and adds
one to `count`.

**The measure is days-active, not `count`.** Autosave, refreshes and a
follow-along audience polling its deck all inflate `count`; none of them can
inflate the number of days a key was seen, or move its last-seen day. The
view reads those two (B516); `count` is kept for the record.

## One writer

`server/storage/instance-health.js` is the only module that touches the table
(`tests/instance-health-single-writer.test.js` pins it):

| Export                             | What it does                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `recordInstanceHealth(entries)`    | validates, then one multi-row upsert for the distinct `(axis, key)` pairs of today |
| `countInstanceHealth(entries)`     | the same, fire-and-forget — what a measuring point calls                           |
| `countDeckView(surface, pres)`     | `surface:<surface>` plus `slide_type.viewed:<type>` for every type in the deck     |
| `slideTypeEntries(axis, pres)`     | the distinct slide types of a deck, every language version included                |
| `readInstanceHealth({ sinceDay })` | the rows from a day on, oldest first, `day` as `YYYY-MM-DD`                        |
| `readFirstInstanceHealthDay()`     | the first day any row was counted, the start of the D26 term                       |
| `summarizeInstanceHealth(rows)`    | folds rows into days active, last seen and count per key, per axis (pure)          |
| `pruneInstanceHealth(cutoffDay)`   | deletes the days before the cutoff                                                 |

The functions take **no storage scope**: the table has no organization for a
scope to state ([`storage-scope.md`](storage-scope.md) § _Instance telemetry
takes no scope_). A write is a no-op without a database.

## The vocabulary

A key is written `axis:key`. An axis outside this list, or a key outside a
closed axis's list, is a `TypeError` — a programming error, never an
"unknown" bucket.

| Axis                  | Keys                                                                                                                                                 | Counted where                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `slide_type.authored` | a slide type (`matrix-slide`, `custom-<slug>`)                                                                                                       | the presentations facade: every new deck (create, import, duplicate) in its one insert, and every save whose body carries `slides` or `i18n`                                                                             |
| `slide_type.viewed`   | a slide type                                                                                                                                         | the four viewing handlers, beside `surface`                                                                                                                                                                              |
| `surface`             | `share`, `published`, `embed`, `follow`                                                                                                              | `routes/static/share-viewer.js`, `routes/static/published.js` (page and reader), `routes/static/embed.js`, `routes/api/follow/presentation.js` (live deck served)                                                        |
| `export`              | `json`, `deck`, `html`, `pdf`, `pdf-slides`, `png`, `png-zip`, `pptx`, `pptx-editable`, `pptx-template`, `handoff`, `notes-md`, `notes-docx`, `bulk` | `prepareExportContext` in `server/services/exports.js` once the read check passes, for the internal and v1 routes alike (a queued export is counted when it is admitted, not again in the worker); the bulk backup start |
| `interaction`         | `poll_opened`, `poll_vote`, `likert_opened`, `likert_vote`, `feedback_submitted`, `question_created`, `live_session`, `follow_code`                  | the storage facades: `interactions.js`, `feedback.js`, `questions.js`, `live-sessions/sessions.js`, `follow-codes.js`                                                                                                    |
| `mcp`                 | a tool name                                                                                                                                          | `_handleToolsCall` in `server/mcp/protocol.js`, once the tool is known and its policy passed                                                                                                                             |
| `api_v1`              | an `operationId`                                                                                                                                     | `dispatchRoutes` for a v1 row that carries an `id` (B515)                                                                                                                                                                |

The details a reader of the numbers needs:

- **A view is a public view.** Opening a deck in the editor
  (`GET /api/presentations/:id`) is not one. A slug redirect is not one; the
  page it lands on is. The follow surface counts when the live deck is
  served, not while it is "translating" or not live.
- **An export is counted when it is asked for and allowed.** A refused export
  (403, 404, no permission) counts nothing; one whose build then fails still
  counts. The PDF preview and the server-rendered `pdf-slides.pdf` share
  `pdf-slides`; the PNG preview and a single-slide PNG share `png`. The v1
  print export is `pdf`, like the app's print preview.
- **An interaction is counted when it happens.** `*_opened` on every ensure of
  a poll or likert (the presenter reaching the slide, and an audience member
  loading it, both go through the same ensure), `*_vote` on an
  accepted vote, `live_session` when a session is started or resumed,
  `follow_code` when an audience member resolves a code (minting one is part
  of `live_session`, not a separate use).
- **An MCP call is counted before its handler runs**, whatever it answers,
  the same rule the HTTP dispatcher follows for an operation. An unknown or
  unmounted tool counts nothing.

## What is deliberately not counted

- **The sandbox.** On a `SANDBOX_MODE` instance every write is a no-op
  (D248): its decks are demos built from the examples and would inflate
  exactly the example types.
- **Anything derivable from the state** (D245): how many decks carry a type
  today, which custom types exist, which settings differ from their default.
  That is a query at the moment the view opens (the census, B516), never a
  counter that could drift from the state.
- **Who, which deck, which organization.** No column holds them.

There is **no switch** (D251). `analytics.enabled` governs visitor analytics
and leaves these counters alone; a fork that does not want them removes the
measuring points.

## Retention

Rows older than **400 days** go in the daily retention job
(`server/jobs/retention-cleanup.js`, `INSTANCE_HEALTH_RETENTION_DAYS`):
thirteen months, so a deck used once a year still shows up.

## The admin view

`GET /api/instance-health?days=30|90|365` (`server/routes/api/instance-health.js`),
shown as the **Instance Health** tab under Settings → Admin
(`client/views/settings/tabs/health-tab.js`). Only an **instance** admin
(`users.role`) may read it; a membership role does not reach it. `days` is
optional (default 90); any other value is a 400, never rounded.

| Field             | What it holds                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `days`, `since`   | the window, and its first day (today counts as one of the `days`)                          |
| `firstMeasuredAt` | the first day any row was counted on this instance, whatever the window; `null` before it  |
| `decisionDueAt`   | `firstMeasuredAt` plus three calendar months (D26), clamped at a month end                 |
| `census`          | what the instance holds now, computed when the view opens (D245)                           |
| `usage`           | per axis (every axis present), per key: `daysActive`, `lastSeen`, `count`; most days first |

The census (`server/storage/instance-census.js`) has three parts:

- **`slideTypes`** — per slide type, the decks carrying it and its slides. Every
  language version is read, the way the `slide_type.authored` counter reads a
  deck; a slide present in several versions (same id) counts once. Decks in the
  trash and sandbox decks are left out.
- **`customTypes`** — per `custom-<slug>` key, how many organizations define it
  and how many of those definitions are published.
- **`settings`** — the dotted paths of the instance settings that differ from
  their default (`analytics.enabled`, `webhooks.signingSecret`). Names only;
  a value (a webhook URL, a secret) never leaves the server.

The census reads organization-owned rows across the instance under a
cross-organization scope, category 4 in
[`storage-scope.md`](storage-scope.md) § _When a scope may be
cross-organization_: it answers counts, never a row, an id or an organization.

## Implementation status (as of 2026-10-01)

B514 (table, facade, measuring points), B515 (the `api_v1` axis) and B516 (the
admin view and the census) are in. The pruning gate itself (A7.3, D26: the
prune list opens three months after the first row on a production instance)
is tracked in the planning, not here.
