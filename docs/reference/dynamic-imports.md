# Dynamic `import()` — when it is justified, and where it survives

Deckyard has no bundler, so a dynamic `import()` is never a code-splitting
artefact of a build step: every one of them is a deliberate decision by whoever
wrote the line. This document is the shared answer to "is this dynamic import
justified, or is it noise?" — the rule, the current inventory, and the handful
of sites that look wrong but are not.

The companion rule about which packages may live in `optionalDependencies` is in
[`AGENTS.md`](../../AGENTS.md) § _The project's "non-negotiables"_. This document
is about the `import()` call; that one is about `package.json`.

## The rule

A dynamic `import()` is justified in exactly four cases:

1. **Heavy or optional npm dependency behind a gate.** The dependency is in
   `optionalDependencies` (or is fork-only and undeclared), the call sits behind
   a feature check or a `try/catch`, and a missing package produces a clear
   error instead of a boot failure.
2. **Runtime-computed path.** The specifier is not knowable statically —
   migration files enumerated from a directory, custom slide types and MCP tools
   loaded from a fork's drop-in folder.
3. **Real cycle-breaker.** Making it static would create an import cycle. These
   are a smell about module boundaries, not about the import; they are listed
   individually below so nobody "cleans them up".
4. **Client code-splitting behind a feature gate.** A client module that only a
   subset of sessions needs (collab presence, live edits, the viewer preview),
   loaded when that path is actually taken.

Everything else is static. A dynamic `import()` of an ordinary internal module —
a pure-JS helper, a constants file, a formatter — is noise: it makes the reader
ask "why is this one lazy?" and the answer is "no reason", which devalues the
signal at the other 40-odd sites.

## Where the dynamic imports are

Roughly 45 runtime sites, all four categories accounted for. (A raw grep finds
about twice that; half are JSDoc type annotations like
`import('node:http').ServerResponse`, which are not runtime.)

### Heavy or optional dependencies behind a gate

| Package                                               | Site                                      | Gate                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pptxgenjs`                                           | `server/export/pptx.js`                   | PPTX export only; throws `*_MISSING`                                                                                  |
| `pdf-parse`                                           | `server/utils/convert-file/pdf-parser.js` | PDF import only                                                                                                       |
| `puppeteer-core`                                      | `server/utils/puppeteer-browser.js`       | Chrome exports only                                                                                                   |
| `ioredis`                                             | `server/utils/redis-client.js`            | `isRedisConfigured()`                                                                                                 |
| `bullmq`                                              | `server/jobs/queue/connection.js`         | same gate, paired                                                                                                     |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | `server/media/scaleway.js`                | `isScalewayConfigured()`; `scaleway.js` itself is loaded dynamically from `server/media/index.js` for the same reason |
| `@hocuspocus/server`, `crossws/adapters/node`         | `server/collab/mount.js`                  | `isCollabEnabled()` — a disabled install never loads the collab dependency tree                                       |
| `ciiic-translation-rules`                             | `server/utils/openai/translate.js`        | fork-only, deliberately **not** in `package.json`, falls back to empty rules                                          |
| `dompurify`, `jsdom`                                  | `shared/sanitize.js`                      | server-side sanitization path only                                                                                    |

A package that is imported **statically** anywhere stays a hard `dependency`
even when its feature is off, because loading that module pulls it in
regardless. `sharp`, `jszip` and `openid-client` are all in this group: they are
statically imported at every site, and they are hard dependencies. That
consistency is the point — a package must not be treated as optional in one file
and mandatory in another.

### Runtime-computed paths

- `server/db/migrate.js` — migration files enumerated from `MIGRATIONS_DIR`.
- `shared/slide-types/custom-loader.js`, `shared/slide-types/registry.js` —
  fork drop-in slide types from `custom/slide-types/`.
- `server/mcp/custom-tools-loader.js` — fork drop-in MCP tools.
- `server/utils/ai/prompts/custom-loader.js`,
  `server/utils/ai/slide-catalog/custom-loader.js`,
  `server/utils/ai/slide-catalog/custom-catalog-loader.js` — fork drop-in AI
  prompts and catalog entries.

### Storage lifecycle loading

`server/storage/lifecycle.js` loads `server/db/client.js` (and through it kysely
and pg) lazily inside `initializeStorage()` / `closeStorage()`, keeping the
database driver out of the module graph of scripts that never touch storage. The
scope-to-context reduction (`toStorageContext`) lives in
`server/storage/scope.js` next to the scope validation it wraps.

### Real cycle-breakers — do not make these static

Three sites, all in the presentations facade's orbit:

- `server/storage/presentations/cache.js` → `./presentations/index.js`
- `server/storage/presentations/index.js` → `../live-sessions/sse.js`
- `server/storage/presentations/index.js` → `../../collab/live-apply.js`

Converting any of these to a static import creates a genuine cycle. They are
evidence that the presentations facade carries responsibilities that belong
elsewhere (cache invalidation, SSE fan-out, live-doc application) — worth
untangling as a design change, never as a find-and-replace.

### Client code-splitting behind a feature gate

- `client/views/editor/editor-controller.js` → `./live-edits/index.js`,
  `./presence/index.js` — collab-only editor surfaces.
- `client/views/editor/render-editor.js` → `../viewer/viewer-controller.js`.
- `client/views/editor/data-source-panel.js` → `./data-source-modal.js`.
- `server/routes/api/*` and `server/jobs/queue/workers/*` carry a few
  request-path lazy loads of the same shape.

## Why this is written down

The pattern only carries information if it is applied consistently. When a
dynamic `import()` can mean either "this is heavy or optional" or "someone
happened to write it that way", a reader has to check every site by hand — and
that is exactly the state the codebase was in before the cleanup: 77 runtime
sites, of which about a dozen were gratuitous and another dozen contradicted
themselves about whether a dependency was optional.

The ESLint gate (`npm run lint`, see
[`docs/developer/linting.md`](../developer/linting.md)) catches unresolved
imports and unused ones, but it does not judge lazy-versus-static. That judgment
is this document plus review.
