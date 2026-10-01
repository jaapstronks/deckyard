# Feature flags

A feature flag is an env var on the public config boundary (`.env` /
`.env.example`) that turns a whole subsystem on or off for an install. This
doc names where flags live and the one naming rule that keeps them uniform.

## Where a flag lives

- **Declaration** — `server/config/features.js` is the single place a feature
  env var is read. Every flag is a call-time function (never a module-load
  constant) built on the `envBool`/`envStr` accessor family from
  `server/config/utils.js` — no raw `process.env` reads (ESLint enforces this
  outside `server/config/`).
- **Snapshot** — `server/config/flags-snapshot.js` aggregates the declared
  flags with runtime status into the client-facing object. There is no
  dedicated flags endpoint: `getFeatureFlags()` rides along in the
  `/api/auth/me` payload as `features` (`server/routes/api/auth.js`), and
  server-side routes call it directly. Snapshot keys carry the same enable
  polarity (`enableAi`, `enableLiveData`, …); a missing key reads as _off_.
- **Consumption** — an installation cluster is never read as a snapshot key:
  a mount, route row or MCP tool declares `feature: '<key>'` and
  `isFeatureEnabled(key)` answers (§ Clusters); the client asks
  `featureEnabled(key)` (`client/lib/state/features.js`). Other snapshot keys
  are read positively (`flags.sandboxMode`, `!flags.enableUploads` in a field
  that greys out); nothing downstream re-reads the env var.

## The polarity rule (normative)

**Every on/off flag is spelled in the enable form: `X_ENABLED`.** The default
value carries the resting state — `AI_ENABLED` defaults to true (the var is a
kill switch), `MULTI_ORG_ENABLED` defaults to false (the var is an opt-in).
What never varies is the polarity: `=true` means the subsystem runs, `=false`
means it does not.

Do not introduce `DISABLE_X`, `NO_X`, `X_DISABLED` or any other negated
spelling for a new flag, whatever its default. Two polarities for one concept
is how `!flags.disableAi` ended up one line away from `flags.enableLiveData`
(the B68 finding this rule closes out).

## Clusters

A cluster is a subsystem an installation can leave out. Its env var follows
the polarity rule; its **key** is that var's prefix in lowerCamel, and the key
lands on the snapshot as `enable<Key>`: `AI_ENABLED` ↔ `enableAi` ↔ `'ai'`,
`RSS_FEED_ENABLED` ↔ `enableRssFeed` ↔ `'rssFeed'` (D257). There is no table
from key to env var; `isFeatureEnabled(key)` in
`server/config/flags-snapshot.js` derives it and throws on a key that lands on
nothing.

The key sits as `feature` wherever the cluster has a surface, and everything
with the cluster off answers as if it did not exist:

- **a mount** in a mount table (`MOUNTS`/`PUBLIC_MOUNTS` in
  `server/routes/api/index.js`, `V1_MOUNTS`, `STATIC_MOUNTS`) — skipped by
  `dispatchMounts`, so its paths reach the surface's 404;
- **a route row** in a module that is otherwise mounted (the AI rows of
  `presentations`, `image-library`, v1 `translate`, the Notion import) — the
  row answers 404 in the surface's envelope before its handler runs
  ([route-dispatch.md](route-dispatch.md));
- **an MCP tool** (`{ feature: 'ai' }`) — absent from `tools/list`,
  `tools/call` answers "Unknown tool";
- **a client entry** — not built (D179/D260), asked through
  `featureEnabled(key)`; `tests/feature-entries-follow-flags.test.js` holds
  the entries per cluster.

A row's feature may sit on top of its mount's (a Notion import needs `notion`
and `ai`), never beside it as a second spelling. `tests/feature-declarations.test.js`
pins that every declared key lands on a snapshot key and that this table and
the declarations name the same keys.

