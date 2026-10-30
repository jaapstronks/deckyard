# Render bundles: freezing a renderer

A **render bundle** is a renderer, frozen and content-addressed: the transitive
JavaScript, the core stylesheets, the files that renderer reads at run time, the
vendored highlighter bytes and the fork CSS seam, all hashed into one identity.
Its purpose is a single property: a published edition that names a bundle keeps
rendering the way it rendered on the day it was published, whatever the
installation does afterwards.

**Status 2026-10-28: production execution goes through the Linux operator runner, or refuses.** The original trusted-fixture import filter permits real TCP connections through `process.getBuiltinModule('net')`; that counterexample is retained. The operator runner under `server/render/renderer-bundle/runner/` (separate broker/supervisor services, verified private copies, a native syscall boundary) passed the full external Linux acceptance (P1-P16) for each of its three iterations, the last on code SHA `0dd7d8ea` (runnerId `7ae4568f…`), each with an independent code review. Production `renderEditionInBundle()` is the broker's client: without `RENDERER_RUNNER_SOCKET` it refuses with `renderer_bundle_sandbox_unavailable` before inspecting a bundle or its input; with it, it speaks only to that Unix socket, without retry or fallback (§ Execution gate). The public edition read path calls it ([publication-editions.md § Public read path](publication-editions.md#public-read-path)); no publish, v1 or MCP route does. Installation, registration and recovery are in the [operator runbook](../ops/renderer-runner.md).

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

The loader is `initSanitizer()`, which only the server and the MCP entrypoint
call; the proof worker calls neither. That made the edge untaken, not
unreachable: until the markdown generator stopped using it, every markdown
field called the sync sanitizer, found no DOMPurify, and fell back to escaping,
so an edition showed its code blocks, bold and lists as visible HTML text.

Markdown now needs no sanitizer. `shared/markdown.js` escapes by construction
(every input character through `escapeHtml()`, every tag and attribute a
literal, only `http(s)` link targets) and no longer imports `shared/sanitize.js`,
so the bundle renders markdown exactly as the live page does
(`tests/renderer-bundle-edition-views.test.js` compares the two;
`tests/markdown-escaped-by-construction.test.js` is the safety proof). What
still reaches a sanitizer is author markup: a database-backed type's template
and a `markup: true` field. The render entry refuses both (see _Refusals_
below), so on an edition the sanitizer is now unreachable in fact.

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

