# Publication editions

How a deck becomes an immutable edition, and what the database promises about it. The bytes an edition stores are made by the edition-input preparer ([renderer-bundle.md § The edition input](renderer-bundle.md#the-edition-input)); this page is about keeping them.

**Status:** the store, the service and the public read path exist. The publish routes still write `published_presentations` ([publishing.md](publishing.md)) and the old `/p/:id-:slug` links still read the deck; both move over to editions in a later step of this track, together with the authoring surface for revocation.

## Three records

| Table                    | Holds                                                                                                                  | Lifecycle                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `publications`           | The series: a random public UUID, the managing organization, an optional `presentation_id`, the `last_version` counter | One per deck per organization. Deleting the deck sets `presentation_id` to null, nothing else. |
| `publication_editions`   | `(publication_id, version)`, `source_revision`, `renderer_hash`, `manifest_hash`, the manifest and input bytes         | Append-only. A trigger refuses every `UPDATE`; the version is never reused.                    |
| `publication_deliveries` | `(edition_id, destination)`, `status`, `receipt`                                                                       | Only `local` exists. A later destination adds a row for the same edition, never a new edition. |

Beside them:

- `publication_edition_assets` lists the closed asset set of an edition, copied from its manifest (`sha256`, `media_type`, `bytes`). The asset bytes themselves are inline in the input, so an edition keeps them for as long as it exists: deleting or replacing the upload, pruning restore versions or deleting the deck does not reach them.
- `publication_edition_audit` records who published (`actor_user_id`, internal). It is a separate table because a user can be deleted and an edition row cannot be updated; the actor never enters the manifest.
- `publication_staging` holds prepared bytes until their commit. It is never served.
- `publication_edition_revocations` marks an edition as revoked (§ Revocation).

Restore versions (`presentation_versions`) are unrelated: an edition is never derived from one and is not subject to their retention.

## One publish

`publishEdition()` in `server/services/publish-edition.js` takes a scope, an identity and `{presentationId, expectedRevision, idempotencyKey}`:

1. Sandbox refusal, then input validation.
2. Load the deck for an actor with `write` access (`loadPresentationForActor`).
3. **Idempotency first.** If the organization already has an edition under this key, the same request (same deck, revision and destination, compared by `editionRequestHash()`) gets that edition back with `replayed: true`, even when the deck has moved on since. Any other request under the key is refused with `idempotency_key_reused` (409).
4. A deck that is no longer at `expectedRevision` is refused with `conflict` (409) before anything is prepared.
5. The existing publish gates (`assertSlidesComplete`, `assertImagesNamed`), then the installation's render bundle (`openCurrentRendererBundle`): without one there is nothing to publish with.
6. `prepareEditionInput()` seals one snapshot of the deck; `stageEditionInput()` verifies the bytes against their manifest and stores them in staging.
7. `commitEdition()` makes the edition in one transaction.

## The commit transaction

`commitEdition()` in `server/storage/editions.js`:

1. Creates the deck's series on first publish (`INSERT … SELECT` from a deck **in the scope's organization**, `ON CONFLICT DO NOTHING`) and row-locks it (`FOR UPDATE`). Concurrent publishes of one deck queue on this lock.
2. Looks the idempotency key up again under the lock: the check that counts. A replay drops its staging row.
3. Takes `last_version + 1`, copies the staged bytes into the edition inside the database (`INSERT … SELECT`, so the lock is held only for that copy), inserts the asset references, the audit row and the `local` delivery (`delivered`, receipt `{editionId, manifestHash}`), and deletes the staging row.

A failure anywhere rolls back all of it, including a series created in the same transaction: no edition, no consumed number, the staging row kept. The same key used concurrently on two different decks is ordered by the unique index `(organization_id, idempotency_key)`; the loser is answered as a replay or a refusal, never a 500, and its staging row is deleted on the spot.

There is no write addressed by publication id. Organization B can only reach a series through a deck of B, so it cannot append to a series of A; every storage function takes a storage scope, and only the staging sweep may run cross-organization.

## Public read path

An edition is public at `/p/{publicationId}/{version}`, served by `server/routes/static/edition.js` through `server/services/public-edition.js`. The version is part of the address: no route resolves "the latest" edition, and none reaches the deck.

| Path                 | Serves                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `…/{version}`        | The canvas, rendered from the stored input in the edition's own renderer bundle. `?lang=` picks a version.    |
| `…/{version}/reader` | The reader, from the same render.                                                                             |
| `…/manifest.json`    | The stored manifest bytes, unchanged.                                                                         |
| `…/edition.zip`      | The verification package (§ Verification package).                                                            |
| `…/og`               | The first image the edition shows, from its own bytes; a redirect to the installation's default card if none. |

What each view reads, and what it never reads:

- **Bytes and record only.** The canvas and reader are one call of `renderEditionInBundle(rendererHash, input)`: the stored input, plus two request values that are not stored. `canonicalUrl` is built from the edition record (`origin/p/{publicationId}/{version}`, with the origin from `APP_URL`/`DOMAIN` when set and the request's only otherwise, so a forged `Host` header changes neither the address nor the cache entry), never taken from the input, which leaves it empty because the number exists only once the edition is committed. `lang` is the version on screen, accepted only when the edition has that version (any other `?lang=` falls back to the edition's own language, so a crafted query cannot make the runner render views that do not exist). The deck, the theme store, the installation default, the slide-type registry and the upload store are not consulted.
- **The chrome is frozen too.** Canonical and alternate links, the Open Graph and Twitter card, the JSON-LD block, the language switch and the reader link are written by the render entry (`server/render/renderer-bundle/bundle/edition-chrome.js`) from the edition's title, description and address, with labels from the frozen slide copy. Prism and KaTeX are carried inline from the bundle rather than linked from the installation's `/client/vendor/`. The serving installation adds HTTP headers and nothing else; the one remaining reference to it is the icon SVGs the renderer itself emits ([renderer-bundle.md § Limits](renderer-bundle.md#limits)).
- **No fallback.** An unknown `(publicationId, version)` is a 404, also when the id happens to be a deck's. A render the runner refuses or cannot do is an error (503 when unavailable, 500 otherwise), never the current renderer.

Rendered HTML is a disposable derivative: an in-memory cache (64 views, 64 MiB) keyed by edition, language and canvas address, rebuilt from the same bytes when it is gone. The per-edition facts read from the input (languages, preview image) have their own cache, bounded the same way (256 editions, 64 MiB of image bytes). `/og` serves an image only under a plain `image/…` media type; anything else gets the installation's card. Every response carries `Cache-Control: no-store`, so nothing in front of the server keeps a copy that revocation could not reach.

## Revocation

`revokeEdition(scope, publicationId, version)` records a revocation in `publication_edition_revocations` (migration 104): one row per edition, in the edition's organization, with the internal actor. An edition row itself cannot be updated, so revocation is not a column on it. Revoking twice keeps the first revocation; organization B cannot revoke an edition of A.

From then on every subresource of that edition answers 410 with a content-free tombstone (no title, no author, `noindex`, `no-store`). The check runs on every request before any cache is consulted and drops what is cached; `getPublicEdition()` does not even return the bytes of a revoked edition, so a caller that forgets to check cannot serve them. A render that was in flight when the revocation landed is not cached. Other editions of the series are served as before. Wiping the bytes of a revoked edition is a separate, later operation; who may revoke is decided by the authoring service that will call this.

## Verification package

`/edition.zip` is built by `server/export/edition-package.js` from the stored bytes, the same bytes on every download:

- `edition.json` - the edition record in canonical JSON (`deckyard.edition-record/1`): series, version, publication time, renderer hash, manifest hash and `previousManifestHash`, the manifest hash of version − 1 (null for version 1).
- `manifest.json` - the stored manifest, byte for byte.
- `input.json` - the stored input, byte for byte, except that every font face in `css.fontCss` is replaced by `deckyard-withheld:<media type>;sha256,<hex>`, the media type verbatim so the rebuild is exact. Fonts are licensed bytes; a package anyone can download names them by hash, while the edition keeps them. Images stay: every reader of the edition already receives them.

`node scripts/verify-edition.js <package.zip>… [--font <file>]…` checks packages offline, with no database, network or installation, and reports three things apart:

1. **Bytes**, per package: valid, or each problem by name (`manifest_hash_mismatch`, `content_hash_mismatch`, `theme_hash_mismatch`, `asset_mismatch`, `input_hash_mismatch`, …). Without the fonts it checks the manifest, the deck and theme hashes and the asset inventory, and lists the withheld fonts by hash. With the font files the stored input is rebuilt exactly and checked as a whole, input hash included.
2. **Withheld fonts**: each by media type, hash and length.
3. **Chain**: between the packages given, a version whose predecessor was not supplied is a missing link (incomplete evidence, exit 2); a predecessor whose manifest hash differs, a version 1 that names one, or packages of two publications are a mismatch (exit 1).

A matching hash proves equality with the bytes received. It does not prove who published them or when, and a chain without a trusted root shows only that the packages given agree with each other.

## Abandoned staging

A staging row whose commit never came (a crash, a refused commit, a client that went away) is removed by the daily retention job once it is older than `EDITION_STAGING_TTL_MS` (24 hours), through `deleteAbandonedEditionStaging()`. Editions are never swept.

## Errors

| Code                      | Status | When                                                                                                        |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `invalid`                 | 400    | `expectedRevision` is not a revision, or `idempotencyKey` is empty or over 200 characters (`details.field`) |
| `conflict`                | 409    | The deck is no longer at `expectedRevision`                                                                 |
| `idempotency_key_reused`  | 409    | The key already named a different request                                                                   |
| `edition_staging_missing` | 409    | The staging row is gone (swept); prepare again                                                              |
| `edition_input_invalid`   | 422    | The prepared bytes do not verify against their manifest                                                     |

Refusals of the preparer (`renderer_edition_input_unsealable`) and of the bundle store pass through unchanged.

## Tests

`tests/pg/publication-edition-reads.pgtest.js` proves the read path against real PostgreSQL and two real render bundles: an old edition's canvas, reader (both languages), manifest, package and preview image stay byte-identical after the deck, the theme record, the installation default, the slide-type code and the upload change or disappear, and the next edition shows every change; the address comes from the record; unknown editions are 404 without falling back to the deck; revocation answers 410 on every subresource, cached or not; a failed render is an error; and the packages verify, with corruption and gaps reported apart. `tests/edition-package.test.js` and `tests/renderer-bundle-edition-views.test.js` pin the package and the entry's views without a database.

`tests/pg/publication-editions.pgtest.js` proves the write guarantees above against real PostgreSQL: two concurrent publishes waiting on one lock and getting two numbers, sequential and concurrent identical retries, key reuse on the same and another deck, a failure injected before commit, edits/prune/deck deletion and a refused `UPDATE`, cross-organization writes, and asset bytes after the upload is gone.
