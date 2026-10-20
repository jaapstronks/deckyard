# Server service layer

`server/services/` holds domain operations shared by the internal API, the public v1 API and MCP. A deck operation should have one authorization, validation and side-effect path regardless of which adapter calls it. This is a server module interface, not a separate HTTP API; the public HTTP contract is documented in [OpenAPI](../openapi.yaml).

## Boundaries

| Layer                                                               | Owns                                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `server/routes/api/`, `server/routes/public-api/v1/`, `server/mcp/` | Authentication and contract-specific admission checks, input parsing, service calls and response formatting |
| `server/services/`                                                  | Shared domain decisions, deck access checks, validation, mutations and their activity/notification effects  |
| `server/storage/`                                                   | Scoped persistence through Kysely and file storage                                                          |
| `server/export/`                                                    | Format builders and export pipeline helpers                                                                 |
| `server/render/`                                                    | Browser-backed rendering and screenshot support                                                             |
| `server/utils/`                                                     | Shared helpers, including HTTP responses, typed errors and authorization deciders used by services          |

Import a service from its domain module; there is no layer-wide barrel. Services compose storage functions and shared helpers rather than importing another adapter's handlers. An adapter remains responsible for its transport rules, such as API-key scopes, rate limits, headers and serialization. See [storage-layer.md](storage-layer.md), [permission-model.md](permission-model.md) and [api-error-format.md](api-error-format.md) for the adjacent contracts.

## Scope, identity and access

The common call shape is `(scope, identity, input)`. The storage scope selects the organization and repository context; it is not an authorization grant. See [storage-scope.md](storage-scope.md). `server/services/actor.js` defines the identity types:

- Internal routes pass their authenticated session user as `{ actor: authedUser }`.
- Public v1 routes pass the API-key owner as `{ actor: ctx.authedUser }`, in the key's organization.
- MCP uses `actorOf(context)` from `server/mcp/presentation-access.js` to construct its actor.
- Services that admit verified share-link guests accept `{ guest, shareLink }` instead of `{ actor }`. A guest is not a user actor; the internal share-link routes resolve that identity.

`loadPresentationForActor()` in `server/services/presentations.js` loads a deck within the supplied scope and checks the requested access. Read is the baseline for actor access; write, delete, manage, transfer, comment and moderate request their corresponding rights. An absent or out-of-scope deck throws `NotFoundError`; a deck present in scope without the required right throws `ForbiddenError`. The authorization deciders live in `server/utils/presentation-authz/index.js`.

For example, an adapter that has already authenticated its caller can load a deck for writing:

```javascript
import { loadPresentationForActor } from './server/services/presentations.js';

const pres = await loadPresentationForActor(
  storageScope,
  { actor: authedUser },
  presentationId,
  { access: 'write' },
);
```

The import above is relative to the repository root. `server/utils/route-middleware.js` adapts this loader for internal HTTP routes; `server/mcp/presentation-access.js` adapts it for MCP. Call a mutation service for a write rather than treating this loader as a replacement for that operation's validation and effects.

## Where operations live

| Module                                                                      | Responsibility                                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `server/services/presentations.js`                                          | Load and authorize decks; list, create, duplicate, trash and restore them                 |
| `server/services/save-presentation.js`                                      | Validate and save deck changes, including revision-aware updates                          |
| `server/services/slides.js`                                                 | Add, update, remove, reorder and replace slides through the shared save path              |
| `server/services/comments.js`                                               | Comment creation, editing, removal, status changes and lists for supported identities     |
| `server/services/ownership.js`, `server/services/visibility.js`             | Ownership transfer and visibility changes                                                 |
| `server/services/theme.js`, `server/services/translate.js`                  | Theme changes and translation operations                                                  |
| `server/services/deck-versions.js`, `server/services/permanent-delete.js`   | Version operations and permanent removal                                                  |
| `server/services/import-json.js`, `server/services/publish-presentation.js` | Deck import and publishing workflows                                                      |
| `server/services/exports.js`                                                | Authorized export context, language projection, theme/type resolution and export counting |

Event and notification modules also live in this layer, such as `server/services/activity-events.js`, `server/services/comment-events.js` and `server/services/comment-notifications.js`. Their responsibilities are described in [comments-and-notifications.md](comments-and-notifications.md).

## Results, errors and existing call shapes

Services return domain values and use typed errors from `server/utils/errors.js` for refusals. Each adapter translates those errors into its own envelope; an internal HTTP error body is not the v1 or MCP response contract.

The common signature is not universal. `loadPresentationForActor()` takes a deck id and access options after the identity. `importJsonDeck()` takes an options object and returns `{ ok: false, message }` for a language refusal. `publishPresentation()` takes an options object containing an already-authorized presentation and request context; its callers establish access before invoking it. Follow each function's signature and preconditions rather than assuming that every exported helper performs authorization or returns the same result shape.

Export preparation has explicit entry points in `server/services/exports.js`:

- `prepareExportContext()` authorizes a requested deck export and counts it before the format builder runs.
- `prepareQueuedExportContext()` rechecks the queued actor's current deck rights, bounded by the enqueue audience, without counting the export again. Missing access context refuses the job.
- `authorizeExportResult()` checks the finished artifact against the downloader and current deck rights; a built author artifact cannot be served after demotion.
- `buildExportContext()` describes an already-authorized deck, including MCP download-link preparation; it neither authorizes nor counts a request.
- `prepareThemeTemplate()` resolves a scoped theme and builds its template without requiring a presentation.

## Enforcement

`tests/service-layer-imports.test.js` scans MCP and public v1 imports. It forbids imports into internal API routes and pins imports into presentation storage at zero. This is a specific adapter boundary check, not a blanket ban on all storage imports across all routes. Service behavior is covered by the domain tests, including the service-layer tests under `tests/`.

`tests/docs-paths-resolvable.test.js` checks documented paths and requires this page to be linked from the [documentation index](../README.md).
