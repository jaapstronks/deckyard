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
- **Consumption** — routers and views read the snapshot keys positively
  (`flags.enableAi`, `!flags.enableUploads`); nothing downstream re-reads the
  env var.

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

## Legacy `DISABLE_*` vars (until 2026-11-01)

The three kill switches were renamed in B68:

| Legacy (deprecated)          | Canonical                     |
| ---------------------------- | ----------------------------- |
| `DISABLE_AI=true`            | `AI_ENABLED=false`            |
| `DISABLE_UPLOADS=true`       | `UPLOADS_ENABLED=false`       |
| `DISABLE_IMAGE_LIBRARY=true` | `IMAGE_LIBRARY_ENABLED=false` |

Until the first release after **2026-11-01** the legacy spellings are still
honored: a set `DISABLE_*` var turns its feature off, the canonical var wins
when both are set, and every set legacy var gets a boot warning naming its
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
