# Publishing

Making a deck readable on the open web: the publish flow, the public pages it mints, and the feed that lists them. Rewritten 2026-10-31 for editions (T1.5).

Publishing is one of three ways a deck leaves the logged-in app, and the only one that produces a durable, indexable public URL. The other two are **share links** (a long token, revocable, optionally password- or email-gated — [`permission-model.md`](permission-model.md)) and **follow codes** (a short code with a 24-hour TTL — [`live-sessions.md`](live-sessions.md)). They are not variants of each other: publishing is the one with no expiry, no token secrecy and search-engine metadata.

## Purpose & scope

Publishing seals the deck as an **edition**: an immutable copy with its own address, `/p/{publicationId}/{version}`. Editing the deck afterwards does not change it; publishing again makes the next edition, at the next version number, and the earlier ones stay public at their own addresses. How an edition is stored, sealed, served and verified is [`publication-editions.md`](publication-editions.md); this page is about the flow around it.

The publication id is the authorization on the public side. The canvas, reader, manifest, package, preview image, embed and feed take no session and resolve the edition by its address, on a deliberately organization-unscoped storage scope; that is one of the named `crossOrganizationScope` cases in [`tenant-isolation.md`](tenant-isolation.md).

## Module map

Publish / unpublish:

- `server/services/publish-edition.js` — the one service. `publishEdition()` for an acting user, `createEdition()` (the same steps without one, for the conversion), `prepareEdition()` (the gates and the sealing, no write), `unpublishPresentation()` and `getDeckPublication()`.
- `server/routes/api/publish.js` — the app's routes: publish and unpublish.
- `server/routes/public-api/v1/publishing.js` — the machine-client equivalents: publish, publish status, unpublish.
- `server/storage/editions.js` — series, editions, revocations, old links.

The public pages:

- `server/routes/static/edition.js` — `/p/{publicationId}/{version}` and its subresources, and `/embed/{publicationId}/{version}`.
- `server/routes/static/published.js` — the old `/p/{publishId}-{slug}`, its reader and `/embed/{publishId}-{slug}`: redirects to the first edition (§ Old links).
- `server/services/public-edition.js` — the read path: render, manifest, package, preview, and the title and description a feed lists.

The feed:

- `server/routes/feed.js` — `/feed/rss.xml`, `/feed/atom.xml`, `/feed/feed.json`.
- `server/utils/rss-feed.js` — `buildFeed()`, all three formats from one model via the `feed` package.
- `server/routes/static/app-shell.js` — `injectFeedDiscovery()`, the `<link rel="alternate">` autodiscovery tags.

Client surfaces:

- `client/views/editor/publish-export/publish.js` — the publish flow (`doPublish`), `isPublished()` and the links of the newest edition (`buildPublishedLinks`: page, embed and iframe snippet, per language version).
- `client/views/editor/modals/share-modal/publish-section.js` — the Share dialog's **Public** tab, the one place the links are shown (below).
- `client/views/editor/deck-settings/toggles.js` — the per-deck `excludeFromFeed` toggle.
- `client/views/settings/tabs/integrations-tab.js` — the organization's RSS settings and the feed URLs.

## Data model

The editions tables are described in [`publication-editions.md`](publication-editions.md) § Three records. What publishing adds:

- **Publication state is read, never stored on the deck.** A deck is published when its series has an edition that is not revoked; `pres.published` on the API is `{ publicationId, version, path, publishedAt }` of the newest one, or `null`, attached by `getDeckPublication()` where a response needs it (the deck GET, exports, webhooks). The `presentations.published` column is gone (migration 105): it was a copy that drifted from the index it mirrored.
- **`publication_legacy_links`** (migration 105) — `legacy_id` (an old eight-hex publish id) → `edition_id`. Written once by the conversion; never by a publish.
- **`published_presentations`** (migration 001) — the old index. Read only by the conversion; a later migration drops it once every installation has converted.
- **Per-deck**: `presentations.settings.excludeFromFeed` — published, but not listed in the feed.
- **Per-organization**: `organizations.settings.rss` (JSONB) — `enabled`, `title`, `description`, `language`, `copyright`, `authorName`, `customFeedUrl`, `maxItems`.

## Flows

### 1. Publish

`POST /api/presentations/:id/publish` with `{ expectedRevision, idempotencyKey }`:

