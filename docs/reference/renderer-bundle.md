# Render bundles: freezing a renderer

A **render bundle** is a renderer, frozen and content-addressed: the transitive
JavaScript, the core stylesheets, the files that renderer reads at run time, the
vendored highlighter bytes and the fork CSS seam, all hashed into one identity.
Its purpose is a single property: a published edition that names a bundle keeps
rendering the way it rendered on the day it was published, whatever the
installation does afterwards.

**Status 2026-10-27: production execution remains disabled (T1.1).** The original trusted-fixture import filter permits real TCP connections through `process.getBuiltinModule('net')`; that counterexample is retained. An experimental Linux operator runner now lives under `server/render/renderer-bundle/runner/`, with separate broker/supervisor services, verified private copies and a native syscall boundary. Full P1-P16 acceptance and independent code review are still required. Production `renderEditionInBundle()` refuses with `renderer_bundle_sandbox_unavailable` before inspecting or executing a bundle, without an environment switch or fallback. The operator entry has no publication, v1 or MCP caller. Installation and recovery are described in the [operator runbook](../ops/renderer-runner.md).

## Why a version number was not enough

Storing `rendererVersion: package.json.version` beside a publication freezes
nothing. The published render path resolved almost everything at view time: the
theme from the database, the slide-type registry from the database, the
stylesheets from the checkout, the upload bytes from the asset store. Two
visits to the same link could return different documents with no republication
in between, and the version number would have been identical both times.

Measuring the import closure made the size of that gap concrete. The closure of the published document builders reached:

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

| Group           | Contents                                                                              |
| --------------- | ------------------------------------------------------------------------------------- |
| `modules`       | Assemblers, CSS/script/head chains and the frozen slide-type registry.                |
| `runtime-reads` | Literal URL reads of slide runtimes, presenter code and the accessibility stylesheet. |
| `css`           | Export and slide stylesheet import closures, using the same walker as rendering.      |
| `static-trees`  | Vendored Prism/KaTeX and the custom styles/type seams.                                |

Use the builder's `--print-map` output for the current inventory and sizes.

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
which only the server and the MCP entrypoint call; the proof worker calls neither.
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
because the modules in it import each other by relative path and the proof worker
has no loader hook to resolve a flat store with. Content-addressing lives where
it has to: the manifest names every file by digest, and the directory name is
the digest of the manifest. Opening a bundle verifies both, in both directions -
every file the manifest names must hash correctly, and no file under `files/`
may be absent from the manifest, or somebody who can write the store could plant
a module a relative import would pick up.
The entry, worker and each file path must use one relative POSIX spelling
inside `files/`, without `.`/`..` segments, empty segments or platform path
aliases. Entry and worker must name declared files. The materialized tree must
contain ordinary files and directories, not symlinks, before the store accepts
it. An invalid manifest refuses with `renderer_bundle_corrupt`; a non-ordinary
materialized path refuses with `renderer_bundle_incomplete`.

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

## Execution gate and architecture question

The production entry always refuses with `renderer_bundle_sandbox_unavailable`. There is no flag, environment switch or fallback that enables the test runner. The old process launcher lives under `tests/helpers/renderer-bundle-process.js` to keep reproducibility measurements available for trusted fixtures.

The [Node 22 permission model](https://nodejs.org/docs/latest-v22.x/api/permissions.html) restricts selected APIs but is explicitly not a security boundary against malicious code. It has no network permission. The `bundle/net-guard.js` resolve hook rejects imports and removes globals; `process.getBuiltinModule('net')` bypasses it. The closure scanner also accepts that code because it has no import to inspect. Blocking this one spelling would leave the same architectural problem.

`tests/renderer-bundle-isolation.test.js` starts a local ephemeral TCP listener, launches a filtered probe with the proof runner's exact flags and scrubbed environment, and checks both receipt of `local-proof` and the listener's connection count. This is a retained counterexample, not a passing isolation claim. It also checks that the production entry refuses before reading bundle paths.

The test runner retains Node filesystem/process permission checks, a scrubbed environment, heap limit, wall-clock timeout and output cap. These bound the trusted experiment; they do not protect the host from hostile historical code. Input uses stdin and output uses stdout. HTTP policy, access control, revocation and caching remain outside frozen code.

**Deployment decision:** historical edition rendering may require a separately managed Linux worker with a pinned image, private namespaces, a read-only bundle, no host secrets/sockets or capabilities, resource bounds and an independently enforced syscall boundary. The webapp receives only the broker socket, never a Docker socket or general runtime access. The first implementation is rootful crun on Linux x86_64; other architectures and missing kernel features refuse readiness.

The operator runner is a separate execution contract from the old trusted-fixture process helper. A successful hash/rebuild/screenshot experiment proves reproducibility only. The full external boundary gate and its independent code review must pass before merge, and a separately reviewed activation change must pass before production or downstream publication rollout can use it.

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

| Code                                  | When                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `renderer_edition_input_invalid`      | Unknown input schema, or no presentation.                                           |
| `renderer_edition_input_unsealable`   | A slide type the bundle does not carry, or author markup in a `markup: true` field. |
| `renderer_bundle_unknown`             | No bundle with that hash in the store.                                              |
| `renderer_bundle_malformed_hash`      | Not a 64-character lowercase hex digest.                                            |
| `renderer_bundle_corrupt`             | The manifest or a file does not match its digest, or the manifest is not canonical. |
| `renderer_bundle_incomplete`          | A named file is missing, or an unnamed file is present.                             |
| `renderer_bundle_sandbox_unavailable` | Production execution remains disabled pending runner acceptance and activation.     |
| `renderer_bundle_worker_failed`       | The worker crashed, timed out, or wrote something unreadable.                       |

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
- **Storage follows renderer revisions in use**, not releases. Measure bundle size with the builder rather than assuming a fixed size.
