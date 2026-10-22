# Render bundles: freezing a renderer

A **render bundle** is a renderer, frozen and content-addressed: the transitive
JavaScript, the core stylesheets, the files that renderer reads at run time, the
vendored highlighter bytes and the fork CSS seam, all hashed into one identity.
Its purpose is a single property: a published edition that names a bundle keeps
rendering the way it rendered on the day it was published, whatever the
installation does afterwards.

Today this is a **technical proof, not a live publishing contract** (T1.1). No
request path builds or opens a bundle. What it establishes is that the renderer
can be closed at all, which everything built on top of an edition record
depends on.

## Why a version number was not enough

Storing `rendererVersion: package.json.version` beside a publication freezes
nothing. The published render path resolved almost everything at view time: the
theme from the database, the slide-type registry from the database, the
stylesheets from the checkout, the upload bytes from the asset store. Two
visits to the same link could return different documents with no republication
in between, and the version number would have been identical both times.

Measuring the import closure made the size of that gap concrete. The closure of
the two published document builders was **305 modules**, and it reached:

| Edge                                                           | Through                                                                                 | What it meant                                                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/db/client.js` (`pg`, `kysely`)                         | `server/export/css-bundle.js` -> `server/utils/themes.js` -> `server/storage/themes.js` | One pure function, `themeVarsCssText()`, lived in a module that loads themes from Postgres.                                                  |
| `server/utils/ssrf-guard.js` (`node:net`, `node:dns`, `fetch`) | `server/utils/head-chain.js` -> `server/utils/html-utils.js`                            | `html-utils.js` re-exported `escapeHtml` from its canonical home, and that one hop pulled remote-image fetching into every document builder. |
| `server/config/flags-snapshot.js`                              | `server/export/reader.js` -> `server/utils/public-output.js`                            | The visibility filter reads the installation's current feature flags.                                                                        |
| `server/media/s3.js`, `sharp`                                  | `server/utils/embed-fonts.js`, `server/export/image-compress.js`                        | Font and image embedding is byte work against live storage.                                                                                  |

## The split that closed it: prepare, then render

Each of those edges is the same mistake in a different place: deciding
_something about this installation_ inside the thing that assembles the
document. So the render paths were split in two.

- A **preparer** reads what only an installation can answer: the visibility
  filter, the theme CSS and fonts, the upload bytes. `server/export/html.js` and
  `server/export/reader.js` are the two.
- An **assembler** turns that input into a document and reads nothing else.
  `server/export/canvas-document.js` and `server/export/reader-document.js` are
  the two, and they are what a bundle carries.

`server/render-paths.js` names the assembler as each path's `module` and the
preparer as its `build`, because the document opening lives in the first and the
path as a caller uses it is the second. Two more seam corrections finished the
job: `themeVarsCssText()` moved to `server/utils/theme-vars-css.js`, a pure
module, because turning a theme record into `--t-*` declarations is renderer
logic that an edition has to keep; and the `escapeHtml` re-export was removed
from `server/utils/html-utils.js`, so its importers name the canonical home
(`shared/slide-types/helpers.js`) directly.

## Dependency map

What a bundle carries, measured by `node scripts/build-renderer-bundle.js
--print-map`:

| Group           | Count | What it is                                                                                                                                                                                                               |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `modules`       | 140   | The renderer's own JavaScript: the two assemblers, the CSS/script/head chains, and 96 modules of `shared/slide-types/` (the registry _is_ renderer code).                                                                |
| `runtime-reads` | 6     | Files a module in the closure reads through a `new URL('…', import.meta.url)` literal: three slide runtimes, two presenter client modules, and the one accessibility rule the reader borrows from the canvas stylesheet. |
| `css`           | 62    | The `@import` closure of `client/styles/export.css` and `client/styles/slides.css`, resolved with `cssImportClosure()` - the same walker the render path reads them with.                                                |
| `static-trees`  | 60    | `client/vendor/prism`, `client/vendor/katex`, `custom/styles/` and `custom/slide-types/`.                                                                                                                                |

A bundle built from this checkout is 267 files and about 2.9 MB.

The closure contains **no** module under `server/storage/`, `server/db/` or
`server/media/`, and not `flags-snapshot.js`, `html-utils.js`, `ssrf-guard.js`,
`themes.js` or `public-output.js`. Its only bare imports are ten `node:`
builtins for reading files and computing. `tests/renderer-bundle-closure.test.js`
asserts this as properties rather than as a file list, and points the same
scanner at fixture trees so each refusal is proved by a bundle that is refused.

### The one unsealed edge

`shared/sanitize.js` loads `jsdom` and `dompurify` through dynamic imports.
Those packages are not in a bundle and cannot be: `jsdom` is a DOM
implementation. The edge is recorded in every manifest rather than hidden,
because it is honest and because it changes the hash.

It is unreachable rather than merely untaken. The loader is `initSanitizer()`,
which only the server and the MCP entrypoint call; a sealed worker calls neither.
And the render entry refuses the two inputs that would reach a sanitizer anyway
(see _Refusals_ below).

## How a bundle is built

`scripts/build-renderer-bundle.js` is an operator tool, not part of the request
path. It walks the module closure of the worker entry, adds the four declared
file groups, hashes everything and writes a directory into a store:

```
<store>/<rendererHash>/manifest.json      canonical bytes; sha256 == dirname
<store>/<rendererHash>/provenance.json    commit, build time, Node version
<store>/<rendererHash>/files/<path>       the renderer tree, repo-relative
```

`files/` mirrors the source tree rather than flattening it to `files/<sha256>`,
because the modules in it import each other by relative path and a sealed worker
has no loader hook to resolve a flat store with. Content-addressing lives where
it has to: the manifest names every file by digest, and the directory name is
the digest of the manifest. Opening a bundle verifies both, in both directions -
every file the manifest names must hash correctly, and no file under `files/`
may be absent from the manifest, or somebody who can write the store could plant
a module a relative import would pick up.

A useful consequence: a bundle's `files/` directory is itself a buildable source
root, and rebuilding it gives the same hash. That is what makes the store a
cache rather than a source of truth, and it is how the tests make a second
renderer revision without a second checkout.

**Identity is content.** The manifest holds five keys - schema, entry, worker,
files, unsealed - and nothing else. Release version, commit and build time are
provenance and live outside the hash, so a bundle rebuilt from the same sources
next year is the same renderer. Serialisation is defined once, in
`server/render/renderer-bundle/manifest.js`, with vectors in
`tests/renderer-bundle-manifest.test.js`: minified JSON, declared key order,
files sorted by path, one trailing newline.

### What the build refuses

A bundle that can reach outside itself is not frozen, so the scan rejects it
with every reason it found, not the first:

- an import of a networking builtin (`node:net`, `node:https`, `node:dns`, …),
  under either spelling;
- an import of a database or cache client (`pg`, `kysely`, `ioredis`);
- an import of a process-escape builtin (`node:child_process`,
  `node:worker_threads`, `node:cluster`, `node:inspector`);
- a builtin outside the ten allowed ones, so a new capability has to be argued
  for in the builder rather than appearing in a closure;
- a static import of any npm package, which would not even load;
- a dynamic import of a package that is not a recorded unsealed edge;
- a computed `import()`, unless the module is the fork type loader, whose
  directory the bundle carries whole;
- a read of a file outside the checkout.

## The isolation boundary

A published edition is rendered by code that was frozen months ago. That code is
trusted - an operator built and verified the bundle - but it is old, and old
code is what a security fix was about. So it runs in a process that can do
almost nothing:

| Mechanism                                                         | Closes                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--permission --allow-fs-read=<bundleDir>`, no `--allow-fs-write` | Reads nothing outside the bundle, writes nothing anywhere. Also denies `child_process`, `worker_threads`, `cluster` and native addons.                                                                     |
| A two-key environment (`NODE_ENV`, `DECKYARD_RENDER_WORKER`)      | No `DATABASE_URL`, no S3 key, no LLM key, no `DECKYARD_CUSTOM_DIR`. It is an allowlist, because a blocklist of secrets is a list somebody has to remember to extend.                                       |
| The network seal in `bundle/net-guard.js`                         | The sockets the permission model has no opinion about. A `module.registerHooks()` resolve hook refuses the networking specifiers and the network globals are deleted, before the render entry is imported. |
| `--max-old-space-size`, a wall-clock timeout, an output cap       | A renderer that loops, allocates or writes forever.                                                                                                                                                        |

