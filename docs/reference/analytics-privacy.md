# Analytics privacy

## Purpose & scope

Deckyard records **view analytics** (who looked at a deck, for how long, and
which slides) for the deck's owner. The viewers being measured are mostly
**anonymous**: someone opening a share link or a live follow session has no
account. This document states what analytics stores per viewer, how a viewer
erases those rows, how long they are kept, and why an anonymous viewer is
identified by a possessed session token rather than a bare device id. It also
maps the separate access records made by share-link verification and revoked-link
notifications, so the analytics controls are not mistaken for controls over
those records.

It describes the analytics-privacy seams as they stand after the
analytics-privacy work. The tenant-isolation rules it leans on live in
[`tenant-isolation.md`](tenant-isolation.md); the wider data-subject-rights
surface for logged-in people is the GDPR export/erase endpoint below.

The instance-health counters are **not** part of this surface: they count
which slide types, surfaces, formats and tools an install uses, per day,
with no person, deck, device or organization in the row, and they are not
switched by `analytics.enabled` ([`instance-health.md`](instance-health.md)).

Analytics is one of the anonymous-visitor data stores in this flow. Successful
share-link verification writes a separate IP/user-agent access log; a revoked
share-link request can write an IP access-attempt record and an in-app
notification containing that IP. The current storage and cleanup boundaries are
listed below. Lead capture (a slide that stored a visitor's name and e-mail
with its own retention and GDPR flow) was stripped on 2026-08-22 (D50).

## Module map

- `server/routes/api/analytics-track.js` — the **public, unauthenticated**
  tracking routes the viewer's browser calls: `POST /api/track/session/{start,
heartbeat,end}`, `POST /api/track/slide/view`, and the erasure route
  `POST /api/track/my-data/erase`.
- `server/routes/api/analytics/gdpr.js` — the **authenticated** counterpart:
  `GET`/`DELETE /api/analytics/my-data`, keyed by the logged-in email.
- `server/storage/analytics/view-sessions-gdpr.js` — the erase/export/anonymize
  storage: `exportUserAnalyticsData`, `deleteUserAnalyticsData` (by email),
  `eraseAnalyticsDataForDevice` / `eraseAnalyticsDataForSession` (by possessed
  token, resolved server-side), `anonymizeOldIpAddresses`.
- `server/analytics/helpers.js` — validation, rate limits, and
  `publicDeviceLabel` (the per-deck device label described below).
- `server/jobs/analytics-cleanup.js` — the retention sweep (delete old rows,
  anonymize old IPs).
- `client/views/analytics/tracker.js` — the browser tracker;
  `createAnalyticsTracker(...).erase()` is the client half of the erasure route.
- `client/views/analytics/erase-button.js` — the shared "forget me" button
  used by the share-viewer and follow surfaces.

## Anonymous visitor records adjacent to analytics

This is a source-code inventory of the share/follow analytics and share-link access flows, not a claim that every anonymous data store in the application has been audited. It was checked against the write sites, storage reads, migrations, and scheduled jobs on 2026-10-19; production row counts and operational retention were not measured.

| Store                                        | Producer and purpose                                                                                                                                                                                                                                                                                      | Recorded identity                                                                                                                                                  | Reader                                                                                                                                                                                   | Current lifetime and erasure boundary                                                                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view_sessions` with `slide_views`           | Public tracking routes record a view session and slide timing when analytics is enabled (`server/routes/api/analytics-track.js`, `server/storage/analytics/view-sessions.js`).                                                                                                                            | Anonymous device ID and session token, IP, truncated user-agent; a signed-in viewer can instead have an email.                                                     | A deck reader can list that deck's sessions; the route replaces the raw device ID with a per-deck label and removes the session token (`server/routes/api/analytics/metrics.js`).        | The analytics cleanup anonymizes IP after the configured window and deletes old sessions and slide views; the two analytics erase routes act on these rows only. Details below.                                                                                 |
| `share_link_access_log`                      | A successful `POST /api/share/:token/verify` records use of a validated link (`server/routes/api/share-links/public.js`, `server/storage/share-links/access-log.js`).                                                                                                                                     | Share-link ID, access time, client IP, raw request user-agent; no viewer email or analytics device ID.                                                             | `GET /api/presentations/:id/share-links/:linkId/access-log` requires write access to that deck and verifies that the link belongs to it (`server/routes/api/share-links/management.js`). | No age-based cleanup or IP anonymization for this table is wired into the jobs. Link revocation and expiry update the link without deleting its log; the log has a database cascade when its parent link is deleted. Neither analytics erase route includes it. |
| `access_attempt_log`                         | A request for a revoked share link can log an attempt before checking whether to notify the deck author; the log also provides the 24-hour notification deduplication lookup (`server/routes/api/share-links/public.js`, `server/services/access-notifications.js`, `server/storage/access-attempts.js`). | Organization and deck IDs, access type and link reference, attempt time, client IP; this public producer supplies no email and the table has no user-agent column. | The storage service reads recent notified attempts and marks one notified. No endpoint exposing this log to the author was found in the checked routes.                                  | No age-based cleanup is wired into the jobs. A deck or organization deletion cascades to its rows; neither analytics erase route includes them. The 24-hour lookup is a deduplication window, not a deletion schedule.                                          |
| `user_notifications` (`access_attempt` rows) | If the author notification is due, the same service saves a notification whose JSON `data` contains the accessor IP, then broadcasts it by SSE (`server/services/access-notifications.js`, `server/storage/notifications.js`).                                                                            | Recipient email and organization, deck ID, accessor IP in JSON; this public producer supplies no accessor email.                                                   | The authenticated recipient can read notifications in their organization through `/api/notifications`.                                                                                   | Archiving changes inbox state; no notification age cleanup was found in the checked jobs. Deck or organization deletion cascades to the row; analytics erase does not include it. This is a downstream copy of the attempt's IP, not another access-log table.  |

