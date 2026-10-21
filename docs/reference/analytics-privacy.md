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
share-link verification keeps nothing of the visitor: it moves the link's use
counter only (the IP/user-agent log it used to write was dropped in B784). A
revoked share-link request that notifies the deck author writes a 24-hour
deduplication record holding the accessor IP, and an in-app notification that
holds no visitor datum (B785). The current storage and cleanup boundaries are
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
- `server/services/access-notifications.js` with
  `server/storage/access-attempts.js` — the revoked-link author notification
  and its deduplication record; `server/jobs/retention-cleanup.js` deletes
  that record once it leaves the window (§ Revoked-link attempts below).
- `client/views/analytics/tracker.js` — the browser tracker;
  `createAnalyticsTracker(...).erase()` is the client half of the erasure route.
- `client/views/analytics/erase-button.js` — the shared "forget me" button
  used by the share-viewer and follow surfaces.

## Anonymous visitor records adjacent to analytics

The register `tests/fixtures/anonymous-visitor-stores.json` is the source; this table is its reading copy. The register lists, per table, the identity columns, every producer, the readers, the cleanup and erase path (or a reasoned exception), the tests and the anchor in this document, and `tests/anonymous-visitor-stores-gate.test.js` checks it against the code (B786): every `insertInto(…).values({ … })` under `server/` that writes an IP, user agent, device id, session token or accessor e-mail must belong to a registered table through a registered producer, every registered function, route and test must exist, and this table must name every registered table. A new store therefore fails `npm test` until it has a register line, a lifetime and a mention here.

The gate found the inventory to be wider than the share/follow analytics flows the earlier audits covered (2026-10-19 and 2026-10-20): the live-session audience tables and the account-token and authentication-audit tables write the same kind of identity, so they are registered and listed too. Production row counts and operational retention were not measured.

