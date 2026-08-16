# Outgoing webhooks

Deckyard POSTs a JSON payload to an admin-configured URL when one of eight
events happens. Written 2026-08-05 against HEAD.

This is the only outbound integration seam that is not a named service: no
vendor SDK, no per-integration code, just a URL an operator pastes into
settings. It is therefore the surface an external integrator writes against, and
the payload shapes below are the contract.

## Purpose & scope

One event, one URL, one POST. There is no subscription model, no fan-out to
several endpoints, and no queue: the payload is built in the request that
triggered it and fired **best-effort** with `void`, so a slow or dead receiver
delays nothing and fails nothing. A failure is a `console.warn` line and no
more.

The security posture is the interesting part. A webhook URL is
server-side-fetched by definition, which makes it an SSRF vector the moment a
setting is stale, mistyped or written by a compromised admin account. Every POST
therefore passes `assertPublicHttpUrl()` first — the same guard the export
pipeline uses for remote images — with redirects refused rather than followed.
See [`security-posture.md`](security-posture.md).

## Module map

- `server/utils/webhooks.js` (353 lines) — the whole implementation: the
  `postJson` transport with the SSRF guard, three payload builders, and the
  three `maybeFire…` entry points.
- `server/utils/ssrf-guard.js` — `assertPublicHttpUrl()`: scheme check, DNS
  resolution, and a reject on any non-public address.
- `server/utils/request-url.js` — `getRequestOrigin` / `toAbsoluteUrl`, which
  turn the triggering request into the absolute links in the payload.
- `server/storage/settings.js` — where the URLs live: the `webhooks` block of
  app settings, its defaults, and `normalizeWebhookUrl()`.
- `server/routes/api/settings.js` — the admin gate on reading and writing them.
- `client/views/settings/sections/admin-webhooks-section.js` — the admin UI, one
  text field per event.

Fire sites (each names the event it fires):

| Event | Fired from |
|---|---|
| `presentation.moved_to_organization` | `server/routes/api/presentations/visibility.js` |
| `presentation.published` | `server/routes/api/publish.js` |
| `slide.added_to_team_library` | `server/routes/api/slide-library.js` |
| `comment.created` | `server/services/comment-notifications.js` |
| `lead.submitted` | `server/routes/api/leads.js` |
| `interaction.poll_closed` | `server/storage/interactions.js` |
| `interaction.likert_closed` | `server/storage/interactions.js` |
| `interaction.feedback_submitted` | `server/storage/feedback.js` |

## Data model

The URLs are **instance settings**, not per organization and not per deck. They
live in the `webhooks` object of app settings (`server/storage/settings.js`),
one string key per event, defaulting to `''` (= disabled):

```
presentationMovedToOrganizationUrl   slideAddedToTeamLibraryUrl
presentationPublishedUrl          commentCreatedUrl
interactionPollClosedUrl          interactionLikertClosedUrl
interactionFeedbackSubmittedUrl   leadSubmittedUrl
```

`normalizeWebhookUrl()` is the only validation at write time: it trims, rejects
anything over 2048 characters, requires `http:` or `https:`, and normalizes
through `new URL()`. Anything else becomes `''`. Note that it does **not** do
the SSRF check — that happens at delivery, per POST, because DNS can change
between the two.

Nothing about a delivery is stored: no attempt log, no last-status, no
signature secret.

### The request

```
POST <configured url>
content-type: application/json; charset=utf-8
user-agent: presentation-system-webhook/1
x-sb-event: <event name>
```

Timeout 4500 ms, `redirect: 'error'`. A non-2xx response is logged and dropped;
there is no retry.

### The three payload shapes

**Common** — `presentation.moved_to_organization`, `presentation.published`,
`comment.created`:

```json
{
  "event": "presentation.published",
  "createdAt": "2026-08-05T12:00:00.000Z",
  "actor":  { "id": "…@…", "email": "…@…", "name": "…", "role": "admin|user" },
  "presentation": {
    "id": "…", "title": "…", "description": "…", "theme": "…",
    "visibility": "private|organization",
    "published": { "id": "…", "slug": "…", "path": "/p/<id>-<slug>", "url": "https://…" }
  },
  "links": { "editPath": "/app/<id>", "editUrl": "…", "publicPath": "…", "publicUrl": "…" },
  "extra": { }
}
```

`published` and the public links are `null` when the deck is not published.
`extra` is present only when a fire site supplies it. `actor.id` is the email —
this payload predates stable user ids and has not been moved onto them (see
*Implementation status*).

**Slide library** — `slide.added_to_team_library`: same `event` / `createdAt` /
`actor`, then `slide` (`id`, `name`, `description`, `slideType`, `themeId`,
`previewUrl`, `url`) and `links` (`libraryPath`, `libraryUrl`, `slidePath`,
`slideUrl`).

**Interaction** — the three `interaction.*` events. Deliberately minimal, and
the only shape with **no actor**: these fire from the storage layer during a
live session, where the acting party is the audience.

