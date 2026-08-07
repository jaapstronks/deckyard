# The `npm test` IPC deserialize flake (B50)

`npm test` runs the suite with `node --test`, which by default gives each test
file its own child process (`--test-isolation=process`) and streams that child's
results back to the parent over a **v8-serialized IPC channel**. On Node
**v24.18.0** this occasionally failed with:

```
test at tests/migrate-data-import.test.js:1:1
✖ tests/migrate-data-import.test.js
  Error: Unable to deserialize cloned data due to invalid or unsupported version.
      at #processRawBuffer (node:internal/test_runner/runner:469:20)
      at FileTest.parseMessage (node:internal/test_runner/runner:376:29)
      at Socket.<anonymous> (node:internal/test_runner/runner:524:15)
```

Measured frequency before the fix: **~27% of parallel runs** (4/15) exited
non-zero, always attributed to `tests/migrate-data-import.test.js`.

## Root cause

This is a **Node core bug in the test runner's IPC reader**, not a product bug
and not a real test failure. A child process forwards its captured `stdout`
back to the parent *over the same v8-serialized channel* as the structured test
results. When a file emits a burst of `stdout`, the parent's `#processRawBuffer`
can mis-frame the byte stream and fail to deserialize a message — surfacing as a
spurious failure of whichever file produced the burst.

`tests/migrate-data-import.test.js` was the reliable trigger because the
functions it exercises (`migrateTags`, `migrateSlideCollections`,
`migrateSlideLibraryUsage` in `scripts/migrate-data-to-postgres.js`) double as a
CLI and print emoji-laden progress banners via `console.log`. Those lines were
captured and forwarded as IPC messages; the burst tripped the framing bug.

## Options considered

| Option | Result |
| --- | --- |
| `--test-isolation=none` (one process, no per-file IPC) | **Broke the suite**: 1904 fails / 0 pass. Files rely on per-process isolation (module-level mocks, env, global state) and bleed into each other. Not viable without a large test rewrite. |
| `--test-concurrency=1` (serial, still process-isolated) | Deterministically clean, but **~130 s vs ~13.5 s** — a 10x slowdown on every run. |
| `--test-concurrency=4` | Reduced but **did not eliminate** the flake (still 1/10). Any concurrency > 1 keeps the racy IPC path. |
| **Silence the trigger's stdout burst** | **0 deserialize errors across 20 full-parallel runs**, at full ~13.5 s speed. Chosen. |

## The fix

`tests/migrate-data-import.test.js` silences `console.log/error/info/warn` for
the duration of its run (restored in `after`). The test asserts on return values
and database state, never on the banners, so nothing is hidden. Removing the
stdout burst removes the trigger, and the suite is green in parallel at full
speed.

## Guidance for new tests

The underlying Node bug is still latent. To avoid re-triggering it:

- **Don't let a test emit a large burst of `stdout`.** If the code under test
  logs (a CLI / migration script), suppress or capture that output in the test
  rather than letting it flow to the console.
- If a *new* file starts flaking with the `#processRawBuffer` "Unable to
  deserialize cloned data" error, it is almost certainly the same bug — look for
  noisy `console.*` output in that file's code path and silence it, rather than
  reaching for `--test-concurrency=1`.

Upstream tracking notes live alongside this doc in
[`node-test-ipc-upstream-issue.md`](node-test-ipc-upstream-issue.md).
