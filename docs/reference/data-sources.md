# Live data sources

A slide can carry a `dataSource` object that describes where its content comes
from (a Notion database, a Notion page, or a CSV URL) and how fetched values
map onto its content fields. Refreshing re-fetches and rewrites the bound
fields. Written 2026-08-16 against HEAD.

This is one of two server-side fetch surfaces where the *target* is
user-controlled (the other is outgoing [webhooks](webhooks.md)), which makes
the csv-url provider a read-SSRF sink and the SSRF guard part of the contract,
not an implementation detail.

## Purpose & scope

Bind individual slide fields — a KPI number, a table cell, a quote — to an
external source, so a recurring deck ("weekly metrics") updates by refresh
instead of by hand. The server fetches and maps; **it stores nothing**: the
refreshed content comes back to the client, which saves it through the normal
slide-write path. There is no scheduler, no server-side cache, and no
per-source credential store.

## Module map

- `server/routes/api/data-sources.js` (123 lines) — the three endpoints, the
  auth/feature gates, and the error envelope.
- `server/utils/data-source/index.js` (68) — provider dispatch:
  `refreshSlideData()` (validate → frozen short-circuit → provider refresh) and
  `fetchProviderData()` (raw fetch for the mapping UI).
- `server/utils/data-source/provider-base.js` (65) — the provider factory:
  wraps fetch-stage failures in a typed `AppError` (upstream status preserved,
  otherwise 502) and composes fetch → parse → `applyBindings`.
- `server/utils/data-source/bindings.js` (107) — the binding engine: dot-paths
  with array indices (`metrics[0].value`), deep-clones the content, creates
  intermediate objects/arrays, reports per-binding errors.
- `server/utils/data-source/providers/csv-url.js` (174) — CSV fetch (the SSRF
  sink), CSV parser, `A1` / `row[N].colName` source mapping.
- `server/utils/data-source/providers/notion.js` (214) — `notion-database`
  (database query → rows keyed by property name) and `notion-block` (page/block
  text lines), on top of `server/utils/notion/client.js`.
- `shared/data-source.js` — `validateDataSource()`, the provider and
  refresh-mode enums, and `BINDABLE_SLIDE_TYPES` (which slide types expose
  which bindable fields).
- `client/views/editor/data-source-modal.js` / `data-source-panel.js` — the
  editor UI: pick a provider, preview fields, define bindings, refresh.

## Data model

The `dataSource` object lives on the slide (validated by
`validateDataSource()`):

```json
{
  "provider": "notion-database | notion-block | csv-url",
  "config":   { "…provider-specific…" },
  "bindings": [ { "target": "metrics[0].value", "source": "row[0].Revenue" } ],
  "refresh":  { "mode": "frozen | manual | on-view" },
  "lastSync": "2026-08-16T12:00:00.000Z"
}
```

- **`target`** is a dot-path into slide content, with array indices:
  `title`, `metrics[0].value`, `rows[2].c3`. Missing intermediate
  objects/arrays are created.
- **`source`** is provider-specific:
  - csv-url: an Excel-style cell ref (`B2`, 1-indexed rows) or
    `row[N].colName` (first CSV row is the header, `N` is 0-indexed into the
    data rows);
  - notion-database: `row[N].PropertyName` (property values are flattened to
    strings — numbers, selects, dates, formulas, rollups all arrive as text);
  - notion-block: `block[N]`, `block[N].text` or `block[N].type` (only blocks
    with text survive; empty blocks are skipped when counting).
- **`refresh.mode`**: `frozen` returns the current content untouched without
  fetching; `manual` fetches when the user asks; `on-view` is the declared
  "live" mode (see *Implementation status*).
- A binding whose source resolves to nothing produces an entry in the
  response's `errors` array; the other bindings still apply.

## Endpoints

All of them sit behind login **and** the `LIVE_DATA_ENABLED` feature flag
(unauthenticated → 401, flag off → 403).

