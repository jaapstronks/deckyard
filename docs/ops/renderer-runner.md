# Historical renderer operator runner

The operator-only historical renderer runner for Linux. The full P1-P16 acceptance passed on code SHA `2483554d` and the independent code review approved the merged head (`34183b53`, merged as `15f61d2e`). Runner iteration 2 (launcher EPIPE, copy resolution beneath a held store root, register compaction) and iteration 3 (framed `bundle_refused` and `worker_failed`, D364) each changed `runnerId` and passed the full gate again, iteration 3 on code SHA `0dd7d8ea` (runnerId `7ae4568f…`). The activation change connects production `host.js` to the broker socket: an installation renders frozen editions only when `RENDERER_RUNNER_SOCKET` names that socket, and refuses every render with `renderer_bundle_sandbox_unavailable` when it does not. Installing or starting these services alone connects nothing to publication, v1 or MCP. Development probes are not the acceptance gate.

The trusted base is OS-root, the rootful broker, the independent rootful supervisor, the pinned runtime, Node, bootstrap and image. This protects against historical guest code, not against a compromised rootful render service or administrator. The caller gets a Unix request socket, never runtime access, a general command interface or the supervisor socket.

## Requirements and identities

Only Linux x86_64 with cgroup v2, cpu/memory/pids controllers, `clone3(CLONE_INTO_CGROUP|CLONE_PIDFD)`, `openat2` resolve restrictions, seccomp TSYNC, user/mount/PID/network/IPC/UTS namespaces and systemd with `DelegateSubgroup` is supported. `SO_PEERPIDFD` is mandatory; there is no PID-only peer fallback. Unsupported kernels or policies refuse readiness. The first pinned toolchain is Node 24.22.1 and the library digests in `server/render/renderer-bundle/runner/build.js`; another host library set requires a new reviewed pin and new evidence.

Choose one numerical webapp UID and a dedicated caller group. Reserve a free, separate 65,536-ID host UID/GID range. The installer checks `/etc/subuid`, `/etc/subgid`, `/etc/passwd` and `/etc/group`, and records `deckyard-render:<start>:65536` in both subordinate registries. Guest UID/GID 1000 maps into that range and never to host root or the caller. Rootful runtime operation does not depend on granting the caller sudo, runtime groups or mappings.

The store, the job staging and the register under `/var/lib/deckyard-render`, and the directory a bundle is registered from, may each live on their own mount. The native copy opens the store root (or the registration source) and the target as held directory descriptors, resolved from `/` without following any symlink, and applies `RESOLVE_NO_XDEV` only beneath them: a mount for `/var`, the state directory or the source works, while a symlink, bind or mount inside a bundle still refuses.

## Build and fresh installation

Run from a checkout on the build branch. All output goes to a new scratch directory; the build command never installs or starts a service.

```sh
sh server/render/renderer-bundle/runner/build-runtime.sh .scratch/runner-crun
node server/render/renderer-bundle/runner/index.js build .scratch/runner-build .scratch/runner-crun/crun
sudo /absolute/path/to/node server/render/renderer-bundle/runner/index.js install /absolute/path/to/.scratch/runner-build 1001 1001 700000000
```

The numbers above are examples. Installation is fresh-only and refuses existing paths or unit files. It copies the image and host control code into `/opt/deckyard-render`, makes all installed inodes root-owned, removes write access from host control source files, writes `/etc/deckyard-render.json` (0600), creates root-private state/store/jobs and runtime paths, and installs two units plus a tmpfiles policy. It does not enable or start them; only the supervisor unit can be enabled (`WantedBy=multi-user.target`), the broker unit has no `[Install]` section because only the supervisor starts it. Inspect the generated configuration, subordinate ranges, unit files and image inventory before the operator test run.

`build.json` binds Node, crun, native control, the launcher and every image inode's path, mode and content digest. Service startup rechecks the installed content and mode inventory, root ownership, service-file digests, the pinned host dynamic libraries and private directory policy. Stop these services before OS package changes; an updated host library set requires new reviewed pins and evidence. `runnerId` hashes a canonical ordering of this runtime policy, code/image digests and mappings; object property order and the installation nonce do not change it. `rendererHash` remains the existing bundle content identity.

Register a bundle by copying into a new private candidate, verifying every declared byte, freezing it and renaming it into the root-only store. Existing hashes refuse replacement. A request makes and verifies a fresh private copy again.