`module.registerHooks()` rather than `module.register()`: the latter runs its
hooks on a worker thread, which the permission model denies, so it cannot be the
seal of a sealed worker.

Input arrives as JSON on stdin and one JSON object leaves on stdout, so the host
never sees a partial document. What deliberately stays outside the worker: HTTP
headers, access control, revocation, rate limiting and caching. Those are
current policy and belong to the current server, never to a frozen renderer.

`tests/renderer-bundle-isolation.test.js` runs a probe with the same flags, read
from the host rather than retyped, and runs it twice - with and without the seal

- so the two halves are told apart: the permission model denies the process
  escapes on its own, and without the seal a sealed renderer could still import
  `node:net`.

## The edition input

Everything that varies per installation or per day is in the input; everything
else is in the bundle. `server/render/renderer-bundle/edition-input.js` is the
contract: the public projection of the deck with every asset reference already an
inline data URL, the effective theme record with the dynamic `default` resolved,
the frozen font CSS, the meta description and the canvas address. Producing one
is the next step's work, not this one's.

There is deliberately **no slide-type registry field**. The renderer's registry
is the one frozen in its own bundle, which is exactly what keeps a core slide
type's later render changes away from a published edition.

### Refusals

The render entry refuses rather than renders when it cannot derive the document
from the input alone. A fallback to the current renderer would serve different
content under a citation, which is the thing the whole design prevents.

