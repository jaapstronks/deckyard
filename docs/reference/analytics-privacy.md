# Analytics privacy

## Purpose & scope

Deckyard records **view analytics** — who looked at a deck, for how long, and
which slides — for the deck's owner. The viewers being measured are mostly
**anonymous**: someone opening a share link or a live follow session has no
account. This document states what is stored per viewer, how a viewer erases it,
how long it is kept, and — because it is the load-bearing design decision — *why
an anonymous viewer is identified by a possessed session token and never by a
bare device id*.

It describes the analytics-privacy seams as they stand after the
analytics-privacy work (decisions recorded in `docs/plans/done/decisions.md`
§ *analytics-privacy-naden*). The tenant-isolation rules it leans on live in
[`tenant-isolation.md`](tenant-isolation.md); the wider data-subject-rights
surface for logged-in people is the GDPR export/erase endpoint below.

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
- `client/lib/format/analytics-tracker.js` — the browser tracker;
  `createAnalyticsTracker(...).erase()` is the client half of the erasure route.
- `client/lib/format/analytics-erase-button.js` — the shared "forget me" button
  used by the share-viewer and follow surfaces.

## What is recorded, per viewer type

A `view_sessions` row plus its `slide_views` children. The **identity** on the
row differs by how the viewer arrived:

| Viewer | Identity on the row | How they erase |
|--------|--------------------|----------------|
| **Logged-in** (a Deckyard account, e.g. a guest who verified their email to comment) | `viewer_email` | `DELETE /api/analytics/my-data`, authenticated — see below |
| **Anonymous** (share link or follow, no account) | `device_id` — a random 32-hex value the *browser* generates and keeps in `localStorage` (`ps.analytics.deviceId`) | `POST /api/track/my-data/erase`, proving possession of a live session token |

Also stored: `ip_address` (anonymized on a schedule, below), a truncated
`user_agent`, timings, and the slides visited. There is **no** cross-workspace
identity: a view session inherits its workspace from the presentation it belongs
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
uses: two visits from one browser to *the same* deck share a label ("a returning
viewer"). Pinned by `tests/analytics-session-device-label.test.js`.

## Erasing your data

### Logged-in: `DELETE /api/analytics/my-data`

Identity is the scope: the erasure covers every session whose `viewer_email` is
the caller's, across the whole instance, whatever workspace the caller or the
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

The client half (`analytics-tracker.js` `erase()`) sends the token, then tears
the tracker down and **drops the device id from `localStorage`**, so a later
visit begins as a fresh identity rather than re-linking to the erased history.
The "forget me" button is present on the share-viewer and follow surfaces only
while a tracker is live (analytics on → a button; analytics off → none).
Rate-limited by the same expensive-op bucket, keyed by IP. Pinned by
`tests/analytics-track-erase.test.js`.

## Retention

The `analytics-cleanup` job (`server/jobs/analytics-cleanup.js`) applies two
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

The storage *could* match on `device_id` from client input, and an earlier
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
proof-of-possession. Holding it means *the browser that opened the session* is
asking to be forgotten — the one thing a device id alone cannot demonstrate.

This has a deliberate consequence under **GDPR Article 11** ("processing not
requiring identification"). Deckyard stores no additional identifier that would
let it re-identify an anonymous viewer on request. A viewer who has kept a live
session (or any working deck link that re-establishes one) can prove possession
and erase — the button *is* that route. A viewer who has **no** working link and
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

## Implementation status

Shipped: the per-deck label, the logged-in export/erase, the anonymous
token-scoped erase with device cascade, and the retention job — all with the
tests named above. This document describes the beta stance; it does not promise
the surface is frozen. The versioning doctrine is in
[`versioning.md`](versioning.md).
