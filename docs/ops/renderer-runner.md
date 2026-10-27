# Historical renderer operator runner

This is an experimental, operator-only historical renderer implementation for Linux. Production `host.js` still refuses every execution with `renderer_bundle_sandbox_unavailable`. Installing or starting these services does not connect them to publication, v1 or MCP. Full P1-P16 acceptance and independent review of the exact code SHA are required before merge; a separate activation review remains necessary afterwards. Development probes are not that acceptance gate.

The trusted base is OS-root, the rootful broker, the independent rootful supervisor, the pinned runtime, Node, bootstrap and image. This protects against historical guest code, not against a compromised rootful render service or administrator. The caller gets a Unix request socket, never runtime access, a general command interface or the supervisor socket.

## Requirements and identities

Only Linux x86_64 with cgroup v2, cpu/memory/pids controllers, `clone3(CLONE_INTO_CGROUP|CLONE_PIDFD)`, `openat2` resolve restrictions, seccomp TSYNC, user/mount/PID/network/IPC/UTS namespaces and systemd with `DelegateSubgroup` is supported. `SO_PEERPIDFD` is mandatory; there is no PID-only peer fallback. Unsupported kernels or policies refuse readiness. The first pinned toolchain is Node 24.22.1 and the library digests in `server/render/renderer-bundle/runner/build.js`; another host library set requires a new reviewed pin and new evidence.

Choose one numerical webapp UID and a dedicated caller group. Reserve a free, separate 65,536-ID host UID/GID range. The installer checks `/etc/subuid`, `/etc/subgid`, `/etc/passwd` and `/etc/group`, and records `deckyard-render:<start>:65536` in both subordinate registries. Guest UID/GID 1000 maps into that range and never to host root or the caller. Rootful runtime operation does not depend on granting the caller sudo, runtime groups or mappings.

## Build and fresh installation

Run from a checkout on the build branch. All output goes to a new scratch directory; the build command never installs or starts a service.

```sh
sh server/render/renderer-bundle/runner/build-runtime.sh .scratch/runner-crun
node server/render/renderer-bundle/runner/index.js build .scratch/runner-build .scratch/runner-crun/crun
sudo /absolute/path/to/node server/render/renderer-bundle/runner/index.js install /absolute/path/to/.scratch/runner-build 1001 1001 700000000
```

The numbers above are examples. Installation is fresh-only and refuses existing paths or unit files. It copies the image and host control code into `/opt/deckyard-render`, makes all installed inodes root-owned, removes write access from host control source files, writes `/etc/deckyard-render.json` (0600), creates root-private state/store/jobs and runtime paths, and installs two static units plus a tmpfiles policy. It does not enable or start them. Inspect the generated configuration, subordinate ranges, unit files and image inventory before the operator test run.

`build.json` binds Node, crun, native control, the launcher and every image inode's path, mode and content digest. Service startup rechecks the installed content and mode inventory, root ownership, service-file digests, the pinned host dynamic libraries and private directory policy. Stop these services before OS package changes; an updated host library set requires new reviewed pins and evidence. `runnerId` hashes a canonical ordering of this runtime policy, code/image digests and mappings; object property order and the installation nonce do not change it. `rendererHash` remains the existing bundle content identity.

Register a bundle by copying into a new private candidate, verifying every declared byte, freezing it and renaming it into the root-only store. Existing hashes refuse replacement. A request makes and verifies a fresh private copy again.

```sh
sudo /opt/deckyard-render/image/bin/node /opt/deckyard-render/code/runner/index.js register /absolute/path/to/source-store <renderer-hash>
sudo systemctl start deckyard-render-supervisor.service
systemctl status deckyard-render-supervisor.service deckyard-render-broker.service
```

The supervisor alone launches the fixed broker unit after reconciliation. Before opening its caller socket, every broker invocation runs a fixed content-addressed capability probe through the same reservation, private copy, native syscall filter, native runtime and cleanup path. It checks scratch I/O, socket refusal and a new JS Worker. Missing runtime features leave admission closed after cleanup; the journal reports `self_test_not_ready` and only an operator restart retries. The broker has `Restart=no`, no activation unit and no start-rate limit; failed jobs require a new broker invocation after complete producer stop and cleanup. This avoids treating repeated guest failures as supervisor crashes. Only the supervisor has an automatic systemd restart. Drop-ins, force-restart policy or socket/path/timer activation of the broker invalidate readiness. Both service files and the tmpfiles policy are pinned. The supervisor manager has its own 256 MiB/64-task subgroup; the delegated parent has 1 GiB, above the sum of manager, guest and helper limits, so guest memory exhaustion cannot consume the monitor's allowance. Both services deny legacy kernel AIO and all three io_uring syscalls from their first instruction through systemd filters, inherited by producer threads and helpers. Startup verifies the loaded systemd policy, actual syscall refusals and absence of pre-opened ring FDs. This is local to these services; no global kernel or environment workaround is used.

As the configured caller UID, send a request file through the fixed operator entry:

```sh
node server/render/renderer-bundle/runner/index.js call /absolute/path/to/request.json
```