| Store                                           | Producer and purpose                                                                                                                                                                                                                                                                                                                                                           | Recorded identity                                                                                                                                                                                   | Reader                                                                                                                                                                               | Current lifetime and erasure boundary                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view_sessions` with `slide_views`              | Public tracking routes record a view session and slide timing when analytics is enabled (`server/routes/api/analytics-track.js`, `server/storage/analytics/view-sessions.js`).                                                                                                                                                                                                 | Anonymous device ID and session token, IP, truncated user-agent; a signed-in viewer can instead have an email.                                                                                      | A deck reader can list that deck's sessions; the route replaces the raw device ID with a per-deck label and removes the session token (`server/routes/api/analytics/metrics.js`).    | The analytics cleanup anonymizes IP after the configured window and deletes old sessions and slide views; the two analytics erase routes act on these rows only. Details below.                                                                                                                                                                                        |
| `access_attempt_log`                            | The revoked-link notification service writes one record per notification it sends to the deck author (`server/routes/api/share-links/public.js`, `server/services/access-notifications.js`, `server/storage/access-attempts.js`). An attempt the 24-hour deduplication suppresses is not written: there is no unnotified attempt row.                                          | Organization and deck IDs, access type and link reference, attempt time (which is the notification time), client IP; this public producer supplies no email and the table has no user-agent column. | Only `shouldNotifyAuthor`, the deduplication lookup, which reads records inside `ACCESS_ATTEMPT_WINDOW_MS` (24 hours). No endpoint exposes the table to the author or anyone else.   | The daily retention job (`server/jobs/retention-cleanup.js`) deletes records older than the window, so a record lives 24 hours plus at most one job interval; migration 093 removed the backlog at upgrade. A deck or organization deletion cascades to its rows. No erase route: the record is IP-only and expires within the window (§ Revoked-link attempts below). |
| `user_notifications` (`access_attempt` rows)    | If the author notification is due, the same service saves a notification whose JSON `data` holds the access type, the accessor email when one is known, and the deck title, then broadcasts it by SSE (`server/services/access-notifications.js`, `server/storage/notifications.js`). It holds no accessor IP (B785); migration 093 stripped the key from rows written before. | Recipient email and organization, deck ID; no visitor datum.                                                                                                                                        | The authenticated recipient can read notifications in their organization through `/api/notifications`.                                                                               | The recipient's own inbox data: archiving changes inbox state, there is no notification age cleanup, and deck or organization deletion cascades to the row. Nothing of the visitor remains in it to erase.                                                                                                                                                             |
| `feedback` and `interaction_votes`              | The live-session audience routes record one feedback entry and one poll or likert vote per device (`server/routes/api/follow/interactions.js`, `server/storage/feedback.js` `submitFeedback`, `server/storage/interactions.js` `voteInteraction`).                                                                                                                             | A browser-generated device id, keyed to the live session; no IP, no user agent, no e-mail.                                                                                                          | The presenter's aggregate and feedback list (`getInteractionAggregate`, `getFeedbackAggregate`, `listFeedbackEntries`); the audience sees its own answer through the same aggregate. | The row lives with its 24-hour live session: the live-session sweep (`server/jobs/live-session-cleanup.js`, `sweepExpiredSessions`) deletes the session and the rows cascade away; the presenter can clear a slide (`resetFeedback`, `resetPollInteraction`, `resetLikertInteraction`). No visitor erase route (§ Live-session audience records below).                |
| `magic_link_tokens` and `password_reset_tokens` | A sign-in link or reset link request stores the hashed token with the requesting IP and user agent (`server/storage/magic-link.js` `createMagicToken`, `server/storage/password-reset.js` `createResetToken`); invitation tokens written by `server/storage/users.js` carry neither.                                                                                           | The account address the link is for, IP and user agent of the request. An account holder's datum, not an anonymous visitor's.                                                                       | Token validation and consumption only; no route lists tokens.                                                                                                                        | The token's `expires_at`: `server/jobs/auth-cleanup.js` deletes expired tokens every hour; `deleteUser` clears both tables for the address (§ Account tokens and the authentication audit below).                                                                                                                                                                      |
| `auth_audit_log`                                | Sign-in, sign-out, reset and magic-link events are logged with their outcome (`server/storage/password-reset.js` `logAuthEvent`).                                                                                                                                                                                                                                              | The address the event was for, IP and user agent, success flag.                                                                                                                                     | The instance user list reads successful logins for the last-login column (`server/storage/users.js` `listUsers`).                                                                    | Kept 90 days by `cleanupOldAuditLogs` in the hourly auth cleanup; no erase route, it is the instance's security record (§ Account tokens and the authentication audit below).                                                                                                                                                                                          |

A successful share-link verification writes no visitor record at all, whatever the `analytics.enabled` setting: it moves the link's `use_count` and `last_used_at`, and the response merely uses the analytics feature flag to tell the browser whether to start tracking. The per-visit IP/user-agent log it used to write had no reader and was dropped with its route (B784, migration 094). A visitor pressing the analytics “forget me” button therefore erases every visitor record this flow keeps, except the revoked-link attempt record, which holds only an IP and expires within 24 hours (§ Revoked-link attempts below).

### Revoked-link attempts and the author notification

A request for a revoked share link can tell the deck author that someone tried. That event leaves two copies, and each has a reader and a lifetime (B785, pinned by `tests/access-attempt-retention.test.js` and `tests/pg/access-attempt-retention.pgtest.js`):

- **The attempt record** (`access_attempt_log`) is the only visitor record. It is written once the notification is due, with `author_notified_at` set in the same insert, and holds the accessor's IP (or email, when the accessor is signed in) because that is what the deduplication matches on: the author is notified at most once per accessor per `ACCESS_ATTEMPT_WINDOW_MS`, 24 hours. An attempt inside the window of an earlier notified one is not written anywhere. The window is functional, not configurable, so there is no env var. The retention job deletes records past the window, and migration 093 did so for the rows written before this change.
- **The notification** (`user_notifications`, type `access_attempt`) is addressed to the author and names the deck and the access type; it carries no IP. It is the recipient's inbox data and is kept under the ordinary inbox controls (read, archive); there is no visitor datum left in it to erase.

There is no erase route for the attempt record, by the same reasoning as for the analytics device id below (GDPR art. 11): the record holds nothing but an IP, there is no identifier a visitor could present to prove it was theirs without letting anyone erase anyone's, and it expires within the window regardless, so it is gone within a day in any case.

### Live-session audience records

An audience member of a live session answers a poll, a likert scale or a feedback slide from their own device. Each answer is one row in `interaction_votes` or `feedback`, keyed by the browser-generated device id so that a device answers once and can change its answer; the row holds no IP, user agent or e-mail. The reader is the presenter's aggregate (and, for feedback, the entry list), which the audience view also receives to show its own answer. The lifetime is the live session's: the tables foreign-key the session with `ON DELETE CASCADE` ([`live-sessions.md`](live-sessions.md)), the live-session sweep deletes expired sessions and the answers go with them, and the presenter can clear a slide at any time. There is no visitor erase route, for the art. 11 reason below: a device id proves nothing about whose it is, and the rows expire with the session in any case. Pinned by `tests/pg/live-interactions.pgtest.js`.

### Account tokens and the authentication audit

Three tables hold an IP and a user agent for an account holder rather than an anonymous visitor, and are registered so the gate can tell a new visitor store from them. A sign-in link or a password reset link request writes a hashed token to `magic_link_tokens` or `password_reset_tokens` with the requesting IP and user agent; the token is read only to be validated and consumed, it expires with its `expires_at`, the hourly auth cleanup (`server/jobs/auth-cleanup.js`) deletes expired tokens, and `deleteUser` clears both tables for the address. Pinned by `tests/auth-cleanup-tokens.test.js`, `tests/delete-user-login-tokens.test.js` and `tests/pg/cleanup-jobs.pgtest.js`. Authentication events (sign-in, sign-out, reset and magic-link, with their outcome) are logged to `auth_audit_log` with IP and user agent; the instance user list reads successful logins for its last-login column, and `cleanupOldAuditLogs` removes rows older than 90 days. There is no erase route for the audit: it is the instance's security record of attempts against an address, kept for the operator for that window, and the table has no organization column to bind a request to ([`storage-scope.md`](storage-scope.md) category 5).

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