| Method | Path | Does |
|---|---|---|
| GET | `/api/data-sources/providers` | List provider ids and `BINDABLE_SLIDE_TYPES` (for the mapping UI). |
| POST | `/api/data-sources/preview` | `{provider, config}` → `{data}`: the raw fetched data (CSV grid, Notion rows/blocks), no bindings applied. |
| POST | `/api/data-sources/refresh` | `{dataSource, content}` → `{content, applied, errors, lastSync}`. Optionally `{presentationId, slideId}` to broadcast an SSE event. |

Provider/validation failures are 400; an unconfigured Notion is 501; upstream
fetch failures surface as `data_source_error` with the upstream status, or 502
when untyped. `/providers` is GET-only but *falls through* on other methods
(no 405) — `/preview` and `/refresh` answer an explicit 405.

## The SSRF guard (csv-url)

The `config.url` of a csv-url source is user-controlled and the fetched body
is returned to the caller — the definition of a read-SSRF sink. `fetchCsvData`
therefore:

1. passes the URL through `assertPublicHttpUrl()`
   (`server/utils/ssrf-guard.js`): http/https only, and every resolved address
   must be public — loopback, RFC1918, link-local (including the
   `169.254.169.254` cloud-metadata address), CGNAT, unique-local, multicast
   and reserved ranges are refused before any request leaves the process;
2. fetches with `redirect: 'error'`, so a public URL cannot 30x-bounce into
   private space;
3. strips credential-bearing custom headers: `config.headers` are forwarded
   (for authenticated CSV endpoints) except `host`, `authorization`, `cookie`,
   `set-cookie` and `proxy-authorization`.

The Notion providers are not SSRF sinks: they only ever talk to
`api.notion.com` with the instance's `NOTION_SECRET`.

The refusal is enforced at the binding seam — a refresh with a private URL
rejects before any fetch — and pinned by
`tests/data-sources-behavior.test.js`.

## Config & flags

- `LIVE_DATA_ENABLED` — the feature flag; off by default.
- `NOTION_SECRET` — one integration token for the whole instance
  (`server/utils/notion/client.js`); unset means every Notion call answers
  501.

## Authz & tenancy

- All endpoints require a session; there is **no per-deck authorization**: the
  refresh endpoint is stateless (it maps the payload it was handed, it does
  not read or write any presentation).
- `NOTION_SECRET` is instance-level. Any logged-in user on an instance with
  live data enabled can query anything that integration token can reach —
  sharing a Deckyard instance means sharing the Notion integration's scope.

## Testing

- `tests/data-sources-behavior.test.js` — behavior: per-provider happy paths,
  the binding engine, frozen mode, and the binding-level SSRF refusals.
- `tests/c8-routes-batch-2-dispatch.test.js` — dispatch: routing, 401, 405.
- `tests/notion-datasource-app-error.test.js` — error typing (400/501, no
  upstream payloads in the envelope).
- `docs/developer/live-data-sources-testing.md` — the manual end-to-end smoke
  procedure against real Notion/Sheets sources.

## Implementation status

Normative target: **a slide declares its source once; refreshing is safe
against SSRF, typed in its errors, and eventually automatic for live decks.**
Where the code stands, as of 2026-08-16:

- **The fetch/bind pipeline and the SSRF guard are canonical.** All three
  providers go through the same factory, so error typing and binding
  application cannot drift per provider, and the csv-url guard cannot be
  bypassed by a new binding format.
- **`on-view` mode does nothing yet.** It is selectable in the panel and valid
  in the schema, but no code triggers a refresh when a slide is viewed — today
  it behaves exactly like `manual`.
- **The SSE broadcast has no listener.** A refresh with `presentationId` +
  `slideId` broadcasts `datasource:refreshed` to the deck's event stream, but
  no client subscribes to it yet. Note also that the broadcast trusts the
  caller's `presentationId` — any authenticated user can emit the event to any
  deck's stream. Harmless while nothing listens, but it is an authorization
  gap to close before a listener ships.
- **No caching, no rate limit on CSV fetches.** Every refresh/preview is a
  live upstream fetch (Notion calls share the client's token-bucket; CSV has
  nothing). A busy deck refreshing on a slow source does the work every time.
- **`lastSync` is advisory.** The server returns it; persisting it (like the
  refreshed content itself) is entirely the client's slide save.