```json
{
  "event": "interaction.poll_closed",
  "timestamp": "…",
  "session": { "id": "…" },
  "interaction": { "type": "…", "slideId": "…", "totals": [], "total": 0, "status": "…" }
}
```

**Lead** — `lead.submitted` has its own builder and its own shape: `event`,
`createdAt`, `presentation` (`id`, `title`, `editUrl`), `slide.id`, and `lead`
(`name`, `email`, `submittedAt`). It carries a visitor's name and email address,
which makes this the one webhook that ships personal data of a non-user off the
instance — see [`leads.md`](leads.md) for what the lead capture stores and how
it is retained and erased.

## Flows

### 1. Configure

Settings → *Admin: webhooks*. Seven text fields, one per event, saved with the
rest of app settings through `PUT /api/settings/app`.

Reading is gated too: `GET /api/settings/app` **deletes** the `webhooks` block
for a non-admin caller, so a plain user's client never sees the URLs. Writing
requires `isAdmin`.

### 2. Fire

Every entry point does the same four things, and stops at the first that fails:

1. Normalize the event name; return if empty or if there is no `repoRoot`.
2. `getAppSettings(repoRoot)` and pick the URL for this event. Empty → return.
   **This is the enable switch**: an unset URL means the event does not exist as
   far as the instance is concerned.
3. Build the payload. The common builder additionally reads the actor's
   `user_settings` profile to prefer their configured display name over the
   session name.
4. `void postJson(...)` — the promise is deliberately not awaited, and its
   `.then` only logs a failure.

### 3. Deliver

`postJson` is the only place a webhook URL is fetched:

1. `assertPublicHttpUrl(url)` — parse, require `http`/`https`, resolve the
   hostname, and reject if **any** resolved address is loopback, private,
   link-local (including the `169.254.169.254` metadata address), unique-local,
   CGNAT, multicast or reserved. A rejection returns
   `{ ok: false, error: 'Blocked non-public webhook URL' }` without a request
   leaving the process.
2. POST with the fixed headers, a 4.5 s `AbortController` timeout, and
   `redirect: 'error'` so a 30x cannot walk the request into private space.
3. Return `{ ok, status }`, or `{ ok: false, status: 0, error }`.

The guard's documented limit is DNS rebinding: the address is validated and the
fetch then re-resolves by hostname. Closing that needs connection pinning; the
guard blocks the straightforward internal-host case, which is the threat it is
for.

## Config & flags

There are **no environment variables**. A webhook is on when its URL is set in
app settings and off when it is not, which is the whole configuration surface.

Two consequences worth stating: the URLs are instance-wide (an instance serving
several organizations fires one webhook for all of them), and there is no
staging/production distinction beyond running separate instances.

## Authz & tenancy

- **Configuring** requires the instance `isAdmin` flag, on both read and write.
  Not the organization role — this is instance machinery (R3 in
  [`tenant-isolation.md`](tenant-isolation.md)).
- **Firing** carries no authorization of its own: the triggering request was
  already authorized by the route it happened in (publishing a deck, posting a
  comment, adding a slide to the team library), and the webhook is a side effect
  of that decision.
- **Payload exposure.** The receiver gets whatever the payload holds regardless
  of who may read the deck: title, description, theme, visibility, the actor's email
  and name, and for `lead.submitted` a visitor's name and email. Configuring a
  webhook is therefore an act of data export, and should be read that way.
- **Multi-organization**: nothing in the payload names an organization, so a
  receiver cannot tell which organization an event came from on an instance holding
  more than one.

## Implementation status

Normative target: **one delivery path, one guard, every event configurable in
the admin UI.** Where the code stands, as of 2026-08-05:

- **The transport and the guard are canonical.** Every one of the eight events
  goes through the same `postJson`, so the SSRF guard, the timeout and the
  redirect refusal cannot be bypassed by adding an event.
- **`lead.submitted` has no admin field.** The setting
  (`webhooks.leadSubmittedUrl`) exists, is normalized and is read at fire time,
  but `admin-webhooks-section.js` defines seven fields and this is not one of
  them — so the only way to enable it is to `PUT /api/settings/app` by hand. One
  event that is real in the backend and invisible in the UI is the same shape of
  gap as the email-template types in TODO B45. Recorded in the
  reference-doc-gaps brief.
- **Deliveries are unsigned.** There is no HMAC and no shared secret: a receiver
  cannot verify that a POST came from this instance, only that it arrived at a
  URL it chose. `x-sb-event` is a convenience header, not authentication. Any
  receiver should treat the endpoint as public and the payload as unverified.
- **No retry, no delivery record.** A failed POST is a warn line. Nothing
  records that an event happened, so a receiver that was down loses the event
  permanently and neither side can tell.
- **`actor.id` is an email**, with a code comment saying so. The rest of the
  codebase moved ownership and identity onto `users.id`
  ([`permission-model.md`](permission-model.md)); this payload did not, and it
  is an outward-facing contract, so changing it is a breaking change for
  receivers — the kind the beta window is for.
- **The user-agent still says `presentation-system-webhook/1`**, from before the
  product was named Deckyard. Harmless, but it is a public string.