The file has exactly `schema`, `requestId`, `rendererHash` and `input`. Its schema is `deckyard.renderer-runner.request/1`; input uses `deckyard.edition-input/1`. The broker authenticates the numerical peer UID before body reading, admits at most six connections, four validated queued requests and one active job. Read/write deadlines are 5 seconds, queue expiry is 40 seconds, preparation is at most 10 seconds and the whole active job is at most 30 seconds. These are absolute limits, not idle timeouts.

## Lifecycle and cleanup

The root-only register is durable before reserve-ack and before any producer can make a job directory or launch a runtime. The broker uses one single-use Worker as a closed producer executor per job. Its synchronous native copy, awaited verification, runtime child and completion callbacks must end and the Worker must exit before `QUIESCENT`. No new producer message handler remains in that Worker. The fixed native launcher starts crun atomically inside the pre-registered helper cgroup; the pinned crun does the same for the guest. The launcher relays Node's socketpair stdio through three actual anonymous pipes, closes all other inherited FDs before crun exec and joins pipe I/O and waitpid. A runtime that exits by a signal or with a non-zero status ends the launcher at once, so runtime loss is a job failure rather than a wait for the deadline. Before the final filter the guest is made non-dumpable: a host `core_pattern` that pipes to a crash helper ignores `RLIMIT_CORE`, and a dumpable guest crash would otherwise start a host process with the guest's memory. The full syscall contract and the producer/join paths are in the [reference](../reference/renderer-bundle.md#operator-runner-boundary-contract).

Normal cleanup accepts only the correct instance/generation/job after external helper/guest groups are empty. Cancellation kills the full broker cgroup plus helper and guest subtrees, then waits for the held broker pidfd and all populated flags. Only then are runtime state, the per-job crun cache, mounts, private staging and cgroups removed. `CLEANED` is durable before success or slot release. No lazy unmount counts as cleanup. Late or duplicated lifecycle messages cannot reopen a phase or reuse a job ID.

After supervisor loss, the replacement starts with admission closed, revokes existing generations, kills the fixed broker service group and registered helper/guest groups, waits for emptiness, then reconciles all exclusive prefixes. Its old pidfds died with the supervisor; the complete fixed service-cgroup stop covers old broker threads and descendants before any cleanup or new registration. Unknown objects, a missing/corrupt register, unfinished producer stop or a changed service policy leave it unavailable. Never replace the register with an empty file as recovery evidence.

Use the journal and durable register to inspect phases without logging input or guest HTML:

```sh
sudo journalctl -u deckyard-render-supervisor.service -u deckyard-render-broker.service
sudo cat /var/lib/deckyard-render/register.json
```

If cleanup exceeds 5 seconds after revocation, admission remains closed and the slot stays occupied. Resolve the recorded phase as an operator; do not start another broker, delete a live job or unmount lazily. A healthy successor is evidence only after the old producer groups are empty and all old objects are absent. Deliberately injected test mounts and corrupt-register fixtures must be restored from their recorded test state, never guessed around.

## Updating and removal

There is no live update or automatic repair command. Stop the supervisor and broker, prove producer groups empty and runtime/job objects absent, preserve the register and inventories, then prepare a fresh reviewed installation. A changed runtime, native addon, bootstrap, image, host control module, unit or mapping changes `runnerId` and requires the boundary and A/B gates again. Never replace `/usr/bin/crun` or change a global Node/kernel policy to make this runner pass.

For a temporary development installation, remove only the recorded Deckyard service files, tmpfiles file, installation/config/state/runtime paths and the exact reserved subordinate-ID lines after the same stop-and-empty checks. Keep test fixtures and logs outside the repository root. A production installation or stored edition migration is outside this operator implementation.

The kernel interfaces are documented in [openat2(2)](https://man7.org/linux/man-pages/man2/openat2.2.html), [unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html) and the [cgroup v2 guide](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html). Those interfaces do not replace Deckyard's P1-P16 evidence or its independent code review.

## Adversarial development fixtures

Build a separately registered adversarial worker with the pinned Node headers and a native direct-syscall probe. This changes only the bundle's manifest worker and declared files; it does not preload historical code before the mandatory syscall filter or change the trusted image.

```sh
node scripts/build-renderer-runner-fixture.js .scratch/fixture-store .scratch/new-fixture-build
sudo /opt/deckyard-render/image/bin/node /opt/deckyard-render/code/runner/index.js register /absolute/path/to/.scratch/fixture-store <printed-hash>
```

Fixture modes exercise direct syscalls, new native/JS threads, environment/FD/mount inventory, invalid output, resource exhaustion and a healthy scratch-free successor. They are evidence inputs, not an isolation assertion or a substitute for the independent external observer. Keep raw commands, code SHA, every runtime/image/profile identity, cgroup/mount/inode/listener observations and the failure timeline. Development success for a subset must remain labelled as incomplete P1-P16.

Upstream ran the complete record below on code SHA `2483554d` (Linux 6.8 x86_64, systemd 255): every gate passed from a fresh installation, followed by full removal. Hosted CI explicitly reports the renderer Linux acceptance gate as **NOT EXECUTED**. Its unit-suite result does not certify P1-P16, and optional unit skips do not count as OS evidence.

## Wire contract

A connection carries one four-byte unsigned big-endian length, that many UTF-8 JSON bytes, then a write-half-close. Zero/oversized lengths, invalid UTF-8, duplicate keys, trailing bytes and a second frame refuse the request. The maximum request body is 16 MiB; JSON nesting is limited to 64 levels. The envelope has exactly these four fields:

```json
{
  "schema": "deckyard.renderer-runner.request/1",
  "requestId": "probe_1",
  "rendererHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "input": {
    "schema": "deckyard.edition-input/1",
    "presentation": { "slides": [] }
  }
}
```

`requestId` is 1–64 ASCII letters, digits, underscores or hyphens. The renderer hash is exactly 64 lowercase hexadecimal characters and must already be registered by an operator. Input uses the frozen edition-input contract; no path, command, environment, image, mount or limit override is accepted in the envelope. Correlation IDs never become internal job names.

The broker validates the envelope with a strict byte-level scan and keeps the input as the caller's own validated bytes; a queued request costs its body, not a parse tree. The framed success body has exactly `schema`, `requestId`, `ok: true`, `rendererHash`, `runnerId`, `canvas` and `reader`. Its schema is `deckyard.renderer-runner.response/1`; both document values are strings. The broker supplies the runtime identity. A framed refusal has exactly `schema`, `requestId`, `ok: false` and `code`; its correlation ID is null if no valid one was decoded. Codes are `invalid_request`, `unauthorized`, `busy`, `queue_timeout`, `bundle_refused`, `sandbox_unavailable`, `job_timeout`, `job_cancelled`, `worker_failed` and `output_limit`. The complete serialized response body, including escaping, is at most 64 MiB. Cancellation of a broker instance closes its caller connections after independent cleanup; a closed connection is not a successful response and is never transparently replayed.

Guest output is separately capped at 64 MiB stdout and 1 MiB stderr. Success is exactly `{ok:true, canvas:<string>, reader:<string>, sealed:<object>}`. A non-null, non-array `sealed` object is diagnostic data and is discarded completely, including any claims about isolation or identity. Extra top-level fields, truthy booleans and malformed outputs refuse success. Guest failures, stderr and private error details never cross the caller interface.

## External Linux acceptance record

Every gate requires the exact code SHA, runtime/image/native/profile digests, kernel and architecture, fixed limits and raw observations from outside the guest. Unit tests and guest-reported assertions cannot satisfy this record. A failure leaves the relevant gate incomplete.

| Gate | Scenario                                                    | Required external evidence                                                                                                                 |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| P1   | Peer authorization and closed envelopes                     | Wrong UID is rejected before body read; invalid fields/types/UTF-8/duplicate keys start no copy or runtime.                                |
| P2   | Admission pressure and partial frames                       | Six connection tokens, four queued requests, absolute 5-second read deadline and bounded overflow.                                         |
| P3   | Queue expiry and blocked response readers                   | Absolute 40-second queue expiry, 5-second response writer and slot release independent of caller reads.                                    |
| P4   | Filesystem aliases and special files                        | Symlink roots/components, hardlinks, mount transitions and special files refuse before execution.                                          |
| P5   | Source changes around copy/verify/freeze                    | Exact hash bytes or refusal, new job inodes, immutable active copy and fresh verification on the next request.                             |
| P6   | Missing or incompatible native/runtime boundary             | Fatal refusal before the first historical instruction; errno and positive TSYNC results are failures.                                      |
| P7   | Existing and newly created threads                          | Actual forbidden syscalls fail in both; historical execution follows successful TSYNC only.                                                |
| P8   | Direct process/namespace/ABI escape attempts                | Exec/fork/process-clone/clone3, ptrace, alternate ABIs and async kernel I/O fail; the permitted pthread works.                             |
| P9   | IPv4/IPv6/TCP/UDP/Unix and JS/network bypasses              | External listeners receive nothing, with working positive controls including a listener in the guest network namespace.                    |
| P10  | Host data and complete inventories                          | Real host canaries, other inputs, host PIDs and management sockets are inaccessible; mounts, env and FDs match the contract.               |
| P11  | CPU, memory, tasks, output and scratch limits               | Actual kernel counters and output limits, complete cleanup and a healthy successor without old scratch data.                               |
| P12  | Broker/runtime loss and paused producers                    | Stop precedes final inventory; late/resumed actions create nothing after cleanup; 5 seconds or unavailable with occupied slot.             |
| P13  | Quiescence races, late messages and supervisor restart      | Irreversible executors and bindings, reconciliation before admission, negative cleanup controls and healthy successors.                    |
| P14  | Guest response validation and discarded claims              | Wrong shapes/identity/booleans/trailing output fail; lies in a valid diagnostic object have no authority.                                  |
| P15  | Renderer A/B, changed current inputs and rebuild/cache loss | Distinct content identities and documents, identical repeated A, canvas/reader from the same frozen input and pinned external screenshots. |
| P16  | Production and environment unlock attempts                  | The production host still refuses unconditionally; no publication/v1/MCP route or current-renderer fallback.                               |
