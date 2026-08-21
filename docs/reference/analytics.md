# View analytics (engagement insights)

## Purpose & scope

Deckyard measures **how a deck was viewed**: a viewer opens it through a share
link, a published page, an embed or a live follow session; the browser opens a
_view session_, heartbeats while the tab is alive, reports each slide it enters,
and ends the session on exit. The owner reads that back as an overview, a slide
engagement table, a heatmap, a viewer journey, a session list and a live viewer
count — and can freeze a date range into a shareable **analytics report**.

This document covers the subsystem end to end: the public tracking routes, the
storage and aggregation queries, the authenticated read endpoints, the reports,
and the retention job. It deliberately does **not** restate the privacy design —
what is stored per viewer, the per-deck device label, the two erase routes and
the GDPR Article 11 reasoning live in
[`analytics-privacy.md`](analytics-privacy.md), which is the normative document
for that half. Lead capture (`server/storage/leads.js`,
`server/routes/api/leads.js`) is a separate feature that happens to share the
cleanup job; it is not covered here.

## Module map

Helpers and config (`server/analytics/`, 3 modules):

- `server/analytics/helpers.js` — `ANALYTICS_CONFIG` (all env-tunable),
  `TRACKING_RATE_LIMITS` / `AUTH_RATE_LIMITS`, input validation
  (`isValidDeviceId`, `isValidSessionToken`, `isValidSlideIndex`,
  `isValidSourceType`, `sanitizeUserAgent`), `SOURCE_TYPES`, `publicDeviceLabel`,
  the JSON response helpers, `SECURITY_EVENTS` / `logSecurityEvent`, and
  `applyDateFilters`.
- `server/analytics/head.js` — `analyticsHeadHtml()`: the **third-party** web
  analytics snippet (GTM, Plausible, Umami, Matomo, Google Analytics, or a raw
  custom snippet) injected into a page head. Unrelated to Deckyard's own view
  tracking beyond the shared name.
- `server/analytics/tracking-script.js` — `generateTrackingScriptHtml()`: the
  inline tracker for pages served outside the SPA (`/p/<publishId>` and embeds),
  which calls the same `/api/track/*` endpoints the SPA tracker uses.

Storage (`server/storage/analytics/`, 7 modules):

- `server/storage/analytics/view-sessions.js` — session CRUD
  (`createViewSession`, `updateViewSession`, `endViewSession`,
  `getViewSessionByToken`, `getViewSessionsForPresentation`,
  `getActiveViewerCount`, `deleteOldViewSessions`), `VIEWER_TYPES`, and a
  re-export of the GDPR functions.
- `server/storage/analytics/view-sessions-gdpr.js` — export/erase/anonymize; see
  [`analytics-privacy.md`](analytics-privacy.md).
- `server/storage/analytics/slide-views.js` — `transitionToSlide` (close the
  previous slide view, open the next), `endAllSlideViewsForSession`,
  `deleteOldSlideViews`.
- `server/storage/analytics/aggregations.js` — the four read models computed on
  demand: `getPresentationAnalyticsOverview`, `getDetailedSlideEngagement`,
  `getInteractionHeatmapData` (normalised 0–1 engagement score),
  `getViewerJourneyData`.
- `server/storage/analytics/dashboard.js` — the cross-deck dashboard:
  `getDashboardSummary`, `getDashboardTimeline`, `getTopPresentations`,
  `getSourceBreakdown`, `getPresentationsWithAnalytics`.
- `server/storage/analytics/reports.js` — report CRUD plus
  `getAnalyticsReportByToken` and `regenerateShareToken`.
- `server/storage/analytics/weekly-summary.js` — the week's numbers per user,
  consumed by `server/services/digest-generation.js` and
  `server/jobs/digest-email.js` (not by any route).

Routes:

- `server/routes/api/analytics-track.js` — the **public** tracking
  endpoints plus the anonymous erase route.
- `server/routes/api/analytics/index.js` — the authenticated
  dispatcher; applies the per-user rate limit, then routes to the modules below.
- `server/routes/api/analytics/dashboard.js` — cross-deck dashboard
  and the "decks that have analytics" list.
- `server/routes/api/analytics/metrics.js` — overview, slides,
  heatmap, journey, sessions (the last one applies `publicDeviceLabel`).