| Code                                | When                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `renderer_edition_input_invalid`    | Unknown input schema, or no presentation.                                           |
| `renderer_edition_input_unsealable` | A slide type the bundle does not carry, or author markup in a `markup: true` field. |
| `renderer_bundle_unknown`           | No bundle with that hash in the store.                                              |
| `renderer_bundle_malformed_hash`    | Not a 64-character lowercase hex digest.                                            |
| `renderer_bundle_corrupt`           | The manifest or a file does not match its digest, or the manifest is not canonical. |
| `renderer_bundle_incomplete`        | A named file is missing, or an unnamed file is present.                             |
| `renderer_bundle_worker_failed`     | The worker crashed, timed out, or wrote something unreadable.                       |

## The open question

**A database-backed slide type cannot be frozen into a render bundle.** Its
template renderer sanitises its interpolated output on _every_ render
(`createTemplateSlideRenderer()` in
`shared/slide-types/custom-type-runtime.js`), because the content a template
interpolates is authored at a lower privilege than the template. That
sanitising needs DOMPurify on a DOM, which no bundle can carry. Three ways out,
and they are a product decision rather than a technical one:

1. **Refuse** editions that use a database-backed slide type. Smallest surface,
   and it is what the render entry does today: the refusal names the type.
2. **Freeze a DOM-free sanitizer** into the bundle, replacing DOMPurify plus
   `jsdom` on this path. That is a security-sensitive rewrite of a defence, and
   it is the only route to a frozen edition that uses a fork or database type.
3. **Freeze the rendered HTML** per slide in the edition input. Rejected:
   the renderer would no longer derive the document from the input, which is
   the property the bundle exists to provide.

Recommendation: (1) now, (2) as the route to an edition that may use a custom
type. Not something to decide inside a technical proof.

## Limits

- **A bundle does not promise identical pixels forever.** It freezes the input
  and the render logic. The browser that paints them is the reader's, and it
  changes. Reproducibility proofs therefore pin a browser and font version;
  `tests/renderer-bundle-screenshot.test.js` compares the deck's own stage in
  one browser in one process, which measures whether the input to Chrome
  changed and nothing more.
- **The highlighter bytes are carried but not yet served from the edition.** A
  published document _links_ Prism and KaTeX, so the bytes a reader gets come
  from whatever the installation serves at `/client/vendor/…`. The bundle
  freezes and hashes them; serving them per edition is the public read path's
  half of the work.
- **Fonts and images are not in the bundle.** They are bytes of the edition, not
  of the renderer, and belong in the edition input. A bundle therefore renders
  with no font faces at all unless the input brings them.
- **A fork CSS seam may still reference its own assets by URL.** `custom/styles/`
  is frozen, but a `url(/custom/assets/…)` inside it resolves against the
  serving origin at view time. Closing that needs the same per-edition serving
  as the highlighter bytes.
- **A bundle is about 2.9 MB.** One per renderer revision actually in use by a
  living edition, not one per release.