The share-link access write happens independently of the `analytics.enabled` setting; the successful verification response merely uses the analytics feature flag to tell the browser whether to start tracking. A visitor pressing the analytics “forget me” button therefore erases analytics sessions, not the access-log or notification records. These are observations of current code, not a decision that the different lifetimes or access paths should remain as they are.

## What is recorded, per viewer type

A `view_sessions` row plus its `slide_views` children. The **identity** on the
row differs by how the viewer arrived:

| Viewer                                                                               | Identity on the row                                                                                               | How they erase                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Logged-in** (a Deckyard account, e.g. a guest who verified their email to comment) | `viewer_email`                                                                                                    | `DELETE /api/analytics/my-data`, authenticated — see below                  |
| **Anonymous** (share link or follow, no account)                                     | `device_id` — a random 32-hex value the _browser_ generates and keeps in `localStorage` (`ps.analytics.deviceId`) | `POST /api/track/my-data/erase`, proving possession of a live session token |

The **live follow session records only the first of those two rows**: the
audience view (`client/views/follow/index.js`) probes `/api/auth/me` before it
starts a tracker and, for a viewer with an account, starts none at all. The
audience of an internal deck is colleagues, and their attention is not the
presenter's to measure — a signed-in follower is therefore absent from the
deck's analytics rather than present under `viewer_email`. Share links, embeds
and published pages do not make that distinction. Pinned by
`tests/follow-audience-smoke.test.js`.

Also stored: `ip_address` (anonymized on a schedule, below), a truncated
`user_agent`, timings, and the slides visited. There is **no** cross-organization
identity: a view session inherits its organization from the presentation it belongs
to and carries no copy of it (tenant-isolation rule R2); the old
viewer-claimed organization column was dropped (migration 065).

## The per-deck device label

The raw `device_id` never leaves the database. The session-list endpoint every
deck reader can call (`GET /api/presentations/:id/analytics/sessions`) maps it
through `publicDeviceLabel(deviceId, presentationId)` —
`HMAC-SHA256(AUTH_SECRET, deviceId ‖ presentationId)` truncated to 12 hex — so
the same browser reads as a **different** label in every deck. This is what
keeps two deck owners from lining up their viewer lists and establishing that
one visitor is one person, while preserving the one signal the list actually
uses: two visits from one browser to _the same_ deck share a label ("a returning
viewer"). Pinned by `tests/analytics-session-device-label.test.js`.

## Erasing your data

### Logged-in: `DELETE /api/analytics/my-data`

Identity is the scope: the erasure covers every session whose `viewer_email` is
the caller's, across the whole instance, whatever organization the caller or the
viewed deck happens to sit in. Rate-limited by the expensive-op bucket. Pinned
by `tests/analytics-gdpr-delete-path.test.js`.

### Anonymous: `POST /api/track/my-data/erase`

The public counterpart, for the device-only viewer. The request body is
`{ sessionToken }` — the **live** token the viewer's own browser is currently
using. The server:

1. validates the token's format and looks it up (`isValidSessionToken`,
   `getViewSessionByToken`); an unknown token is a `404`, a malformed one a
   `400`, neither erasing anything;
