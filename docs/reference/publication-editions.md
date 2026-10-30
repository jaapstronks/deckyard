# Publication editions

How a deck becomes an immutable edition, and what the database promises about it. The bytes an edition stores are made by the edition-input preparer ([renderer-bundle.md § The edition input](renderer-bundle.md#the-edition-input)); this page is about keeping them.

**Status:** the store and the service exist; nothing calls them in production yet. The publish routes still write `published_presentations` ([publishing.md](publishing.md)), and no public route reads an edition. Both move over in later steps of this track.

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

A failure anywhere rolls back all of it, including a series created in the same transaction: no edition, no consumed number, the staging row kept. The same key used concurrently on two different decks is ordered by the unique index `(organization_id, idempotency_key)`; the loser is answered as a replay or a refusal, never a 500.

There is no write addressed by publication id. Organization B can only reach a series through a deck of B, so it cannot append to a series of A; every storage function takes a storage scope, and only the staging sweep may run cross-organization.

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

`tests/pg/publication-editions.pgtest.js` proves the guarantees above against real PostgreSQL: two concurrent publishes waiting on one lock and getting two numbers, sequential and concurrent identical retries, key reuse on the same and another deck, a failure injected before commit, edits/prune/deck deletion and a refused `UPDATE`, cross-organization writes, and asset bytes after the upload is gone.