```sh
sudo /opt/deckyard-render/image/bin/node /opt/deckyard-render/code/runner/index.js register /absolute/path/to/source-store <renderer-hash>
sudo systemctl start deckyard-render-supervisor.service
systemctl status deckyard-render-supervisor.service deckyard-render-broker.service
```

The supervisor alone launches the fixed broker unit after reconciliation. Before opening its caller socket, every broker invocation runs a fixed content-addressed capability probe through the same reservation, private copy, native syscall filter, native runtime and cleanup path. It checks scratch I/O, socket refusal and a new JS Worker. Missing runtime features leave admission closed after cleanup; the journal reports `self_test_not_ready` and only an operator restart retries. The broker has `Restart=no`, no activation unit and no start-rate limit; failed jobs, except an unregistered hash and a well-formed guest refusal (both framed, see Wire contract), require a new broker invocation after complete producer stop and cleanup. This avoids treating repeated guest failures as supervisor crashes. Only the supervisor has an automatic systemd restart. Drop-ins, force-restart policy or socket/path/timer activation of the broker invalidate readiness. Both service files and the tmpfiles policy are pinned. The supervisor manager has its own 256 MiB/64-task subgroup; the delegated parent has 1 GiB, above the sum of manager, guest and helper limits, so guest memory exhaustion cannot consume the monitor's allowance. Both services deny legacy kernel AIO and all three io_uring syscalls from their first instruction through systemd filters, inherited by producer threads and helpers. Startup verifies the loaded systemd policy, actual syscall refusals and absence of pre-opened ring FDs. This is local to these services; no global kernel or environment workaround is used.

As the configured caller UID, send a request file through the fixed operator entry:

```sh
node server/render/renderer-bundle/runner/index.js call /absolute/path/to/request.json
```

The file has exactly `schema`, `requestId`, `rendererHash` and `input`. Its schema is `deckyard.renderer-runner.request/1`; input uses `deckyard.edition-input/1`. The broker authenticates the numerical peer UID before body reading, admits at most six connections, four validated queued requests and one active job. Read/write deadlines are 5 seconds, queue expiry is 40 seconds, preparation is at most 10 seconds and the whole active job is at most 30 seconds. These are absolute limits, not idle timeouts.

## Lifecycle and cleanup

