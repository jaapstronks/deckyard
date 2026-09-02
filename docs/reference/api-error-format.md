# Internal API error format

The internal `/api/*` routes return errors in one canonical envelope:

```json
{
  "ok": false,
  "error": "<machine_code>",
  "message": "<human text>",
  "details": {}
}
```

- **`ok: false`** — mirrors the `{ ok: true, … }` shape success responses use, so a
  client can discriminate on `ok` as well as on the HTTP status.
- **`error`** — a stable, snake_case **machine code**. This is the field clients
  branch on (never string-match the human text). Codes are lowercase
  (`rate_limited`, `not_found`, `invalid_password`, `forbidden`, …). One code
  per meaning: the 403 code is `forbidden` (`permission_denied` was folded into
  it, A7.19-C7g).
- **`message`** — optional human-readable text for display. Safe to show a user;
  never contains stack traces or internal detail (500s stay generic).
- **`details`** — optional structured extra, omitted when absent. Its keys are
  a closed set:

  | Key         | Meaning                                                                                                                                                         |
  | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `field`     | _Which_ input was bad. The standing case: a storage `invalid` says it here rather than in the code, which is what D48 collapsed the `invalid_*` spellings into. |
  | `index`     | Where in a list-valued `field` (0-based). Present only when the storage layer inspected the list entry by entry.                                                |
  | `itemIndex` | Where inside that entry, for a nested list (an `items` field's `itemFields`).                                                                                   |
  | `reason`    | A snake_case sub-code for the problem at that location, for a client that wants to translate. `message` still carries the English sentence.                     |

  `details` locates; it does not explain. Prose stays in `message`, and a
  client that has no copy for a `reason` shows `message`. Anything a storage
  result carries beyond these keys (a `where` label used to build the
  sentence) stays server-side. Client side, the location drives the inline
  refusal — see [`feedback-surfaces.md`](feedback-surfaces.md) § The envelope,
  mirrored.

  _Implementation status (2026-09-02):_ every storage refusal goes through
  `storageError()` and meets the table. Six internal routes still put
  something else in `details`, and B208 folds them: a payload that is not a
  location (`{ report }` on the three import routes, `{ lock }` on
  `slide-locks.js`, the maintenance `state` on the 503), and prose where a
  sentence belongs in `message` (the Notion routes' `'Set NOTION_SECRET …'`
  string, and `versions.js`'s `{ reason: 'No LLM vendor configured' }`, which
  collides with the sub-code key above). Until then a client may only rely
  on the four keys for `storage`-originated errors.

This unified one envelope that used to have two shapes living side by side: prose
in `error` (from the `http.js` helpers) versus `{ ok:false, error:'code' }` (from
routes that echoed a storage `reason`).

## Producing it (server)

Always go through the shared surface — do not hand-roll `serveJson(res, status, { error })`:

| Helper (`server/utils/http.js`)     | Status | Code                                |
| ----------------------------------- | ------ | ----------------------------------- |
| `badRequest(res, msg)`              | 400    | `bad_request`                       |
| `unauthorized(res, msg)`            | 401    | `unauthorized`                      |
| `forbidden(res, msg)`               | 403    | `forbidden`                         |
| `notFound(res, msg)`                | 404    | `not_found`                         |
| `payloadTooLarge(res, msg)`         | 413    | `payload_too_large`                 |
| `rateLimited(res, retryAfter, msg)` | 429    | `rate_limited` (sets `Retry-After`) |
| `serverError(res, msg)`             | 500    | `internal_error`                    |
| `methodNotAllowed(res, allowed)`    | 405    | `method_not_allowed` (sets `Allow`) |

### 401 versus 403: who you are, versus what you may do

One rule, no exceptions (D68):

- **401 `unauthorized`** — there is no valid identity. No session cookie, an
  expired or unparseable one, a session that resolves to no user, a missing or
  invalid API key, wrong credentials on a login. The fix is to authenticate.
- **403 `forbidden`** — the identity is fine, the permission is not. Every
  `canRead…` / `canWrite…` / `canManage…` / `isAdmin` / `isOrganizationAdmin`
  refusal, every role and collaborator-ladder refusal, and a feature that is
  switched off for this instance. Authenticating again changes nothing.

Concretely: an authorization guard that asks _"may this caller do X?"_ answers
`forbidden(res)`, never `unauthorized(res)`. The single login gate in
`server/routes/api/index.js` answers 401 for anyone with no identity, so every
guard below it is judging a caller who is already identified. Only the routes
mounted _above_ that gate (login, password reset, magic link, SSO, and the
public audience endpoints) produce a 401 of their own.

The same split holds on the other two surfaces. The public `/api/v1` layer
sends 401 only for a missing/invalid API key and 403 for a key that lacks the
permission or the deck. MCP over SSE sends HTTP 401 only when the bearer key
does not validate and 403 when a session belongs to a different key owner;
per-deck refusals there are JSON-RPC tool errors, not HTTP statuses.

For a storage `reason` code, use **`storageError(res, result, message?)`** — it
reads `result.reason` for the code and the status, puts an optional
`result.field` on the wire as `details.field`, and, when the result carries a
located `fieldProblem` (`{ reason, index, itemIndex }`), adds those three as
`details.index` / `details.itemIndex` / `details.reason` (null indexes are
omitted; `tests/storage-error-details.test.js`). Spreading the result by hand
(`jsonError(res, getErrorStatus(result.reason), result.reason)`) drops all of
that, so `tests/storage-reason-vocabulary.test.js` refuses that form under
`server/routes/**`.
`getErrorStatus` reads the closed `REASONS` register in
[`server/storage/reasons.js`](../../server/storage/reasons.js), which states one
status and one `kind` (`'caller'` 4xx / `'ours'` 5xx) per code. It takes **no**
second argument: an unknown reason is a hole in our vocabulary, not a malformed
request, so it throws outside production and answers 500 in production —
`getErrorStatus(reason, 500)` is the retired form, and the same test refuses it
(B104).
Thrown `AppError`s serialize via `toJSON()` into the same envelope (the code
defaults from the HTTP status, see `codeForStatus`); the top-level handler and
`withErrorHandler` emit it too.

## Consuming it (client)

`api()` (`client/lib/api.js`) is the single choke point. On a non-2xx JSON body it
throws an `Error` with:

- **`err.code`** — the machine code (`obj.error`). Branch on this.
- **`err.message`** — human text (`obj.message`, falling back to `error`/`details`).
  Safe to surface in a toast.
- **`err.statusCode`** — the HTTP status.
- **`err.details`** — structured detail, if any (`field`, `index`,
  `itemIndex`, `reason` — see above).

```js
try {
  await api('/api/share/abc/verify', { method: 'POST', body: { password } });
} catch (err) {
  if (err.code === 'invalid_password')
    passwordError.show(err.message, { control });
  else toast.error(err);
}
```

Which carrier an error belongs in — inline beside the control, a toast, a
persistent chip — is not a per-call-site choice: the kind of event decides.
The rules, the inline helper (`createInlineError()`), and the focus/ARIA
contract are in [`feedback-surfaces.md`](feedback-surfaces.md).

## SSE error events

Streaming routes (`text/event-stream`) do **not** use this envelope. An error on
an already-open stream is a named event, so its payload is:

```json
{ "message": "<human text>" }
```

- **No `ok`** — the `event: error` line is the discriminator. Repeating it in the
  payload duplicates the routing the client already dispatches on
  (`client/lib/net/sse.js`).
- **No `error` key** — on the HTTP side `error` means "machine code", and no SSE
  consumer branches on a cause today. Putting prose there is the exact habit the
  envelope work removed. `message` is also already what `status` events use for
  human text, so the two event kinds now read the same.
- **Endpoint-specific extras** ride alongside (`report` on the convert and Notion
  import streams).

If a client ever does need to branch on the cause, add
`error: '<snake_case_code>'` next to `message`, with the same meaning it has
here. That upgrade is additive; it never renames a field a client reads.

## Scope

- The public **`/api/v1/*`** surface keeps its own openapi-documented error schema
  (`{ error, message?, details? }`, see `docs/openapi.yaml`) and is **not** part of
  this envelope. It carries the _same_ snake_case machine-code vocabulary in
  `error`, minus this envelope's `ok:false` discriminator (the HTTP status is the
  public surface's discriminator). Produced through `sendV1Error`/`apiError` and
  the `withV1ErrorHandler` wrap in
  `server/routes/public-api/v1/middleware.js` — B61 converged the three shapes it
  used to speak into this one. Don't change it here.
- Enforced/covered by `tests/api-error-envelope.test.js`.
- A handful of ad-hoc `serveJson(res, status, { error: err.message })` sites (AI,
  media, uploads, notion) still put prose in `error`; the client tolerates both,
  and migrating them (plus rolling out `withErrorHandler`) is the mechanical
  follow-up tracked in `TODO.md`.