- `server/routes/api/analytics/realtime.js` — the live viewer-count
  SSE stream, with its own `activeConnections` map.
- `server/routes/api/analytics/reports.js` — report CRUD and
  share-token regeneration.
- `server/routes/api/analytics/public.js` — `GET
/api/analytics/reports/:token`, the only unauthenticated read.
- `server/routes/api/analytics/gdpr.js` — `GET`/`DELETE
/api/analytics/my-data`.
- `server/routes/api/analytics.js` — a compatibility re-export of
  `analytics/index.js`.

Job:

- `server/jobs/analytics-cleanup.js` — `scheduleAnalyticsCleanup()`, started once
  in `server/server.js` and run every 24 h (plus immediately at boot). It deletes
  expired sessions and slide views, anonymizes old IPs, and — sharing the ride —
  anonymizes expired leads.

Client:

- `client/views/analytics/` (14 modules) — the dashboard, date picker, timeline
  and heatmap charts, viewer list, realtime viewer, report modal, the public
  `shared-report.js` view and the leads tab.
- `client/lib/format/analytics-tracker.js` — the SPA-side tracker.

## Data model

Table `view_sessions` (`server/db/migrations/014_presentation_analytics.js`;
`024_analytics_privacy.js` added `attribution_allowed`, `065_…` dropped
`organization_id`, `066_…` dropped `is_internal`):

| Column                                         | Type           | Notes                                                    |
| ---------------------------------------------- | -------------- | -------------------------------------------------------- |
| `id`                                           | uuid           | primary key                                              |
| `presentation_id`                              | uuid           | NOT NULL, FK → `presentations(id)` **ON DELETE CASCADE** |
| `session_token`                                | varchar(64)    | unique — 64 hex chars, the viewer's proof of possession  |
| `source_type`                                  | varchar(20)    | `share_link` \| `follow` \| `embed` \| `published`       |
| `source_id`                                    | varchar(100)   | share token, publish id, or live-session id              |
| `viewer_type`                                  | varchar(20)    | `anonymous` \| `guest` \| `authenticated`                |
| `viewer_email`                                 | varchar(320)   | only for an authenticated viewer                         |
| `device_id`                                    | varchar(100)   | 32 hex, browser-generated; never leaves the DB raw       |
| `started_at` / `ended_at` / `last_activity_at` | timestamptz    | `last_activity_at` drives the active-viewer query        |
| `duration_seconds`                             | integer        |                                                          |
| `exit_slide_id` / `exit_slide_index`           | uuid / integer | where the viewer left                                    |
| `ip_address`                                   | varchar(45)    | nulled by the retention sweep                            |
| `user_agent`                                   | text           | truncated to `MAX_USER_AGENT_LENGTH`                     |
| `attribution_allowed`                          | boolean        | viewer opted into having their name shown                |

The session row carries **no `organization_id`**: it inherits the organization from
its presentation (tenant-isolation rule R2, migration 065 dropped the column).

Table `slide_views` — one row per slide _visit_: `view_session_id` and
`presentation_id` (both cascade), `slide_id`, `slide_index`, `entered_at`,
`exited_at`, `duration_seconds`, `visit_number` (a re-entry increments it).

Table `analytics_reports` — `presentation_id`, `title`, `report_type`,
`start_date`/`end_date`, `share_token` (unique, nullable), `share_expires_at`,
`is_public`, `report_data` (jsonb — the frozen numbers), `created_by`,
`organization_id`.

There is no snapshot or pre-aggregate table: every metric is computed live from
`view_sessions` + `slide_views` on each request. (`analytics_snapshots` (014) and
`aggregate_analytics` (024) once sat in the schema as caching layers that were
never wired; migration 072 dropped them.)

## Flows

- **Session start** — `POST /api/track/session/start {presentationId,
sourceType, sourceId?, deviceId?, viewerType?, viewerEmail?}`. The handler
  rate-limits by IP, validates the source type and device-id format, then calls
  `validatePresentationAccess`: the deck must exist and the claimed source must
  hold up (a `share_link` source must present a valid share token, a `follow`
  source must correspond to a real follow state). Two silent opt-outs answer
  `{sessionToken: null}` instead of an error — analytics disabled instance-wide
  (`settings.analytics.enabled`), and an authenticated viewer whose own
  `privacy.disableAllTracking` is set. Otherwise a 64-hex `session_token` is
  minted and returned.
