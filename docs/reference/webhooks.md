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

- `server/utils/webhooks.js` (402 lines) — the whole implementation: the
  `postJson` transport with the SSRF guard and optional HMAC signing, three
  payload builders, and the three `maybeFire…` entry points.
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

plus one non-URL key, `signingSecret` (default `''`): the optional HMAC-SHA256
secret. It is instance-wide like the URLs — one secret signs every event — and
lives in the same admin-gated block, so a non-admin client never reads it.

`normalizeWebhookUrl()` is the only URL validation at write time: it trims,
rejects anything over 2048 characters, requires `http:` or `https:`, and
normalizes through `new URL()`. Anything else becomes `''`. Note that it does
**not** do the SSRF check — that happens at delivery, per POST, because DNS can
change between the two. `signingSecret` is trimmed and capped at 512 characters
(over-length → `''`), otherwise stored opaque.

Nothing about a delivery is stored: no attempt log, no last-status. The signing
secret is a *setting*, not a per-delivery record.

### The request

```
POST <configured url>
content-type: application/json; charset=utf-8
user-agent: Deckyard-Webhook/1
x-sb-event: <event name>
x-sb-signature: sha256=<hex>      (only when a signing secret is set)
```

Timeout 4500 ms, `redirect: 'error'`. A non-2xx response is logged and dropped;
there is no retry.

**Signature.** When `signingSecret` is set, every delivery carries
`x-sb-signature: sha256=<hex>`, where `<hex>` is the HMAC-SHA256 of the **exact
request body bytes** keyed by the secret. A receiver verifies by recomputing the
HMAC over the raw body it received and comparing (constant-time) against the
header. The header is absent entirely when no secret is configured — its absence
is not a failure, it is the unsigned mode. `x-sb-event` remains a routing
convenience, not authentication; the signature is the authentication.

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
`extra` is present only when a fire site supplies it. `actor.id` is the stable
`users.id` (B81); `actor.email` travels beside it as a display/contact value.
`actor.id` is `null` for the shapes that carry no user id — file mode, external
/ legacy rows, the auth-off operator — where the email is the only identifier
available.

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

Settings → *Admin: webhooks*. One text field per event plus one optional
signing-secret field, saved with the rest of app settings through
`PUT /api/settings/app`.

Reading is gated too: `GET /api/settings/app` **deletes** the `webhooks` block
for a non-admin caller, so a plain user's client never sees the URLs or the
signing secret. Writing requires `isAdmin`.

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
2. Serialize the payload once, then — if a `signingSecret` was passed — add the
   `x-sb-signature` header computed over those exact bytes. Signing over the
   serialized body (not the object) is what lets a receiver verify against the
   raw bytes it read off the wire.
3. POST with the headers, a 4.5 s `AbortController` timeout, and
   `redirect: 'error'` so a 30x cannot walk the request into private space.
4. Return `{ ok, status }`, or `{ ok: false, status: 0, error }`.

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
the admin UI.** Where the code stands, as of 2026-08-17 (B81):

- **The transport and the guard are canonical.** Every one of the eight events
  goes through the same `postJson`, so the SSRF guard, the timeout, the redirect
  refusal and the optional signature cannot be bypassed by adding an event.
- **Every event is configurable in the admin UI.** `admin-webhooks-section.js`
  defines one text field per event, `lead.submitted` included (B72) — no event is
  wired in the backend while invisible in the UI.
- **Deliveries can be signed (opt-in).** Set `webhooks.signingSecret` and every
  delivery carries `x-sb-signature: sha256=<hmac>` over the request body, so a
  receiver can verify the POST came from this instance. Left empty, deliveries
  are unsigned and `x-sb-event` is a convenience header, not authentication — a
  receiver with no secret configured should still treat the payload as
  unverified.
- **No retry, no delivery record.** *(Deliberately out of scope — B81 decision.)*
  A failed POST is a warn line. Nothing records that an event happened, so a
  receiver that was down loses the event permanently and neither side can tell.
  If retry/delivery-log is ever picked up, this note is its address.
- **`actor.id` is `users.id`** (B81). It was the email until B81 moved this last
  outward-facing contract onto the stable id the rest of the codebase keys on
  ([`permission-model.md`](permission-model.md)); the email now travels beside
  it as a contact value, and `actor.id` is `null` for the id-less shapes (file
  mode, external/legacy rows, the auth-off operator). This was a breaking change
  for receivers keying on `actor.id` — the kind the beta window is for.
- **The user-agent is `Deckyard-Webhook/1`** (B81), replacing the pre-rename
  `presentation-system-webhook/1`.