`server/render/renderer-bundle/host.js` is the production entry, and it executes nothing itself: it is the client of the operator runner's broker socket. `RENDERER_RUNNER_SOCKET` must name that socket by an absolute path; unset, relative or a `host:port`/URL spelling is no configuration, and the entry refuses with `renderer_bundle_sandbox_unavailable` before reading its arguments. Configured, it sends one request frame (`deckyard.renderer-runner.request/1`, at most 16 MiB, refused before connecting with `renderer_edition_input_unsealable` when larger) and accepts exactly one response frame for that request, within 80 seconds. It returns `{canvas, reader, rendererHash, runnerId}`; the runner's refusals map onto the closed set in [the runbook](../ops/renderer-runner.md#connecting-the-webapp). There is no retry, no TCP form, and no fallback to the current renderer or to the test runner. The old process launcher lives under `tests/helpers/renderer-bundle-process.js` to keep reproducibility measurements available for trusted fixtures; nothing in `server/` imports it.

The installation's own renderer is built into the image (`Dockerfile`, stage `renderer-bundle`, into `/app/renderer-store/<hash>`); `openCurrentRendererBundle()` (`current.js`) opens and verifies it, the doctor probes the runner with its hash, and an operator exports and registers it after each release.

The [Node 22 permission model](https://nodejs.org/docs/latest-v22.x/api/permissions.html) restricts selected APIs but is explicitly not a security boundary against malicious code. It has no network permission. The `bundle/net-guard.js` resolve hook rejects imports and removes globals; `process.getBuiltinModule('net')` bypasses it. The closure scanner also accepts that code because it has no import to inspect. Blocking this one spelling would leave the same architectural problem.

`tests/renderer-bundle-isolation.test.js` starts a local ephemeral TCP listener, launches a filtered probe with the proof runner's exact flags and scrubbed environment, and checks both receipt of `local-proof` and the listener's connection count. This is a retained counterexample, not a passing isolation claim. It also checks that the unconfigured production entry refuses before reading bundle paths; `tests/renderer-bundle-host.test.js` pins the client (mapping, refused shapes, no TCP) and `tests/renderer-runner-admission.test.js` runs the shipped broker against it, so the admission refusal of an unregistered hash (D364) has a node test beside its Linux evidence.

The test runner retains Node filesystem/process permission checks, a scrubbed environment, heap limit, wall-clock timeout and output cap. These bound the trusted experiment; they do not protect the host from hostile historical code. Input uses stdin and output uses stdout. HTTP policy, access control, revocation and caching remain outside frozen code.

**Deployment decision:** historical edition rendering may require a separately managed Linux worker with a pinned image, private namespaces, a read-only bundle, no host secrets/sockets or capabilities, resource bounds and an independently enforced syscall boundary. The webapp receives only the broker socket, never a Docker socket or general runtime access. The first implementation is rootful crun on Linux x86_64; other architectures and missing kernel features refuse readiness.

The operator runner is a separate execution contract from the old trusted-fixture process helper. A successful hash/rebuild/screenshot experiment proves reproducibility only. Every runner change passes the full external boundary gate and an independent code review before merge; the activation change has its own gates (P16 as redefined, P17) in the [acceptance record](../ops/renderer-runner.md#external-linux-acceptance-record).

## Operator runner: boundary contract

This section is the reviewable contract of the operator runner under `server/render/renderer-bundle/runner/`. It describes what the runner enforces; how the webapp calls it is in § Execution gate above. Installation, recovery and the operator procedure are in the [runbook](../ops/renderer-runner.md).

### Components and identities

| Component         | Process and containment                                                                                                                                            | May create                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Caller            | One configured numerical UID; connects to `/run/deckyard-render/broker.sock` (0660 `root:<caller gid>`, parent 0750)                                               | Nothing; one request frame per connection                                                                                       |
| Broker            | Rootful `deckyard-render-broker.service`, `Restart=no`, 512 MiB/64 tasks, systemd filter denies legacy AIO and io_uring                                            | Job staging, the private copy, the OCI config and the launcher, only from the single-use job Worker after a durable reservation |
| Supervisor        | Rootful `deckyard-render-supervisor.service`, the only automatic restart, delegated `cpu memory pids`, manager subgroup 256 MiB/64                                 | The job and helper cgroups before reserve-ack; cleanup (`crun delete`, unmount checks, removal)                                 |
| Launcher and crun | Created atomically in `helpers/<job>` with `clone3(CLONE_INTO_CGROUP)`; crun creates the guest in `jobs/<job>` the same way                                        | The container; nothing after the job ends                                                                                       |
| Guest             | UID/GID 1000 in its own user namespace mapped to a reserved 65,536-ID host range, no capabilities, `no_new_privs`, non-dumpable once the final filter is installed | Files in its 64 MiB `/tmp` only                                                                                                 |

### Wire contract and memory

A request is one frame (4-byte big-endian length, at most 16 MiB of UTF-8 JSON, then write-half-close). The broker checks `SO_PEERCRED` against the configured UID and takes `SO_PEERPIDFD` before it reads a byte; any other UID is closed unread. The envelope is validated by a strict byte-level scan (UTF-8 via `buffer.isUtf8`, JSON grammar, duplicate keys at every depth, a byte-order mark, depth 64) that decodes only the envelope scalars: the input travels as the caller's own validated bytes, so a queued request costs its body and no parse tree. The guest answer is validated by the same scan; the success frame is the broker's envelope plus the two validated string tokens of `canvas` and `reader`, written as views on the guest output. No guest field other than those two reaches the caller. Measured broker peaks at the gate SHA stayed at or below 207 MB with four queued 16 MiB bodies, six held tokens and a 60 MiB response.

Seven refusal codes are framed: `invalid_request`, `busy`, `queue_timeout` and `bundle_refused` from admission, `worker_failed` for a well-formed guest refusal, `output_limit` when the serialized response would exceed its bound, and `sandbox_unavailable` as the fallback for anything the runtime cannot serve. `bundle_refused` is an admission check (`lstat` of `<store>/<hash>`, a plain directory, no symlink followed) before the request is queued: no reservation, no register record, no staging. `worker_failed` is framed only when the launcher exits 0 and `validateOutput` finds exactly `{ok:false, code, message, details}` with a code from `RENDERER_BUNDLE_ERRORS`, a string message and an object or null as details; the job worker posts that `{code}` result, the broker sends `QUIESCENT` on Worker exit as for a success, and frames the code after `cleaned`. The guest's code, message and details never leave the broker. A peer with another UID is closed unread, without a frame. Every other job failure (a copy or verification failure during a job, malformed output, a non-zero exit, a stdout or stderr overflow, a deadline, a caller disconnect) makes the broker send `cancel`, after which the supervisor stops the whole broker instance; the caller sees only a closed connection. The self-test job still requires its own marker, so a refusing self-test stops the instance. The codes `unauthorized`, `job_timeout` and `job_cancelled` belong to the protocol vocabulary (`protocol.js`) and the ledger, but never reach the wire.

### Syscall boundary

Three filter layers apply to the guest, oldest first: the broker unit's systemd filters (native architecture only; AIO and io_uring denied) inherited through launcher and crun, crun's initial OCI profile (io_uring denied before Node starts), and the final filter installed by `bootstrap.node` with `SECCOMP_FILTER_FLAG_TSYNC`. Only a return of 0 continues; an errno or a positive thread ID exits 126 before any historical instruction. Before installing it, the addon checks `no_new_privs` and sets `PR_SET_DUMPABLE` to 0: the host's `core_pattern` may pipe to a crash helper, which ignores `RLIMIT_CORE`, so a dumpable guest crash would start a host process with the guest's memory.

The final filter (`filter.c`, 199 BPF instructions) checks `AUDIT_ARCH_X86_64` and kills the process on any other architecture or on the x32 bit. It allows these 88 syscalls unconditionally:

`read write readv writev pread64 pwrite64 close close_range fstat newfstatat statx stat lstat lseek open openat access faccessat faccessat2 getdents64 readlink readlinkat getcwd fcntl dup dup2 dup3 mkdir mkdirat unlink unlinkat rename renameat renameat2 ftruncate fsync fdatasync utimensat brk mmap mprotect munmap mremap madvise msync membarrier futex rseq set_robust_list set_tid_address rt_sigaction rt_sigprocmask rt_sigreturn sigaltstack tgkill restart_syscall clock_gettime clock_getres clock_nanosleep nanosleep gettimeofday times getpid getppid gettid getuid geteuid getgid getegid getgroups getrandom uname sysinfo sched_yield sched_getaffinity getrusage getrlimit prlimit64 epoll_create1 epoll_ctl epoll_wait epoll_pwait eventfd2 pipe2 poll ppoll exit exit_group`

Two are argument-checked: `ioctl` only with `FIONBIO` (0x5421) or `FIONREAD` (0x541b) and a zero upper request word; `clone` only with exactly the glibc pthread flag word `0x003d0f00` (`CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM|CLONE_SETTLS|CLONE_PARENT_SETTID|CLONE_CHILD_CLEARTID`, no namespace flags) and a zero upper word. `clone3` returns `ENOSYS`, because seccomp cannot inspect its argument structure, so glibc falls back to the inspectable `clone`. Every other syscall, including `execve`, `execveat`, `fork`, `vfork`, process clones, `unshare`, `setns`, `mount`, `ptrace`, `process_vm_*`, `bpf`, `perf_event_open`, every socket call, `prctl` and all io_uring and AIO calls, returns `EPERM`. Later JS Workers and native threads inherit the filter; there is no user-notification broker or ptrace exception.

### Producer paths and joins

Every object a job can leave behind has one creator, and each creator ends before `QUIESCENT` or is killed before cleanup:

1. The supervisor durably records the reservation and creates both cgroups (limits verified, `cgroup.kill` opened) before it acknowledges.
2. The broker starts one `node:worker_threads` Worker per job. Its synchronous `mkdir`, the native `openat2` copy and the freeze run on that thread. The copy holds the store root and the target as directory descriptors resolved from `/` without symlinks, then resolves the bundle beneath the store root with `RESOLVE_BENEATH|NO_SYMLINKS|NO_MAGICLINKS|NO_XDEV`, so a separate mount for the state directory works and a mount inside the bundle refuses; verification reads complete before it posts `prepared`; after the supervisor accepts `RUNNING` it spawns the launcher and awaits its `close` event. The Worker has no message handler for further work and exits after one result.
3. The launcher joins all pipe I/O and `waitpid` before exiting; crun's guest lives only in the job cgroup. When the guest closes its stdin before reading all input (`EPIPE`), the launcher discards the unwritten input and keeps relaying output until it joins the guest, so the job ends with the guest's own exit status.
4. Only the Worker's `exit` event lets the broker send `QUIESCENT`, after a validated success or a validated `{code}` result (a well-formed guest refusal or the response limit). The supervisor accepts it in `RUNNING`, before the deadline, with both job cgroups empty.
5. Any cancellation, deadline, channel loss, late or malformed message instead kills the whole broker cgroup and both job subtrees and waits for the held broker pidfd and `populated 0` everywhere. A producer stuck in an uninterruptible syscall keeps the slot occupied and admission closed.
6. Cleanup then runs `crun delete`, refuses while a mount remains (no lazy unmount), removes staging and runtime state, re-inventories, removes the cgroups and only then writes `CLEANED`. Only a `CLEANED` record releases the slot or a success response.
7. A supervisor start reconciles first, then compacts: `CLEANED` records of the previous generation, whose objects that reconciliation proved absent, leave the register; every other record stays. Job IDs are 128-bit random values, also unique without the dropped tombstones.
8. The supervisor is the only launcher of the broker unit (`runner/broker-launch.js`): after reconciliation, and after retiring a healthy instance. It watches each launch until the broker registers. A broker unit that settles `failed` or `inactive` with no queued job and no registered instance is logged as `broker_not_registered` and started again after 1, 2, 4, 8 and 16 seconds; after that the supervisor logs `broker_launch_blocked` once and waits for an operator restart. Registration resets the backoff. A launch that stays `active` for 30 seconds without registering is logged once as `broker_registration_overdue`; a registration that fails after the instance was bound unbinds it and launches again; a retirement cut short by a supervisor stop starts no unit job and logs nothing; a second lifecycle connection is closed before admission and logged as `lifecycle_connection_dropped`. The unit keeps `Restart=no` and the activation-policy check; a lifecycle peer is admitted only if it is the unit's main process (uid 0, `MainPID`, `InvocationID`, the fixed `ControlGroup`, the same `/proc/<pid>/cgroup`, not exited), queried asynchronously with a 15 s budget, so a slow PID 1 under boot load no longer refuses the peer the way the 1.5 s synchronous query of iteration 4 could. A refused peer is logged as `broker_peer_refused` with the failed condition, pid and unit name only.

## The edition input

Everything that varies per installation or per day is in the input; everything
else is in the bundle. `server/render/renderer-bundle/edition-input.js` is the
contract: the public projection of the deck with every asset reference already an
inline data URL, the effective theme record with the dynamic `default` resolved,
the frozen font CSS and the meta description. Two fields are request values of
the read path and never stored: `canonicalUrl`, the edition's canvas address
from its record, from which the entry derives every link and the card in the
document; and `lang`, the language version to render. The entry checks every
language list for slides it cannot seal, not only the main one, since the input
reaches it from a store.

There is deliberately **no slide-type registry field**. The renderer's registry
is the one frozen in its own bundle, which is exactly what keeps a core slide
type's later render changes away from a published edition.

### Preparing an edition input

`prepareEditionInput()` in `server/export/edition-input.js` is the one producer. It takes a deck, the effective theme record (required: without one the renderer falls back to the installation's own default logo, which no input carries) and the deck organization's storage scope, and returns **bytes**: the canonical input, and the manifest derived from it. Nothing is stored here; keeping the bytes is the edition store's job ([publication-editions.md](publication-editions.md)). In order:

1. **Snapshot.** Deck and theme are cloned before the first `await`, so a write to the source after the call starts cannot reach the input.
2. **Public projection.** `filterForPublished()` from `server/utils/public-output.js` over every language version (no second projection), then an allowlist. Deck: `title`, `description`, `lang`, `settings.autoAdvance`, `slides`, and per language version `title`, `description`, `slides` plus `i18n.active`/`dominant`. Theme: the keys a renderer reads (`label`, `cssVars`, `assets`, `slideBackgrounds`, `backgroundPresets`, `defaultBackground`, `defaultTitleSlide`, `slideTypes`, `titleLayout`, `locks`). Deck and theme ids, organization, collaborators, the publication descriptor and translation sources stay out.
3. **Closed assets.** Every served ref in every slide list and in the theme (a whole value, or a `url(…)` inside a CSS value such as `--t-logo-url`) is read once and inlined as a data URL, through the same image transform the live published page applies. Uploaded fonts are inlined through `buildEmbeddedFontCss()`; the `/fonts/managed/` address does not appear in the input.
4. **Refusals, as one list.** Everything below is collected first and refused together as `renderer_edition_input_unsealable`, with `details.problems` (`{reason, lang, slideId, message}`), so an author sees the whole list at once (D362).

| `reason`             | When                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `unknown_slide_type` | A type the bundle does not carry (a database-backed type). Shared rule with the render entry: `sealable.js`. |
| `author_markup`      | Author markup in a `markup: true` field. Same shared rule.                                                   |
| `asset_unreadable`   | A served ref this installation cannot read.                                                                  |
| `live_embed`         | A slide renders an `<iframe>`, `<frame>`, `<embed>` or `<object>`: its content can change after publication. |
| `remote_resource`    | A slide or the theme would fetch something that is not a data URL (a remote image, a leftover served path).  |
| `external_font`      | The theme loads fonts from a font service (`externalFontLinks`).                                             |
| `foreign_font`       | An uploaded font that is not one of the deck organization's own font variants.                               |
| `font_unreadable`    | A font face whose bytes cannot be read; an export would fall back silently, an edition may not.              |
| `too_large`          | The sealed input exceeds the runner's 16 MiB request limit.                                                  |

The remote-load check renders each slide with the current registry and reads the resource attributes and `url()`s of the result. Icon SVGs the renderer itself emits (`/client/vendor/lucide-icons/…`) are exempt; they are renderer bytes, in the same open position as the highlighter (§ Limits).

### The edition-input manifest

`server/render/renderer-bundle/edition-manifest.js` defines the canonical form (object keys sorted at every depth, no whitespace, one trailing newline; `canonicalJson()` refuses non-finite numbers and `undefined` array members rather than letting `JSON.stringify` change them) and derives the manifest (`deckyard.edition-input-manifest/1`) from the input bytes alone: the input's hash and length, separate hashes for the public deck, the theme and the font CSS, the asset inventory (every inline data URL by SHA-256, media type and length, deduplicated and sorted), the projection version and the versioned list of checks the input passed. `verifyEditionInput()` checks a manifest and input pair offline and names each problem separately (`input_hash_mismatch`, `manifest_mismatch`, `manifest_not_canonical`, …); one changed byte in either file is red. Series, version, publication time and renderer hash belong to the edition record that wraps this manifest, not to it. A hash proves equality with the bytes received, not authorship or time.

### Refusals

The render entry refuses rather than renders when it cannot derive the document
from the input alone. A fallback to the current renderer would serve different
content under a citation, which is the thing the whole design prevents.

| Code                                  | When                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `renderer_edition_input_invalid`      | Unknown input schema, or no presentation.                                                                                                                    |
| `renderer_edition_input_unsealable`   | A slide type the bundle does not carry, author markup in a `markup: true` field, or a request larger than the runner's 16 MiB limit (refused by the client). |
| `renderer_bundle_unknown`             | No bundle with that hash in the store; from the runner, `bundle_refused`.                                                                                    |
| `renderer_bundle_malformed_hash`      | Not a 64-character lowercase hex digest.                                                                                                                     |
| `renderer_bundle_corrupt`             | The manifest or a file does not match its digest, or the manifest is not canonical.                                                                          |
| `renderer_bundle_incomplete`          | A named file is missing, or an unnamed file is present.                                                                                                      |
| `renderer_bundle_sandbox_unavailable` | No runner is configured, or it is busy, expired the queue, closed the connection or did not answer.                                                          |
| `renderer_bundle_worker_failed`       | The worker crashed, timed out, refused, or its answer exceeded the response limit.                                                                           |

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
- **The highlighter bytes come from the bundle.** An edition document carries
  Prism and KaTeX inline from its own bundle, not linked from the serving
  installation's `/client/vendor/…`. The icon SVGs the renderer emits
  (`/client/vendor/lucide-icons/…`) are still linked: they are the one
  renderer byte a reader fetches from the installation.
- **Fonts and images are not in the bundle.** They are bytes of the edition, not
  of the renderer, and belong in the edition input. A bundle therefore renders
  with no font faces at all unless the input brings them.
- **A fork CSS seam may still reference its own assets by URL.** `custom/styles/`
  is frozen, but a `url(/custom/assets/…)` inside it resolves against the
  serving origin at view time. Closing that needs the same per-edition serving
  as the highlighter bytes.
- **Storage follows renderer revisions in use**, not releases. Measure bundle size with the builder rather than assuming a fixed size.
