# The `npm test` IPC deserialize flake (B50)

`npm test` runs the suite with `node --test`, which by default gives each test
file its own child process (`--test-isolation=process`) and streams that child's
results back to the parent over a **v8-serialized IPC channel**. On Node
**v24.18.0** this occasionally failed with:

```
test at <the noisy file>:1:1
✖ <the noisy file>
  Error: Unable to deserialize cloned data due to invalid or unsupported version.
      at #processRawBuffer (node:internal/test_runner/runner:469:20)
      at FileTest.parseMessage (node:internal/test_runner/runner:376:29)
      at Socket.<anonymous> (node:internal/test_runner/runner:524:15)
```

Measured frequency before the fix: **~27% of parallel runs** (4/15) exited
non-zero, always attributed to the same file — the one that printed most.

## Root cause

This is a **Node core bug in the test runner's IPC reader**, not a product bug
and not a real test failure. A child process forwards its captured `stdout`
back to the parent _over the same v8-serialized channel_ as the structured test
results. When a file emits a burst of `stdout`, the parent's `#processRawBuffer`
can mis-frame the byte stream and fail to deserialize a message — surfacing as a
spurious failure of whichever file produced the burst.

The reliable trigger was the test of the file-based data importer: the
migration functions it exercised doubled as a CLI and printed emoji-laden
progress banners via `console.log`. Those lines were captured and forwarded as
IPC messages; the burst tripped the framing bug. Nothing about the trigger was
specific to that code — any test whose subject prints a lot does it.

## Options considered

| Option                                                  | Result                                                                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--test-isolation=none` (one process, no per-file IPC)  | **Broke the suite**: 1904 fails / 0 pass. Files rely on per-process isolation (module-level mocks, env, global state) and bleed into each other. Not viable without a large test rewrite. |
| `--test-concurrency=1` (serial, still process-isolated) | Deterministically clean, but **~130 s vs ~13.5 s** — a 10x slowdown on every run.                                                                                                         |
| `--test-concurrency=4`                                  | Reduced but **did not eliminate** the flake (still 1/10). Any concurrency > 1 keeps the racy IPC path.                                                                                    |
| **Silence the trigger's stdout burst**                  | **0 deserialize errors across 20 full-parallel runs**, at full ~13.5 s speed. Chosen.                                                                                                     |

## The fix

The trigger test silenced `console.log/error/info/warn` for the duration of its
run (restored in `after`). It asserted on return values and database state,
never on the banners, so nothing was hidden. Removing the stdout burst removed
the trigger, and the suite went green in parallel at full speed.

Both that test and the CLI under it were **retired in B385**, together with the
file-based importer they covered — file-based Deckyard installs do not exist.
So the repo now carries no live instance of the silencing pattern, and no test
emits a burst big enough to trip the bug. The rule below is the whole
mitigation; this page is the diagnosis to reach for when it stops holding.

## Guidance for new tests

The underlying Node bug is still latent. To avoid re-triggering it:

- **Don't let a test emit a large burst of `stdout`.** If the code under test
  logs (a CLI / migration script), suppress or capture that output in the test
  rather than letting it flow to the console.
- If a _new_ file starts flaking with the `#processRawBuffer` "Unable to
  deserialize cloned data" error, it is almost certainly the same bug — look for
  noisy `console.*` output in that file's code path and silence it, rather than
  reaching for `--test-concurrency=1`.

Upstream tracking notes live alongside this doc in
[`node-test-ipc-upstream-issue.md`](node-test-ipc-upstream-issue.md).
