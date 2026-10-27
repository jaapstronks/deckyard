import net from 'node:net';
import {
  closeSync,
  existsSync,
  unlinkSync,
  chmodSync,
  chownSync,
} from 'node:fs';
import { Worker } from 'node:worker_threads';
import { loadInstallation, loadControl, PATHS, trustedPath } from './paths.js';
import {
  parseJson,
  validateRequest,
  readFrame,
  responseBytes,
} from './protocol.js';
import { lifecycleChannel } from './channel.js';

/** Six connection tokens, four queued validated requests, one supervisor-owned
 * active slot. A single-use, joinable worker owns every producer operation. */
export async function startBroker() {
  const config = loadInstallation(),
    native = loadControl();
  let binding = null,
    channel = null,
    server = null,
    active = null,
    ready = false,
    dead = false;
  const connections = new Set(),
    queue = [];
  function loseSupervisor() {
    if (dead) return;
    dead = true;
    ready = false;
    server?.close();
    for (const token of connections) token.socket.destroy();
    // Exit is deliberately not a claim of cleanup. Supervisor kills the whole
    // broker cgroup (including workers/helpers) before releasing its slot.
    process.exit(1);
  }
  function send(op, job = null) {
    if (!binding || dead) throw new Error('supervisor unavailable');
    channel.send({ op, ...binding, ...(job ? { job } : {}) });
  }
  function answer(token, outcome) {
    if (token.answered || token.socket.destroyed) return;
    token.answered = true;
    clearTimeout(token.queueTimer);
    const deadline = performance.now() + 5000;
    const bytes = responseBytes(token.request, outcome, config.runnerId);
    if (performance.now() >= deadline) {
      token.socket.destroy();
      return;
    }
    const timer = setTimeout(
      () => token.socket.destroy(),
      Math.max(1, deadline - performance.now()),
    );
    token.socket.once('close', () => clearTimeout(timer));
    token.socket.end(bytes, () => {
      clearTimeout(timer);
      token.socket.destroy();
    });
  }
  function pump() {
    if (!ready || active || dead) return;
    let token;
    while ((token = queue.shift())) {
      if (token.socket.destroyed || token.answered) continue;
      if (performance.now() >= token.validatedAt + 40000) {
        answer(token, { code: 'queue_timeout' });
        continue;
      }
      clearTimeout(token.queueTimer);
      active = { token, job: null, worker: null, result: null, closed: false };
      send('reserve');
      return;
    }
  }
  function cancel() {
    if (!active || active.closed) return;
    active.closed = true;
    if (active.job) send('cancel', active.job.id);
    // If reserve is still in flight, its ack is handled only by cancellation.
  }
  const supervisor = net.createConnection({ path: PATHS.supervisor });
  await new Promise((resolve, reject) => {
    supervisor.once('connect', resolve);
    supervisor.once('error', reject);
  });
  channel = lifecycleChannel(
    supervisor,
    (m) => {
      if (m.op === 'registered' && !binding) {
        if (typeof m.instance !== 'string' || typeof m.generation !== 'string')
          throw new Error('invalid registration');
        binding = { instance: m.instance, generation: m.generation };
        ready = true;
        beginAdmission();
        return;
      }
      if (
        !binding ||
        m.instance !== binding.instance ||
        m.generation !== binding.generation ||
        !active
      )
        throw new Error('stale supervisor message');
      if (m.op === 'reserved' && !active.job) {
        if (!/^[a-f0-9]{32}$/.test(m.job))
          throw new Error('invalid reservation');
        active.job = { id: m.job, helper: m.helper, guest: m.guest };
        if (active.closed || active.token.socket.destroyed) {
          send('cancel', m.job);
          return;
        }
        const owner = active;
        const worker = new Worker(new URL('./job-worker.js', import.meta.url), {
          workerData: { job: owner.job, request: owner.token.request, config },
          env: {},
        });
        owner.worker = worker;
        worker.on('message', (message) => {
          if (active !== owner || owner.closed) return;
          if (message.phase === 'prepared') send('running', owner.job.id);
          else if (message.cancel || message.error) cancel();
          else if (message.result && !owner.result)
            owner.result = message.result;
          else cancel();
        });
        worker.once('error', cancel);
        worker.once('exit', (code) => {
          // Worker exit joins its synchronous syscalls, awaited filesystem reads,
          // runtime child close event and completion callbacks. No worker or
          // submit closure survives this transition.
          if (active !== owner || owner.closed) return;
          owner.worker = null;
          if (code !== 0 || !owner.result) {
            cancel();
            return;
          }
          owner.closed = true;
          send('quiescent', owner.job.id);
        });
      } else if (
        m.op === 'running' &&
        active.job?.id === m.job &&
        active.worker &&
        !active.closed
      ) {
        active.worker.postMessage('run');
      } else if (
        m.op === 'cleaned' &&
        active.job?.id === m.job &&
        active.closed &&
        !active.worker &&
        active.result
      ) {
        const token = active.token,
          result = active.result;
        active = null;
        if (ready && !dead) answer(token, result);
        pump();
      } else throw new Error('invalid supervisor phase');
    },
    loseSupervisor,
  );

  function beginAdmission() {
    if (server) throw new Error('duplicate admission');
    if (existsSync(PATHS.socket)) {
      if (!trustedPath(PATHS.socket).isSocket())
        throw new Error('invalid broker socket');
      unlinkSync(PATHS.socket);
    }
    server = net.createServer(
      { allowHalfOpen: true, pauseOnConnect: true },
      (socket) => {
        const token = {
          socket,
          request: null,
          answered: false,
          peer: null,
          queueTimer: null,
          peerTimer: null,
        };
        connections.add(token);
        socket.on('error', () => {});
        socket.once('close', () => {
          connections.delete(token);
          clearInterval(token.peerTimer);
          clearTimeout(token.queueTimer);
          if (token.peer) closeSync(token.peer.pidfd);
          const index = queue.indexOf(token);
          if (index >= 0) queue.splice(index, 1);
          if (active?.token === token && !token.answered) cancel();
        });
        try {
          token.peer = native.peer(socket._handle.fd);
          if (!ready || token.peer.uid !== config.callerUid) {
            socket.destroy();
            return;
          }
        } catch {
          socket.destroy();
          return;
        }
        token.peerTimer = setInterval(() => {
          try {
            if (
              !token.answered &&
              socket._handle &&
              native.disconnected(socket._handle.fd)
            )
              socket.destroy();
          } catch {
            socket.destroy();
          }
        }, 50);
        readFrame(socket)
          .then((bytes) => {
            if (socket.destroyed || !ready) return;
            try {
              const parsed = parseJson(bytes);
              if (
                typeof parsed?.requestId === 'string' &&
                /^[A-Za-z0-9_-]{1,64}$/.test(parsed.requestId)
              )
                token.request = { requestId: parsed.requestId };
              token.request = validateRequest(parsed);
            } catch {
              answer(token, { code: 'invalid_request' });
              return;
            }
            token.validatedAt = performance.now();
            if (queue.length >= 4) {
              answer(token, { code: 'busy' });
              return;
            }
            queue.push(token);
            token.queueTimer = setTimeout(() => {
              const index = queue.indexOf(token);
              if (index >= 0) {
                queue.splice(index, 1);
                answer(token, { code: 'queue_timeout' });
              }
            }, 40000);
            pump();
          })
          .catch(() => answer(token, { code: 'invalid_request' }));
      },
    );
    server.maxConnections = 6;
    server.on('error', loseSupervisor);
    server.listen({ path: PATHS.socket, backlog: 6 }, () => {
      chownSync(PATHS.socket, 0, config.callerGid);
      chmodSync(PATHS.socket, 0o660);
    });
  }
  process.once('SIGTERM', loseSupervisor);
}