2. resolves the token's `device_id` **server-side**, and erases every session of
   that device instance-wide, with their slide views, in one transaction
   (`eraseAnalyticsDataForDevice`). A token whose session has no device id erases
   only that one session (`eraseAnalyticsDataForSession`);
3. answers `{ ok: true, deleted: { sessions, slideViews } }`.

The client half (`client/views/analytics/tracker.js` `erase()`) sends the token, then tears
the tracker down and **drops the device id from `localStorage`**, so a later
visit begins as a fresh identity rather than re-linking to the erased history.
The "forget me" button is present on the share-viewer and follow surfaces only
while a tracker is live (analytics on → a button; analytics off → none).
Rate-limited by the same expensive-op bucket, keyed by IP. Pinned by
`tests/analytics-track-erase.test.js`.

## Retention

For `view_sessions` and `slide_views` only, the `analytics-cleanup` job (`server/jobs/analytics-cleanup.js`) applies two
schedules. Both windows come from instance settings
(`settings.analytics.retention.*`, set in the admin UI) and are read fresh on
every run; the env vars `ANALYTICS_RETENTION_DAYS` and
`ANALYTICS_IP_ANONYMIZATION_DAYS` only seed the defaults an instance falls back
to before the UI is touched:

- **IP anonymization after 7 days (default)** — `ip_address` is nulled on rows
  older than the window (hashing would still be linkable, so it is dropped
  outright).
- **Full deletion after 90 days (default)** — raw `view_sessions` and
  `slide_views` older than the window are removed. Nothing else is retained:
  there is no aggregate/snapshot table.

## Why a bare device id is not an accepted identifier (GDPR art. 11)

The storage _could_ match on `device_id` from client input, and an earlier
sketch considered it. It is deliberately refused, and the reason is a data-
protection one, not merely a convenience.

A `device_id` is **generated by the viewer's own browser** and travels in the
request body, so producing one proves nothing about whose device it is.
Accepting it as an identifier would let anyone who **guessed or obtained** a
device id export — or erase — the cross-deck viewing history attached to it.
Obtaining one used to be trivial: the session list handed every deck reader the
raw value. The per-deck label narrows that, but the rule stands regardless: a
value the subject cannot keep secret cannot authorize acting on their behalf.

So the anonymous erase route requires a **live session token** as
proof-of-possession. Holding it means _the browser that opened the session_ is
asking to be forgotten — the one thing a device id alone cannot demonstrate.

This has a deliberate consequence under **GDPR Article 11** ("processing not
requiring identification"). Deckyard stores no additional identifier that would
let it re-identify an anonymous viewer on request. A viewer who has kept a live
session (or any working deck link that re-establishes one) can prove possession
and erase — the button _is_ that route. A viewer who has **no** working link and
**no** live session cannot be re-identified from a `device_id` they type in,
because — as above — that would let anyone erase anyone. Per Article 11, the
controller is not obliged to acquire or accept additional identifying
information solely to enable such a request. Deckyard therefore does not, and the
data ages out under the retention schedule above regardless.

This is the honest boundary of the current design, chosen during beta: the token
is the proof; there is no re-identification-on-request path, by design, not by
omission. Should a second consumer ever justify a durable, reusable viewer
identity primitive (a signed device token was the runner-up option), the trade
would be reconsidered as a deliberate feature — not a column kept on spec.

## Implementation status (as of 2026-08-21)

Shipped: the per-deck label, the logged-in export/erase, the anonymous
token-scoped erase with device cascade, and the retention job — all with the
tests named above. This document describes the beta stance; it does not promise
the surface is frozen. The versioning doctrine is in
[`versioning.md`](versioning.md).
