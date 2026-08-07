# Upstream issue draft — node --test IPC deserialize failure under process isolation

> Draft only. Not filed. If the flake resurfaces on a newer Node, check whether
> this is already reported at https://github.com/nodejs/node/issues before
> filing, then use the text below as a starting point.

**Title:** `node --test`: "Unable to deserialize cloned data" from
`#processRawBuffer` when a test file emits a burst of stdout under process
isolation

**Version:** v24.18.0 (Linux x64)

**Platform:** Linux 6.8.0 x86_64, 16 CPUs

**Subsystem:** test_runner

## What steps will reproduce the bug?

Run a suite of a few hundred test files in parallel with the default
process isolation, where at least one file's code path writes a burst of lines
to `stdout` (e.g. a CLI/migration module that `console.log`s progress):

```
node --test 'tests/**/*.test.js'
```

Intermittently (~1 in 4 runs in our suite of ~280 files / ~3160 tests) the run
exits non-zero with the offending file reported as failing:

```
✖ tests/<the-noisy-file>.test.js
  Error: Unable to deserialize cloned data due to invalid or unsupported version.
      at #processRawBuffer (node:internal/test_runner/runner:469:20)
      at FileTest.parseMessage (node:internal/test_runner/runner:376:29)
      at Socket.<anonymous> (node:internal/test_runner/runner:524:15)
      at Socket.emit (node:events:509:28)
      at addChunk (node:internal/streams/readable:563:12)
      at readableAddChunkPushByteMode (node:internal/streams/readable:514:3)
      at Readable.push (node:internal/streams/readable:394:5)
      at Pipe.onStreamRead (node:internal/stream_base_commons:189:23)
```

## How often does it reproduce?

~27% of parallel runs (4/15) in our environment. The failure is always
attributed to the file that produces the largest/most-frequent stdout burst.

## What is the expected behavior?

The runner should reassemble the child's IPC stream correctly regardless of how
much captured stdout the child forwards, and produce a clean pass/fail summary.

## What do you see instead?

The parent's `#processRawBuffer` fails to deserialize a message from the child's
socket, presumably because the length-prefix framing of the v8-serialized
message stream is not correctly reassembled across chunk boundaries when a
child's forwarded stdout is interleaved with structured test-result messages.

## Additional information

- Correlates strictly with concurrency: `--test-concurrency=1` is always clean;
  `--test-concurrency=4` still reproduces (rarer).
- Correlates with the volume of a child's forwarded stdout: silencing the noisy
  file's `console.*` output eliminated the failure across 20 consecutive
  parallel runs.
- `--test-isolation=none` sidesteps the IPC path entirely but is not a general
  workaround (it removes per-file process isolation).