- **Heartbeat / slide view** — `POST /api/track/session/heartbeat` keeps
  `last_activity_at` fresh (the client sends one every
  `HEARTBEAT_INTERVAL_MS`); `POST /api/track/slide/view` calls
  `transitionToSlide`, which closes the open slide view and opens the next.
  Both are rate-limited twice: per IP _and_ per session token.
- **Session end** — `POST /api/track/session/end` writes the exit slide and
  duration and closes every open slide view.
- **Reading metrics** — the six `GET /api/presentations/:id/analytics…`
  endpoints each run their aggregation query over the raw rows for the requested
  date range. Nothing is pre-computed: every dashboard load re-aggregates.
- **Live viewer count** — `GET /api/presentations/:id/analytics/realtime` is an
  SSE stream that pushes `getActiveViewerCount()` every
  `SSE_UPDATE_INTERVAL_MS` (sessions whose `last_activity_at` is within
  `ACTIVE_THRESHOLD_SECONDS`), and force-closes after `SSE_TIMEOUT_MS`.
- **Reports** — creating a report freezes the aggregation for a date range into
  `report_data` and optionally mints a 64-hex `share_token`. `GET
/api/analytics/reports/:token` serves it without a login: the token is the
  authorization, so the handler rate-limits against enumeration, validates the
  token _shape_ before hitting the database, and re-checks that the deck still
  exists and has not gone `private` (a private deck 403s even with a valid
  token). `POST …/regenerate-token` invalidates the old link.
- **Retention** — the daily job deletes sessions and slide views older than the
  configured session-data window and nulls `ip_address` older than the
  IP-anonymization window. Both come from `settings.analytics.retention.*` (the
  admin UI), read fresh on every run; the env vars only seed the defaults.

## Config & flags

| Name                                 | Default   | Purpose                                                                                                  |
| ------------------------------------ | --------- | -------------------------------------------------------------------------------------------------------- |
| `ANALYTICS_HEARTBEAT_INTERVAL_MS`    | 30 000    | Client heartbeat cadence.                                                                                |
| `ANALYTICS_ACTIVE_THRESHOLD_SECONDS` | 60        | Window that counts a session as "active now".                                                            |
| `ANALYTICS_SSE_TIMEOUT_MS`           | 3 600 000 | Absolute lifetime of a realtime stream.                                                                  |
| `ANALYTICS_SSE_UPDATE_INTERVAL_MS`   | 5 000     | Realtime push cadence.                                                                                   |
| `ANALYTICS_MAX_USER_AGENT_LENGTH`    | 500       | Truncation ceiling.                                                                                      |
| `ANALYTICS_MAX_SLIDE_INDEX`          | 1 000     | Sanity bound on a reported slide index.                                                                  |
| `ANALYTICS_RETENTION_DAYS`           | 90        | **Seeds** the default raw-row deletion age; `settings.analytics.retention.sessionDataDays` overrides it. |
| `ANALYTICS_IP_ANONYMIZATION_DAYS`    | 7         | **Seeds** the default IP-nulling age; `settings.analytics.retention.ipAnonymizationDays` overrides it.   |
| `AUTH_SECRET`                        | —         | Keys the per-deck device label HMAC.                                                                     |

Third-party head snippet (`analytics/head.js`), separate from the above:
`DISABLE_ANALYTICS`, `ANALYTICS_ALLOW_IN_SANDBOX`, `ANALYTICS_INCLUDE_EMBEDS`,
`ANALYTICS_INCLUDE_EXPORTS`, `ANALYTICS_HEAD_HTML` / `ANALYTICS_HEAD_HTML_B64`,
`GTM_CONTAINER_ID`, `PLAUSIBLE_DOMAIN`/`PLAUSIBLE_URL`,
`UMAMI_WEBSITE_ID`/`UMAMI_URL`. Umami, Plausible, Matomo and Google Analytics
are also configurable from the settings UI
(`settings.analytics.externalProviders`), which overrides the env vars.

### Provider identifiers are validated, never escaped

Every third-party identifier is charset-checked against its provider's own
format (`server/analytics/provider-ids.js`) — Matomo `siteId` digits, Umami
`websiteId` a UUID alphabet, Plausible `domain` a hostname (or the documented
comma-separated list), GA4 `G-…`, GTM `GTM-…` — and provider URLs must parse as
http(s) _and_ carry no quoting characters.