1. **Sandbox refuses outright** (403), before the body is read. A guest owns a private deck and could otherwise push arbitrary content onto a public domain.
2. `expectedRevision` must be a revision and `idempotencyKey` 1-200 characters (400 `invalid`).
3. The deck is loaded for an actor with **write** access (`loadPresentationForActor`): owner, creator, a collaborator with `edit`/`admin`, or an organization member on an organization deck. A read-only actor gets 403; a deck of another organization 404.
4. The key is scoped to the actor (`actor:<userId>:<key>`), so two users who both send `1` publish two editions. A retry of the same request (same deck and revision) answers **200** with the edition its first attempt made; the same key for another request is 409 `idempotency_key_reused`.
5. A deck no longer at `expectedRevision` is 409 `conflict`: the author publishes what they saw, or nothing.
6. The publish gates (`incomplete_slides`, `missing_alt`, 422), the render bundle and the sealing (`renderer_edition_input_unsealable`, 422, with the dependency list) — `prepareEdition()`.
7. Stage and commit ([`publication-editions.md`](publication-editions.md) § The commit transaction); answer **201** `{ replayed: false, edition: { id, publicationId, version, path, manifestHash, publishedAt, … } }`.
8. A new edition, not a replay, fires the `presentation.published` webhook once, naming the edition ([`webhooks.md`](webhooks.md)). A retry sends nothing.

The editor sends one key per deck revision (`publishKeyFor` in `publish.js`), so a double click or a retry of the same revision gets the same edition back.

### 2. Unpublish

`DELETE /api/presentations/:id/publish` — write access, then every edition of the deck's series that is still public is revoked (`revokeDeckEditions`) and its cached views dropped. Each of them, and the old link that pointed at the first, then answers 410 with a content-free tombstone. The deck is not written; no webhook fires. Publishing again afterwards makes the next version, public again.

### 3. The public pages

An edition is served as described in [`publication-editions.md`](publication-editions.md) § Public read path: canvas, `/reader`, `/manifest.json`, `/edition.zip` and `/og`, all from the edition's own bytes, `Cache-Control: no-store`. The canvas refuses to be framed (`frame-ancestors 'none'`).

`GET /embed/{publicationId}/{version}` is the same canvas, frameable by any origin (`frame-ancestors *`; `security-headers.js` omits `X-Frame-Options` under `/embed/`). It takes `?lang=` and nothing else.

### 4. Old links

The publications from before editions are converted once by `scripts/migrate-publications-to-editions.js` (§ Converting old publications). After that, `/p/{publishId}-{slug}`, `/p/{publishId}-{slug}/reader` and `/embed/{publishId}-{slug}` answer **301** to the same subresource of the deck's first edition, with `?lang=` carried over. Never to a later edition: a link that was cited keeps showing what it showed on the day of the conversion. The slug is ignored; an old id that was never converted is 404.

### 5. The feed

`GET /feed/rss.xml` | `/feed/atom.xml` | `/feed/feed.json` — public, no auth, and gated four times before it serves anything:

1. `RSS_FEED_ENABLED` — the instance kill switch. Off → 404.
2. `MULTI_ORG_ENABLED` → **404**. The feed has no session to resolve an organization from, so it uses the default one, which stops being a defined answer once an instance holds several organizations (org-scoping decision 4 in `tenant-isolation.md`).
3. The organization must resolve. Missing → 404.
4. `organizations.settings.rss.enabled` — the real user-facing toggle. Off → 404.

Then `listLatestPublicEditions` lists the newest public edition of each series, newest first, up to `maxItems` (clamped 1–100, default 50), skipping a series whose deck has `excludeFromFeed`. A series whose deck was deleted is still listed: the edition outlives it (D361). Title and description come from each edition's own bytes (`editionSummary`), the link is the edition's canvas and the image its `/og`. The ETag names the listed editions, so `If-None-Match` gets a 304 until an edition is added or revoked; the response carries `Cache-Control: public, max-age=300`.

**Autodiscovery** is injected into the app shell by `injectFeedDiscovery()` under exactly the same conditions as the routes.

### 6. Publishing from the public API

`POST` / `GET` / `DELETE /api/v1/presentations/:id/publish` call the same service for an API key, authorized by scope (`write` / `read`) plus deck access. `POST` takes the same body and answers 201 or, for a retry, 200; `GET` answers `{ isPublished: false }` or `{ isPublished: true, publicationId, version, path, publishedAt }`; `DELETE` answers `{ unpublished: true, revoked }`. The shape from before editions (`publishId`, `slug`, `ogImageUrl`, a body-less `POST`) is gone (T1.5), as a documented beta break in `docs/openapi.yaml`.

## Converting old publications

