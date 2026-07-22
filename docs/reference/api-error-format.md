# Internal API error format

The internal `/api/*` routes return errors in one canonical envelope:

```json
{ "ok": false, "error": "<machine_code>", "message": "<human text>", "details": { } }
```

- **`ok: false`** — mirrors the `{ ok: true, … }` shape success responses use, so a
  client can discriminate on `ok` as well as on the HTTP status.
- **`error`** — a stable, snake_case **machine code**. This is the field clients
  branch on (never string-match the human text). Codes are lowercase
  (`rate_limited`, `not_found`, `invalid_password`, `permission_denied`, …).
- **`message`** — optional human-readable text for display. Safe to show a user;
  never contains stack traces or internal detail (500s stay generic).
- **`details`** — optional structured extra (e.g. `{ field: 'email' }`). Omitted
  when absent.

This unified one envelope that used to have two shapes living side by side: prose
in `error` (from the `http.js` helpers) versus `{ ok:false, error:'code' }` (from
routes that echoed a storage `reason`).

## Producing it (server)

Always go through the shared surface — do not hand-roll `serveJson(res, status, { error })`:

| Helper (`server/utils/http.js`) | Status | Code |
| --- | --- | --- |
| `badRequest(res, msg)` | 400 | `bad_request` |
| `unauthorized(res, msg)` | 401 | `unauthorized` |
| `forbidden(res, msg)` | 403 | `forbidden` |
| `notFound(res, msg)` | 404 | `not_found` |
| `payloadTooLarge(res, msg)` | 413 | `payload_too_large` |
| `rateLimited(res, retryAfter, msg)` | 429 | `rate_limited` (sets `Retry-After`) |
| `serverError(res, msg)` | 500 | `internal_error` |
| `methodNotAllowed(res, allowed)` | 405 | `method_not_allowed` (sets `Allow`) |

For a storage `reason` code, use `jsonError(res, getErrorStatus(reason), reason, message?)`.
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

## Scope

- The public **`/api/v1/*`** surface keeps its own openapi-documented error schema
  (`{ error, message?, details? }`, see `docs/openapi.yaml`) and is **not** part of
  this envelope. Don't change it here.
- Enforced/covered by `tests/api-error-envelope.test.js`.
- A handful of ad-hoc `serveJson(res, status, { error: err.message })` sites (AI,
  media, uploads, notion) still put prose in `error`; the client tolerates both,
  and migrating them (plus rolling out `withErrorHandler`) is the mechanical
  follow-up tracked in `TODO.md`.