The check runs at both ends. The write path
(`normalizeExternalProviders`, `server/storage/settings.js`) stores `''` for a
value that fails, the same drop-on-invalid shape the URL and theme-id
normalizers use; the settings PUT echoes the stored object back, so a rejected
value shows as an empty field. The render path refuses to emit a provider whose
values fail the same check, which also covers the env vars — those never pass
through the normalizer.

Escaping is deliberately not the mechanism: several of these values are
interpolated into a `<script>` block, where HTML entities are not decoded, so
escaping would corrupt a legitimate id while failing to contain a hostile one.
This head lands on the app shell, on every published deck and on every embed,
which is what makes an admin-writable identifier a public surface.

Settings, not env: `settings.analytics.enabled` is the **single master switch**
for Deckyard's own tracking — off means `/api/track/session/start` returns a null
token and nothing is recorded. `settings.analytics.retention.*` is the retention
policy the cleanup job applies (the env vars above only seed its defaults).
Per-user, `settings.privacy.disableAllTracking` opts one authenticated viewer out
everywhere.

Rate limits (token buckets, `analytics/helpers.js`): per IP — session start
10 burst / 0.5 per s, heartbeat 20 / 2, session end 10 / 1, slide view 30 / 3;
per session — heartbeat 5 / 0.5, slide view 10 / 1. Authenticated reads 60 / 1
per user; report creation and the GDPR routes use the expensive bucket 10 / 0.2;
public report reads 10 / 0.2 per IP.

## Authz & tenancy

- **Tracking routes are genuinely public**, dispatched before the login gate in
  `server/routes/api/index.js` — an anonymous audience device must be able to
  call them. Their defence is not authentication but `validatePresentationAccess`
  (the claimed source must check out), strict format validation, and the rate
  limits above. Everything under `/api/analytics/*` except the public report
  token sits _behind_ the login gate.
- **Per-deck reads** (`/api/presentations/:id/analytics…`) go through
  `withPresentationAuth({permission: 'read'})`, so deck-read is the bar for
  seeing a deck's numbers — the same permission as opening it. The realtime
  stream and report _reads_ use `read`; creating, updating, deleting a report and
  regenerating its token require `write`.
- **Cross-deck reads** (`/api/analytics/dashboard`, `/api/analytics/presentations`)
  are keyed on the caller's email and scoped to their organization.
- **Reports** are stored with an `organization_id` and read through a scope. The
  public token route is the deliberate exception: it uses
  `crossOrganizationScope(null, 'public analytics report: the report token is
the authorization')` — the token _is_ the capability, exactly as a share link
  is. General rules: [`tenant-isolation.md`](tenant-isolation.md).
- **View sessions are not org-scoped rows**; queries reach them through their
  presentation. Deleting an organization cascades decks, and decks cascade
  sessions and slide views.
- **The raw `device_id` never leaves the server**: the session list maps it
  through `publicDeviceLabel`. Rationale and the erase routes:
  [`analytics-privacy.md`](analytics-privacy.md).

## Implementation status (as of 2026-08-21)

Shipped and in use: the four tracking endpoints, the four on-demand aggregations,
the cross-deck dashboard, the realtime SSE count, report CRUD with public share
tokens, the weekly digest summary, and the daily retention job.

No pre-aggregate/caching layer exists: every metric is computed live from
`view_sessions` + `slide_views` on each request, which is why the aggregation
queries carry the cost. The two dead tables that once implied one
(`analytics_snapshots`, `aggregate_analytics`) were dropped in migration 072; if
a caching path is ever wanted it is a fresh design against the cost measured then.

Honest gaps:

- **Realtime SSE is process-local.** `activeConnections` lives in one worker's
  memory, and the viewer count is a database query, so the count is right but the
  push only reaches clients attached to that worker. Same limitation as
  [`live-sessions.md`](live-sessions.md).
- **`analytics.js` is a compatibility shim.** It exists only to re-export
  `analytics/index.js`; new code imports the module directly.
- **Two unrelated things share the word "analytics"** — Deckyard's own view
  tracking and the third-party head snippet. They share a directory and a
  settings key but nothing else.
