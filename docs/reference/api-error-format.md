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
- **`details`** — optional structured extra. `{ field: '<name>' }` is the
  standing case: a storage `invalid` says _which_ input was bad there rather
  than in the code, which is what D48 collapsed the `invalid_*` spellings into.
  Omitted when absent.

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

For a storage `reason` code, use **`storageError(res, result, message?)`** — it
reads `result.reason` for the code and the status, and puts an optional
`result.field` on the wire as `details.field`. Spreading the result by hand
(`jsonError(res, getErrorStatus(result.reason), result.reason)`) drops the field,
so `tests/storage-reason-vocabulary.test.js` refuses that form under
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
- **`err.details`** — structured detail, if any.

```js
try {
  await api('/api/share/abc/verify', { method: 'POST', body: { password } });
} catch (err) {
  if (err.code === 'invalid_password') showInlineError();
  else toast.error(err.message);
}
```

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