| Key            | Env var (default)            | With it off, absent                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai`           | `AI_ENABLED` (on)            | Mounts `/api/ai/*`, `/api/convert*`, v1 `/api/v1/ai/*`; the six AI rows of `presentations`, the three of `image-library`, two of v1 `translate`, the two Notion import rows; six MCP tools; every AI entry in the client. Also off in demo mode and sandbox.                       |
| `uploads`      | `UPLOADS_ENABLED` (on)       | Mount `/api/uploads*`. Also off in demo mode, sandbox and `IMAGEKIT_ONLY`; the upload fields grey out rather than disappear (sandbox form, D181).                                                                                                                                  |
| `imageLibrary` | `IMAGE_LIBRARY_ENABLED` (on) | Mount `/api/image-library*`; the library source in the image picker. Also off with `IMAGEKIT_ONLY`.                                                                                                                                                                                |
| `notion`       | `NOTION_ENABLED` (off)       | Mount `/api/notion/*` (all eight rows: status, fetch, publish, import, import/stream, subjects, compose, suggest); the Notion sub-tab in New presentation and Publish to Notion in Share. Also off in demo mode. `NOTION_SECRET` then says whether it is configured (501 without). |
| `liveData`     | `LIVE_DATA_ENABLED` (off)    | Mount `/api/data-sources*`; the data-source indicator in the editor.                                                                                                                                                                                                               |
| `rssFeed`      | `RSS_FEED_ENABLED` (on)      | Static mount `/feed/rss.xml`, `/feed/atom.xml`, `/feed/feed.json`. The organization's own switch (`settings.rss.enabled`) sits under it.                                                                                                                                           |

A cluster flag says what the installation _has_; an organization setting
underneath it (`rss.enabled`, `analytics.enabled`, `stockMedia.<id>.enabled`)
says what an organization _uses_. B523–B525 add analytics, live, stock media
and the public API to this table.

## Legacy spellings (until 2026-11-01)

The three kill switches were renamed in B68, two more flags in D259 (B522):

| Legacy (deprecated)          | Canonical                          |
| ---------------------------- | ---------------------------------- |
| `DISABLE_AI=true`            | `AI_ENABLED=false`                 |
| `DISABLE_UPLOADS=true`       | `UPLOADS_ENABLED=false`            |
| `DISABLE_IMAGE_LIBRARY=true` | `IMAGE_LIBRARY_ENABLED=false`      |
| `DISABLE_ANALYTICS=true`     | `EXTERNAL_ANALYTICS_ENABLED=false` |
| `NOTION_FEATURE=true`        | `NOTION_ENABLED=true`              |

`EXTERNAL_ANALYTICS_ENABLED` switches the external provider scripts in the app
shell (`server/analytics/head.js`), not first-party analytics; the old name
would have sat one word away from the analytics cluster's own flag with the
opposite polarity. `NOTION_FEATURE` had the right polarity and the wrong form,
and gated only three of the eight Notion routes; `NOTION_ENABLED` gates the
whole module, so an install that set only `NOTION_SECRET` now also sets
`NOTION_ENABLED=true`.

Until the first release after **2026-11-01** the legacy spellings are still
honored: a set legacy var still switches its feature (inverted where it meant
the opposite), the canonical var wins when both are set, and every set legacy var gets a boot warning naming its
replacement and the removal date (`deprecatedFlagWarnings()` in
`server/config/features.js`, logged by `server/server.js`). After that date
the legacy recognition is deleted and only the enable form exists. This is a
deliberately dated exception to the beta purity doctrine
([versioning.md](versioning.md)), not an open-ended tolerance.

The media provider's `SCW_*` → `S3_*` rename (B98/D25) rides the **same date
and the same shape**: legacy name read only when the canonical one is unset,
one boot warning per name read, deletion in the first release after
2026-11-01. Those are not feature flags, so the table lives with the provider
it configures — [media-library.md § Legacy env names](media-library.md#legacy-env-names-until-2026-11-01)
(`mediaConfigWarnings()` in `server/media/config.js`).