The root-only register is durable before reserve-ack and before any producer can make a job directory or launch a runtime. The broker uses one single-use Worker as a closed producer executor per job. Its synchronous native copy, awaited verification, runtime child and completion callbacks must end and the Worker must exit before `QUIESCENT`. No new producer message handler remains in that Worker. The fixed native launcher starts crun atomically inside the pre-registered helper cgroup; the pinned crun does the same for the guest. The launcher relays Node's socketpair stdio through three actual anonymous pipes, closes all other inherited FDs before crun exec and joins pipe I/O and waitpid. A runtime that exits by a signal or with a non-zero status ends the launcher at once, so runtime loss is a job failure rather than a wait for the deadline. Before the final filter the guest is made non-dumpable: a host `core_pattern` that pipes to a crash helper ignores `RLIMIT_CORE`, and a dumpable guest crash would otherwise start a host process with the guest's memory. The full syscall contract and the producer/join paths are in the [reference](../reference/renderer-bundle.md#operator-runner-boundary-contract).

Normal cleanup accepts only the correct instance/generation/job after external helper/guest groups are empty. Cancellation kills the full broker cgroup plus helper and guest subtrees, then waits for the held broker pidfd and all populated flags. Only then are runtime state, the per-job crun cache, mounts, private staging and cgroups removed. `CLEANED` is durable before success or slot release. No lazy unmount counts as cleanup. Late or duplicated lifecycle messages cannot reopen a phase or reuse a job ID.

After supervisor loss, the replacement starts with admission closed, revokes existing generations, kills the fixed broker service group and registered helper/guest groups, waits for emptiness, then reconciles all exclusive prefixes. Its old pidfds died with the supervisor; the complete fixed service-cgroup stop covers old broker threads and descendants before any cleanup or new registration. Unknown objects, a missing/corrupt register, unfinished producer stop or a changed service policy leave it unavailable. Never replace the register with an empty file as recovery evidence.

Each supervisor start, after that reconciliation has proved every `CLEANED` record's objects absent, drops those records before it mints the new generation and logs `ledger_compacted`; every other record is kept. The register therefore holds the jobs of the running generation, not every job the installation ever ran. A compacted ID is no longer known: should an object of such a job ever reappear (only possible if a producer survived the barrier, which reconciliation rules out), the next start reports it as `unexplained runner object` rather than `object after CLEANED`. Both block ready; only the label differs.

Use the journal and durable register to inspect phases without logging input or guest HTML:

```sh
sudo journalctl -u deckyard-render-supervisor.service -u deckyard-render-broker.service
sudo cat /var/lib/deckyard-render/register.json
```

`instance_retirement_blocked` in the supervisor journal means retiring a broker instance failed after its producers were stopped, typically a `systemctl` stop or start of the broker unit that timed out. The supervisor then runs without a broker and admission stays closed; it does not retry on its own. Inspect the broker unit, then restart the supervisor service as an operator, which reconciles before it starts a new broker.

If cleanup exceeds 5 seconds after revocation, admission remains closed and the slot stays occupied. Resolve the recorded phase as an operator; do not start another broker, delete a live job or unmount lazily. A healthy successor is evidence only after the old producer groups are empty and all old objects are absent. Deliberately injected test mounts and corrupt-register fixtures must be restored from their recorded test state, never guessed around.

## Updating and removal

There is no live update or automatic repair command. Stop the supervisor and broker, prove producer groups empty and runtime/job objects absent, preserve the register and inventories, then prepare a fresh reviewed installation. A changed runtime, native addon, bootstrap, image, host control module, unit or mapping changes `runnerId` and requires the boundary and A/B gates again. Never replace `/usr/bin/crun` or change a global Node/kernel policy to make this runner pass.

For a temporary development installation, first `sudo systemctl disable deckyard-render-supervisor.service` (it removes the `multi-user.target.wants` link), then remove only the recorded Deckyard service files, tmpfiles file, installation/config/state/runtime paths and the exact reserved subordinate-ID lines after the same stop-and-empty checks. Keep test fixtures and logs outside the repository root. A production installation follows [Production installation on a Coolify host](#production-installation-on-a-coolify-host); stored edition migration is outside this runner.

The kernel interfaces are documented in [openat2(2)](https://man7.org/linux/man-pages/man2/openat2.2.html), [unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html) and the [cgroup v2 guide](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html). Those interfaces do not replace Deckyard's P1-P16 evidence or its independent code review.

## Connecting the webapp

The webapp is the caller. It reaches the runner through exactly one setting, `RENDERER_RUNNER_SOCKET`: the absolute path of the broker socket as the server process sees it. Unset, blank, relative or a `host:port`/URL spelling, and every frozen-edition render refuses with `renderer_bundle_sandbox_unavailable` before the server looks at the bundle or the input; there is no TCP form, no retry and no fallback to the current renderer or to the trusted-fixture test helper. With the setting, `renderEditionInBundle(rendererHash, input)` sends one request frame per connection and reads one response frame of at most 64 MiB within 80 seconds (queue expiry, the whole job and both 5-second deadlines). A request larger than the runner's 16 MiB limit is refused before connecting.

The framed answers map onto the closed refusal set (activation review A5); the runner's own words never cross into the webapp:

| Runner answer                                                                                                             | Webapp refusal                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| success                                                                                                                   | `{canvas, reader, rendererHash, runnerId}`; an edition record keeps `runnerId` beside the renderer hash (A4) |
| `bundle_refused`                                                                                                          | `renderer_bundle_unknown`                                                                                    |
| `worker_failed`, `output_limit`                                                                                           | `renderer_bundle_worker_failed`                                                                              |
| `invalid_request`                                                                                                         | `renderer_edition_input_invalid`                                                                             |
| `busy`, `queue_timeout`, `sandbox_unavailable`, any other code, a closed connection, a malformed frame, no answer in 80 s | `renderer_bundle_sandbox_unavailable`                                                                        |
| request over 16 MiB (refused by the webapp, nothing sent)                                                                 | `renderer_edition_input_unsealable`                                                                          |

Whether a refused publication is tried again is the publication service's decision, not the client's.

The 16 MiB request limit has to hold the whole edition, and the edition input carries every image as a data URL. Before frozen editions are produced on an installation, measure what its decks would need: `node scripts/scan-edition-input-size.js` (in a container: the application's terminal) estimates per deck the public slide JSON plus every referenced served asset in base64, and reports the maximum, the 95th percentile and the number of decks above 16 MiB (`--json` for the full list). It reads only and leaves out theme and font CSS, so the numbers are a lower bound. Decks above the limit mean the limit or the asset form must change before publication relies on the runner (activation review A3).

`npm run doctor` (in a container: `node scripts/doctor.js`) has a `renderer-runner` check. With the socket set it sends one real request: the renderer hash this image carries and an empty edition. Green names the `runnerId` that answered; red separates an unregistered renderer (`bundle_refused`, nothing ran: register it) from an unavailable runner. The probe costs the runner no instance: an unregistered hash is refused at admission, and an empty edition is an ordinary job.

## Registering a release

Every image builds the renderer it publishes with into `/app/renderer-store/<hash>` (`Dockerfile`, stage `renderer-bundle`); the hash changes whenever the renderer's code, styles or vendored highlighter bytes change, so almost every release has a new one. Until a root operator registers that hash, publication with the new release refuses with `renderer_bundle_unknown` and the doctor is red. After each deploy, on the runner host:

```sh
scripts/export-renderer-bundle.sh <container> /var/tmp/deckyard-render-export-<version>
sudo /opt/deckyard-render/image/bin/node /opt/deckyard-render/code/runner/index.js register /var/tmp/deckyard-render-export-<version> <hash>
docker exec <container> node scripts/doctor.js
```

The export script takes the container's name (Coolify shows it on the application's page; `docker ps` lists it), refuses unless the container carries exactly one bundle, copies it with `docker cp` into a new directory and prints the exact register command. Registration verifies every byte again, freezes the copy and refuses a hash that is already registered, so running it twice is harmless. Keep the earlier registrations: an edition published with an older release names the older hash. Remove the export directory afterwards; the store holds the registered copy.

## Production installation on a Coolify host

This is the deploy contract change frozen-edition rendering asks for (D363): the webapp keeps running as a container, and the runner runs as a rootful systemd service **outside Docker** on the same host. The container gets only the broker socket, through a bind mount; never a Docker socket or the supervisor socket.

1. **Check the host.** Linux x86_64 and the [requirements above](#requirements-and-identities), including the pinned host libraries: the pins are those of the acceptance host (Ubuntu 24.04, systemd 255); another library set refuses at build and needs a new reviewed pin.
2. **Find the caller identity (A1).** The broker compares the numerical uid of the connecting process as the host sees it (`SO_PEERCRED`). Run `docker info --format '{{.SecurityOptions}}'`: without `name=userns`, the host uid is the container uid; with userns-remap it is the remap base plus the container uid. The image runs as `node`, uid 1000. Run `getent passwd <host uid>`: on many hosts 1000 is the administrator's login account (on dev-server-1: `ubuntu`). If it is a login account, run the container under its own unused uid instead, outside the subordinate range you reserve in step 4, and `chown` its uploads and data volumes to that uid. While the container runs, `ps -eo uid,args | grep server/server.js` on the host shows the uid the broker will see.
3. **Make a caller group.** `sudo groupadd --system deckyard-render-caller` and note its gid. The socket is `0660 root:<gid>` in a `0750 root:<gid>` directory; the container joins this group, never gid 1000.
4. **Build and install** as in [Build and fresh installation](#build-and-fresh-installation), with the uid from step 2 and the gid from step 3: `install <build> <uid> <gid> <subid-start>`. Inspect `/etc/deckyard-render.json` before starting.
5. **Register the image's bundle** as in [Registering a release](#registering-a-release), then `sudo systemctl enable --now deckyard-render-supervisor.service`: enabled, the supervisor starts at every boot and starts the broker after reconciliation.
6. **Connect the container.** In the Coolify application: a bind mount (Persistent Storage, host directory) from `/run/deckyard-render` to `/run/deckyard-render`; the uid from step 2 and the extra group from step 3 as the container's user and supplementary group (Custom Docker Options `--user <uid>:<uid> --group-add <gid>`, or `user:` and `group_add:` in a compose deployment); and the environment variable `RENDERER_RUNNER_SOCKET=/run/deckyard-render/broker.sock`. Redeploy, then check in the application's terminal: `id` lists the uid and the group, and `node scripts/doctor.js` shows `renderer-runner` green.

**After a host reboot** the tmpfiles policy recreates `/run/deckyard-render` early in boot, before Docker starts the container, so the bind mount finds the directory. The enabled supervisor starts with `multi-user.target`; it treats every job and instance it finds as terminal, cleans up, and then starts the broker once. That single launch is not yet proven to survive a real boot: on the one host reboot measured (dev-server-1, runner iteration 4, 2026-10-28) the supervisor came up without an operator, but the broker it started exited within two seconds without a journal line and nothing relaunched it, so admission stayed closed until an operator ran `sudo systemctl start deckyard-render-broker.service`. Until runner iteration 5 makes the supervisor relaunch a broker that dies before registration and log why it rejected one, check both units after every reboot (`systemctl status deckyard-render-supervisor.service deckyard-render-broker.service`) and the doctor once the container is up, and start a `failed` broker by hand. An installation from before runner iteration 4 has a supervisor unit without `[Install]` and does not start at boot; it needs a fresh installation, not an edited unit (the unit digest is part of `runnerId`).

## Adversarial development fixtures

Build a separately registered adversarial worker with the pinned Node headers and a native direct-syscall probe. This changes only the bundle's manifest worker and declared files; it does not preload historical code before the mandatory syscall filter or change the trusted image.

```sh
node scripts/build-renderer-runner-fixture.js .scratch/fixture-store .scratch/new-fixture-build
sudo /opt/deckyard-render/image/bin/node /opt/deckyard-render/code/runner/index.js register /absolute/path/to/.scratch/fixture-store <printed-hash>
```

Fixture modes exercise direct syscalls, new native/JS threads, environment/FD/mount inventory, invalid output, resource exhaustion and a healthy scratch-free successor. They are evidence inputs, not an isolation assertion or a substitute for the independent external observer. Keep raw commands, code SHA, every runtime/image/profile identity, cgroup/mount/inode/listener observations and the failure timeline. Development success for a subset must remain labelled as incomplete P1-P16.

Upstream ran the complete record below (P1-P16) on code SHA `2483554d` and again for each runner iteration (Linux 6.8 x86_64, systemd 255): every gate passed from a fresh installation, followed by full removal. P16 as redefined and P17 belong to the activation change and run against the activation PR's code; they do not change `runnerId`. Hosted CI explicitly reports the renderer Linux acceptance gate as **NOT EXECUTED**. Its unit-suite result does not certify P1-P16, and optional unit skips do not count as OS evidence.

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

The broker validates the envelope with a strict byte-level scan and keeps the input as the caller's own validated bytes; a queued request costs its body, not a parse tree. The framed success body has exactly `schema`, `requestId`, `ok: true`, `rendererHash`, `runnerId`, `canvas` and `reader`. Its schema is `deckyard.renderer-runner.response/1`; both document values are strings. The broker supplies the runtime identity. A framed refusal has exactly `schema`, `requestId`, `ok: false` and `code`; its correlation ID is null if no valid one was decoded. Seven codes are framed: `invalid_request`, `busy`, `queue_timeout` and `bundle_refused` from admission, `worker_failed` for a well-formed guest refusal, `output_limit` when the serialized response would exceed its bound, and `sandbox_unavailable` as the fallback. `bundle_refused` means the renderer hash is not a registered directory in the store: the broker checks that before queueing, so no job, register record or staging exists, and registering the bundle makes the same instance serve the next request. `worker_failed` is framed only when the launcher exits 0 and the guest wrote exactly `{ok:false, code, message, details}` with a code from the bundle's closed refusal set; that job ends through the same quiescence and cleanup barrier as a success, and the guest's code, message and details stay in the broker. A wrong peer UID is closed unread, without a frame. Every other job failure (a copy or verification failure during a job, malformed output, a non-zero exit, stdout or stderr overflow, deadline, caller disconnect) makes the broker cancel and the supervisor stop the whole broker instance, so the caller only sees a closed connection; `unauthorized`, `job_timeout` and `job_cancelled` exist in the protocol vocabulary and the ledger but never reach the wire. The complete serialized response body, including escaping, is at most 64 MiB. Cancellation of a broker instance closes its caller connections after independent cleanup; a closed connection is not a successful response and is never transparently replayed.

Guest output is separately capped at 64 MiB stdout and 1 MiB stderr. Success is exactly `{ok:true, canvas:<string>, reader:<string>, sealed:<object>}`; a refusal is exactly `{ok:false, code:<string>, message:<string>, details:<object|null>}`. A non-null, non-array `sealed` object is diagnostic data and is discarded completely, including any claims about isolation or identity. Extra top-level fields, truthy booleans and malformed outputs refuse success. Guest failures, stderr and private error details never cross the caller interface.

## External Linux acceptance record

Every gate requires the exact code SHA, runtime/image/native/profile digests, kernel and architecture, fixed limits and raw observations from outside the guest. Unit tests and guest-reported assertions cannot satisfy this record. A failure leaves the relevant gate incomplete.

| Gate | Scenario                                                    | Required external evidence                                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1   | Peer authorization and closed envelopes                     | Wrong UID is rejected before body read; invalid fields/types/UTF-8/duplicate keys start no copy or runtime.                                                                                                                                                                                                                   |
| P2   | Admission pressure and partial frames                       | Six connection tokens, four queued requests, absolute 5-second read deadline and bounded overflow.                                                                                                                                                                                                                            |
| P3   | Queue expiry and blocked response readers                   | Absolute 40-second queue expiry, 5-second response writer and slot release independent of caller reads.                                                                                                                                                                                                                       |
| P4   | Filesystem aliases and special files                        | Symlink roots/components, hardlinks, mount transitions and special files refuse before execution.                                                                                                                                                                                                                             |
| P5   | Source changes around copy/verify/freeze                    | Exact hash bytes or refusal, new job inodes, immutable active copy and fresh verification on the next request.                                                                                                                                                                                                                |
| P6   | Missing or incompatible native/runtime boundary             | Fatal refusal before the first historical instruction; errno and positive TSYNC results are failures.                                                                                                                                                                                                                         |
| P7   | Existing and newly created threads                          | Actual forbidden syscalls fail in both; historical execution follows successful TSYNC only.                                                                                                                                                                                                                                   |
| P8   | Direct process/namespace/ABI escape attempts                | Exec/fork/process-clone/clone3, ptrace, alternate ABIs and async kernel I/O fail; the permitted pthread works.                                                                                                                                                                                                                |
| P9   | IPv4/IPv6/TCP/UDP/Unix and JS/network bypasses              | External listeners receive nothing, with working positive controls including a listener in the guest network namespace.                                                                                                                                                                                                       |
| P10  | Host data and complete inventories                          | Real host canaries, other inputs, host PIDs and management sockets are inaccessible; mounts, env and FDs match the contract.                                                                                                                                                                                                  |
| P11  | CPU, memory, tasks, output and scratch limits               | Actual kernel counters and output limits, complete cleanup and a healthy successor without old scratch data.                                                                                                                                                                                                                  |
| P12  | Broker/runtime loss and paused producers                    | Stop precedes final inventory; late/resumed actions create nothing after cleanup; 5 seconds or unavailable with occupied slot.                                                                                                                                                                                                |
| P13  | Quiescence races, late messages and supervisor restart      | Irreversible executors and bindings, reconciliation before admission, negative cleanup controls and healthy successors.                                                                                                                                                                                                       |
| P14  | Guest response validation and discarded claims              | Wrong shapes/identity/booleans/trailing output fail; lies in a valid diagnostic object have no authority.                                                                                                                                                                                                                     |
| P15  | Renderer A/B, changed current inputs and rebuild/cache loss | Distinct content identities and documents, identical repeated A, canvas/reader from the same frozen input and pinned external screenshots.                                                                                                                                                                                    |
| P16  | Production configuration and unlock attempts                | Without `RENDERER_RUNNER_SOCKET` the production host refuses before any bundle path; with it, only that Unix socket is used: no TCP spelling, no fallback to the current renderer or to the trusted-fixture helper, which stays test-only.                                                                                    |
| P17  | The webapp through the bind mount                           | From a container of the image on the host: a real edition renders and its canvas and reader equal the trusted-fixture helper's for the same input and bundle byte for byte; an unknown hash is `renderer_bundle_unknown`; a stopped runner is `renderer_bundle_sandbox_unavailable`; a 17 MiB input is refused by the client. |