`node scripts/migrate-publications-to-editions.js` (dry run) and `--apply`, run once per installation after the release with migration 105, with the server's env and after a database backup. The logic is `server/services/publication-migration.js`:

- **The old index is the truth.** Every `published_presentations` row was public at `/p/` until the release, whatever the deck's own copy said, so every row whose deck can be sealed is converted.
- **One first edition per deck**, made through `createEdition()` under the key `migration:<deckId>`, at the deck's current revision and with the conversion time as its publication time. Several old ids of one deck all link to it.
- **Blocked, never skipped**: a row whose deck is gone (`source_missing`), in the trash (`source_trashed`) or now in another organization (`organization_mismatch`), or that a publish gate or the sealing refuses (its own code and details), is reported and stays unconverted. Its old link is a 404 until the operator fixes the deck and runs `--apply` again.
- **Idempotent**: a second run reports `already_linked`; a run interrupted between the edition and its links finishes them.

The report is JSON on stdout (one line per old id: `outcome`, `reason`, `details`, `edition`) with a summary on stderr; the exit code is 2 while a row is blocked. Afterwards `node scripts/sweep-published-previews.js --check` and `--apply` remove the preview images the old publications left on a remote media origin.

## The Public tab: two links, not one

The Share dialog's tabs are named after who gets access (D174): **Team**, **Guests** and **Public** (anyone). Publishing lives on Public. Before the first publish it shows **Publish**; afterwards the newest edition's two links as equal rows (B342):

- **Link** — `/p/{publicationId}/{version}`, a page: findable, with a social preview, refuses to be framed.
- **Embed** — `/embed/{publicationId}/{version}`, the same edition, frameable. This is the URL for Notion or an `<iframe>`.

The iframe snippet folds out underneath. When the deck has more than one language version, one `<select>` above the rows sets `?lang=` in both URLs and the snippet. Below them, **Publish new version** makes the next edition (a refused publish shows its reason inline beside it), "Add to Notion page" embeds the newest edition, and **Unpublish** revokes every edition after a confirmation. The action row wraps whole buttons (`flex-wrap`, 44 px targets).

The Export dialog points here from its HTML row (the offline twin of the published page).

## Config & flags

| Variable / setting                       | Effect                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `RSS_FEED_ENABLED`                       | Instance kill switch for the feed. **Defaults to on**; set it false to remove the feature.        |
| `MULTI_ORG_ENABLED`                      | Disables the feed and its autodiscovery links entirely (404 / omitted).                           |
| `SANDBOX_MODE`                           | Publishing is refused with 403 on every surface.                                                  |
| `organizations.settings.rss.*`           | Per-organization: `enabled` (the real toggle), `title`, `description`, `language`, …, `maxItems`. |
| `presentations.settings.excludeFromFeed` | Per-deck: published, but not listed.                                                              |
| Render bundle                            | Publishing needs the installation's render bundle ([`renderer-bundle.md`](renderer-bundle.md)).   |

## Authz & tenancy

- **Publishing and unpublishing require deck _write_ access**, on both surfaces, through the same service. Publishing is not a separate capability, and there is no reviewer or approval step.
- **Reading an edition requires nothing at all.** A published URL handed to anyone works for anyone, until it is revoked.
- **The publication id is the authorization** for the public reads, which run on `crossOrganizationScope`. Writes are always scoped: a series is reached only through a deck of the caller's organization.
- **The feed is the exception**: it is a _listing_, so it states an organization, and having nothing but the default one to state is why multi-organization turns it off.
- **What an edition exposes**: the public projection the sealing allows ([`renderer-bundle.md`](renderer-bundle.md) § The edition input). No public surface names the owner from their email address.

## Implementation status

As of 2026-10-31 (T1.5):

- **One publish concept, one service, two surfaces with the same refusals.** Sandbox, authorization, gates, idempotency and webhook are in `publish-edition.js`; the routes only parse and answer.
- **Old links resolve to their first edition** after the conversion; there is no path that renders a deck's HEAD publicly any more.
- **Published pages are not tracked by the analytics cluster.** An edition's HTML is frozen and carries no tracking script; counting edition views is open work. The `published` source type stays for the history it holds.
- **The edition embed is the frozen plain canvas.** The unused live player and host-page SDK have been removed; player options and postMessage controls are not part of the edition embed contract.
- **`published_presentations` is still in the schema** until every installation has converted; a later migration drops it.
- **Unpublishing is silent.** No webhook, no activity event, no notification — while publishing fires a webhook.
