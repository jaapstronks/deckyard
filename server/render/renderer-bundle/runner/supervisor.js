import net from 'node:net';
import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  chmodSync,
  closeSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  loadInstallation,
  loadControl,
  PATHS,
  trustedPath,
  SUPERVISOR_CGROUP,
} from './paths.js';
import { loadLedger, saveLedger, revokeRecord } from './ledger.js';
import { lifecycleChannel } from './channel.js';
import {
  brokerProperties,
  startBrokerService,
  stopBrokerService,
} from './service-policy.js';
import {
  populated,
  kill,
  groupsBelow,
  limits,
  noMounts,
} from './containment.js';

const CG = '/sys/fs/cgroup';
const now = () => performance.now();
const id = () => randomBytes(16).toString('hex');
const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
const log = (job, phase) =>
  process.stdout.write(
    `${JSON.stringify({ jobId: job?.id ?? null, phase })}\n`,
  );
/** Independent owner of the only slot. All mutation messages are serialized on
 * this loop; every active phase has one irreversible path to CLEANED. */
export async function startSupervisor() {
  const config = loadInstallation(),
    native = loadControl();
  const ledger = loadLedger(config.installation);
  const own = readFileSync('/proc/self/cgroup', 'utf8').trim().split('::')[1];
  if (own !== `${SUPERVISOR_CGROUP}/manager`)
    throw new Error('supervisor containment unavailable');
  const delegated = `${CG}${own.slice(0, -'/manager'.length)}`;
  writeFileSync(`${delegated}/cgroup.subtree_control`, '+cpu +memory +pids');
  for (const kind of ['jobs', 'helpers']) {
    if (!existsSync(`${delegated}/${kind}`)) mkdirSync(`${delegated}/${kind}`);
    writeFileSync(
      `${delegated}/${kind}/cgroup.subtree_control`,
      '+cpu +memory +pids',
    );
  }
  const usedIds = new Set(ledger.jobs.map((job) => job.id));
  function newJobId() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const next = id();
      if (!usedIds.has(next)) {
        usedIds.add(next);
        return next;
      }
    }
    throw new Error('reservation id unavailable');
  }
  let ready = false,
    active = null,
    instance = null,
    cleaning = false,
    channel = null,
    retiring = false;
  function persist() {
    saveLedger(ledger);
  }
  function phase(job, next) {
    job.phase = next;
    persist();
    log(job, next);
  }
  function binding(message) {
    return (
      instance &&
      message.instance === instance.id &&
      message.generation === ledger.generation
    );
  }
  function roots(job) {
    return [`${delegated}/jobs/${job.id}`, `${delegated}/helpers/${job.id}`];
  }
  function revoke(job, code = 'job_cancelled') {
    ready = false;
    if (revokeRecord(job, code, now())) {
      persist();
      log(job, job.phase);
    }
  }
  function stopInstance() {
    if (ledger.instance?.cgroup) kill(`${CG}${ledger.instance.cgroup}`);
    for (const j of ledger.jobs.filter((j) => j.phase !== 'CLEANED'))
      for (const p of roots(j)) kill(p);
  }
  async function retireInstance() {
    if (retiring) return;
    retiring = true;
    ready = false;
    const retired = instance;
    try {
      stopInstance();
      while (
        (ledger.instance?.cgroup &&
          populated(`${CG}${ledger.instance.cgroup}`)) ||
        (retired && !native.exited(retired.pidfd))
      )
        await pause();
      // End the old binding before closing its socket: its close callback and
      // any late completion cannot cancel or authorize the replacement.
      instance = null;
      const previous = channel;
      channel = null;
      ledger.instance = null;
      persist();
      previous?.close();
      if (retired) closeSync(retired.pidfd);
      stopBrokerService();
      startBrokerService();
    } catch {
      log(null, 'instance_retirement_blocked');
    } finally {
      retiring = false;
    }
  }
  async function stopped(job, normal) {
    if (!normal) stopInstance();
    const all = roots(job);
    if (!normal && ledger.instance?.cgroup)
      all.push(`${CG}${ledger.instance.cgroup}`);
    if (
      all.some(populated) ||
      (!normal && instance && !native.exited(instance.pidfd))
    )
      return false;
    return true;
  }
  function cleanupObjects(job) {
    const runtimeObject = `${PATHS.runtime}/${job.id}`;
    if (existsSync(`${runtimeObject}/${job.id}`))
      execFileSync(
        `${PATHS.install}/crun`,
        [
          '--root',
          runtimeObject,
          '--cgroup-manager',
          'cgroupfs',
          'delete',
          '--force',
          job.id,
        ],
        { stdio: 'ignore', timeout: 1000, env: {} },
      );
    const staging = `${PATHS.jobs}/${job.id}`;
    if (!noMounts(staging) || !noMounts(runtimeObject))
      throw new Error('cleanup mount remains');
    rmSync(staging, { recursive: true, force: true });
    rmSync(runtimeObject, { recursive: true, force: true });
    if (existsSync(runtimeObject) || existsSync(staging))
      throw new Error('cleanup object remains');
    for (const p of roots(job)) {
      if (populated(p)) throw new Error('producer remains');
      for (const nested of groupsBelow(p)) rmdirSync(nested);
      if (existsSync(p)) rmdirSync(p);
    }
  }
  async function clean(job, normal = false) {
    if (cleaning) return;
    cleaning = true;
    try {
      normal = normal && !job.cancelled;
      if (!(await stopped(job, normal))) return;
      if (normal && job.cancelled) return;
      if (job.phase === 'TERMINATING') phase(job, 'PRODUCERS_STOPPED');
      if (job.phase === 'PRODUCERS_STOPPED') phase(job, 'CLEANING');
      cleanupObjects(job);
      if (
        normal &&
        (now() >= job.revokedAt + 5000 || now() >= job.reservedAt + 30000)
      ) {
        job.cancelled = true;
        persist();
        stopInstance();
        return;
      }
      phase(job, 'CLEANED');
      active = null;
      if (
        normal &&
        !job.cancelled &&
        instance &&
        !native.exited(instance.pidfd)
      ) {
        ready = true;
        channel.send({
          op: 'cleaned',
          job: job.id,
          instance: instance.id,
          generation: ledger.generation,
        });
      } else {
        ready = false;
        // A failed instance is never reused. Restart reconciliation alone can
        // register a replacement, including when there was no active guest.
        retireInstance();
      }
    } catch {
      ready = false;
      if (job.phase === 'CLEANED') retireInstance();
      else revoke(job, 'sandbox_unavailable');
      log(job, 'cleanup_blocked');
    } finally {
      cleaning = false;
    }
  }
  // No new registration or autonomous broker launch can pass this barrier.
  // The fixed service cgroup covers stopped brokers even after pidfd loss on
  // supervisor restart. Kill+populated=0 includes every thread and descendant.
  const props = brokerProperties();
  if (
    props.Restart !== 'no' ||
    props.RestartForceExitStatus ||
    props.TriggeredBy ||
    props.DropInPaths ||
    props.FragmentPath !== '/etc/systemd/system/deckyard-render-broker.service'
  )
    throw new Error('broker activation policy changed');
  trustedPath(props.FragmentPath, 0o644);
  ready = false;
  for (const job of ledger.jobs.filter((j) => j.phase !== 'CLEANED')) {
    job.cancelled = true;
    job.phase = 'TERMINATING';
    job.revokedAt = now();
  }
  persist();
  if (props.ControlGroup) kill(`${CG}${props.ControlGroup}`);
  stopInstance();
  const start = now();
  while (
    (props.ControlGroup && populated(`${CG}${props.ControlGroup}`)) ||
    ledger.jobs.some((j) => j.phase !== 'CLEANED' && roots(j).some(populated))
  ) {
    if (now() - start > 5000) log(null, 'reconciliation_not_ready');
    await pause();
  }
  const known = new Set(ledger.jobs.map((j) => j.id));
  for (const directory of [
    PATHS.jobs,
    PATHS.runtime,
    `${delegated}/jobs`,
    `${delegated}/helpers`,
  ]) {
    for (const name of readdirSync(directory, { withFileTypes: true })) {
      if (directory.startsWith(CG) && !name.isDirectory()) continue;
      if (!known.has(name.name)) throw new Error('unexplained runner object');
    }
  }
  for (const job of ledger.jobs) {
    if (job.phase !== 'CLEANED') {
      phase(job, 'PRODUCERS_STOPPED');
      phase(job, 'CLEANING');
      cleanupObjects(job);
      phase(job, 'CLEANED');
    } else {
      for (const p of [
        PATHS.jobs,
        PATHS.runtime,
        `${delegated}/jobs`,
        `${delegated}/helpers`,
      ]) {
        if (existsSync(`${p}/${job.id}`))
          throw new Error('object after CLEANED');
      }
    }
  }
  ledger.generation = id();
  ledger.instance = null;
  persist();
  if (existsSync(PATHS.supervisor)) {
    if (!trustedPath(PATHS.supervisor).isSocket())
      throw new Error('invalid lifecycle socket');
    unlinkSync(PATHS.supervisor);
  }
  const server = net.createServer({ pauseOnConnect: true }, (socket) => {
    let peer;
    try {
      peer = native.peer(socket._handle.fd);
      const current = brokerProperties();
      if (
        peer.uid !== 0 ||
        instance ||
        String(peer.pid) !== current.MainPID ||
        !current.InvocationID ||
        current.ControlGroup !==
          '/system.slice/deckyard-render-broker.service' ||
        readFileSync(`/proc/${peer.pid}/cgroup`, 'utf8').trim() !==
          `0::${current.ControlGroup}` ||
        native.exited(peer.pidfd)
      )
        throw new Error('invalid broker peer');
      instance = {
        id: id(),
        invocation: current.InvocationID,
        cgroup: current.ControlGroup,
        pidfd: peer.pidfd,
      };
      ledger.instance = {
        id: instance.id,
        invocation: instance.invocation,
        cgroup: instance.cgroup,
      };
      persist();
      const owner = instance;
      channel = lifecycleChannel(
        socket,
        (message) => {
          if (!binding(message)) throw new Error('stale lifecycle');
          const keys = Object.keys(message).sort().join(',');
          if (
            keys !==
            [
              'op',
              'seq',
              'instance',
              'generation',
              ...(message.op === 'reserve' ? [] : ['job']),
            ]
              .sort()
              .join(',')
          )
            throw new Error('invalid lifecycle shape');
          if (message.op === 'reserve') {
            if (!ready || active) throw new Error('slot unavailable');
            const job = {
              id: newJobId(),
              instance: instance.id,
              generation: ledger.generation,
              phase: 'RESERVED',
              reservedAt: now(),
              cancelled: false,
            };
            ledger.jobs.push(job);
            active = job;
            persist();
            limits(`${delegated}/jobs/${job.id}`, 536870912, 64);
            limits(`${delegated}/helpers/${job.id}`, 134217728, 32);
            phase(job, 'PREPARING');
            channel.send({
              op: 'reserved',
              job: job.id,
              instance: instance.id,
              generation: ledger.generation,
            });
          } else {
            if (
              !active ||
              active.id !== message.job ||
              active.phase === 'CLEANED'
            )
              throw new Error('invalid active job');
            if (
              message.op === 'running' &&
              active.phase === 'PREPARING' &&
              now() < active.reservedAt + 10000
            ) {
              phase(active, 'RUNNING');
              channel.send({
                op: 'running',
                job: active.id,
                instance: instance.id,
                generation: ledger.generation,
              });
            } else if (
              message.op === 'quiescent' &&
              active.phase === 'RUNNING' &&
              now() < active.reservedAt + 30000 &&
              roots(active).every((p) => !populated(p))
            ) {
              active.revokedAt = now();
              phase(active, 'TERMINATING');
              clean(active, true);
            } else if (message.op === 'cancel') revoke(active);
            else throw new Error('invalid lifecycle phase');
          }
        },
        () => {
          if (instance !== owner) return;
          ready = false;
          if (active) revoke(active);
          else {
            stopInstance();
            retireInstance();
          }
        },
      );
      ready = true;
      channel.send({
        op: 'registered',
        instance: instance.id,
        generation: ledger.generation,
      });
    } catch {
      socket.destroy();
      if (peer && peer.pidfd !== instance?.pidfd) closeSync(peer.pidfd);
    }
  });
  server.maxConnections = 1;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PATHS.supervisor, resolve);
  });
  chmodSync(PATHS.supervisor, 0o600);
  const ticker = setInterval(() => {
    try {
      if (instance && native.exited(instance.pidfd)) {
        ready = false;
        if (active) revoke(active);
        else retireInstance();
      }
      if (!active) return;
      if (active.phase === 'PREPARING' && now() >= active.reservedAt + 10000)
        revoke(active, 'job_timeout');
      if (
        ['PREPARING', 'RUNNING'].includes(active.phase) &&
        now() >= active.reservedAt + 30000
      )
        revoke(active, 'job_timeout');
      if (
        ['TERMINATING', 'PRODUCERS_STOPPED', 'CLEANING'].includes(
          active.phase,
        ) &&
        !cleaning
      ) {
        if (now() >= active.revokedAt + 5000) {
          ready = false;
          log(active, 'cleanup_not_ready');
        }
        clean(active);
      }
    } catch {
      ready = false;
      log(active, 'supervisor_not_ready');
    }
  }, 50);
  process.once('SIGTERM', () => {
    ready = false;
    clearInterval(ticker);
    if (active) revoke(active);
    stopInstance();
    server.close();
    process.exit(1);
  });
  // The only launcher. systemd's broker Restart is off; new brokers still wait
  // for registration. This is after reconciliation and socket establishment.
  startBrokerService();
  log(null, 'reconciled');
}
