import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let session;
let subscriber;
let attached;
let catchUps;
const writes = [];
const doubles = {
  sseWrite: (_res, frame) => writes.push(frame),
  openSseStream: () => ({ ok: true }),
  toStorageContext: () => ({}),
  schedulePersist: () => {},
  sessions: new Map(),
  fireAndForget: () => {},
  touchLiveSession: async () => ({ ok: true, session }),
  findMostRecentSessionForPresentation: () => null,
  attachSessionSseClient: () => attached.promise,
  getFollowStateForPresentation: async () => ({}),
  followAudienceScope: () => ({}),
  subscribeFollowStatus: (_root, _id, callback) => {
    subscriber = callback;
    return () => {};
  },
  sendInteractionCatchUp: async () => {
    catchUps++;
  },
  getPresentationCached: async () => null,
  normalizeLang: () => '',
  computeAudienceCapabilitiesFromState: () => ({}),
  followAudienceState: (state) => state,
  followWireState: (state) => ({
    slideId: state.slideId,
    status: state.status,
  }),
  loadFollowAudience: async () => ({}),
};
globalThis.__followSseLifecycleDoubles = doubles;
const targets = [
  '/server/storage/live-sessions/sse.js',
  '/server/routes/api/follow/events.js',
];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (targets.some((target) => context.parentURL?.endsWith(target))) {
      const source = Object.keys(doubles)
        .map(
          (name) =>
            `export const ${name} = globalThis.__followSseLifecycleDoubles.${name};`,
        )
        .join('\n');
      return {
        url: `data:text/javascript,${encodeURIComponent(source)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const { attachSessionSseClient, broadcast } =
  await import('../server/storage/live-sessions/sse.js');
const { handleFollowEvents } =
  await import('../server/routes/api/follow/events.js');
hooks.deregister();

function reset() {
  writes.length = 0;
  catchUps = 0;
  session = { clients: new Set(), state: {}, controlEnabled: false };
  doubles.sessions.set('session', session);
  return new EventEmitter();
}

for (const event of ['close', 'finish']) {
  test(`disconnect during initial projection (${event}) detaches without writing`, async () => {
    const res = reset();
    const projection = deferred();
    const started = deferred();
    const pending = attachSessionSseClient({}, 'session', res, {
      transformEvent: () => {
        started.resolve();
        return projection.promise;
      },
    });
    await started.promise;
    assert.equal(session.clients.size, 1);
    res.emit(event);
    projection.resolve({ slideId: 'slide' });
    await pending;
    assert.equal(session.clients.size, 0);
    assert.deepEqual(writes, []);
  });
}

test('rejected initial projection detaches the client', async () => {
  const res = reset();
  const projection = deferred();
  const started = deferred();
  const pending = attachSessionSseClient({}, 'session', res, {
    transformEvent: () => {
      started.resolve();
      return projection.promise;
    },
  });
  await started.promise;
  projection.reject(new Error('projection failed'));
  await assert.rejects(pending, /projection failed/);
  assert.equal(session.clients.size, 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('disconnect during broadcast projection suppresses the delayed write', async () => {
  const res = reset();
  const projection = deferred();
  let initial = true;
  const started = deferred();
  await attachSessionSseClient({}, 'session', res, {
    transformEvent: () => {
      if (initial) {
        initial = false;
        return {};
      }
      started.resolve();
      return projection.promise;
    },
  });
  writes.length = 0;
  const pending = broadcast({}, 'session', 'state', {});
  await started.promise;
  res.emit('close');
  projection.resolve({});
  await pending;
  assert.deepEqual(writes, []);
});

for (const phase of ['projection', 'attach']) {
  test(`follow cleanup during ${phase} stops its pending status continuation`, async () => {
    const res = reset();
    attached = deferred();
    const projection = deferred();
    let detached = 0;
    await handleFollowEvents(
      {
        repoRoot: '/tmp',
        req: { method: 'GET' },
        res,
        url: new URL('http://localhost'),
      },
      'deck',
    );
    const pending = subscriber({
      audienceStateForLang: () => projection.promise,
      rawState: { status: 'live', sessionId: 'session' },
      pres: {},
    });
    if (phase === 'attach') {
      projection.resolve({ slideId: 'slide' });
      await Promise.resolve();
      assert.equal(writes.length, 1);
    }
    res.emit('close');
    projection.resolve({ slideId: 'slide' });
    attached.resolve(() => {
      detached++;
    });
    await pending;
    assert.equal(writes.length, phase === 'attach' ? 1 : 0);
    assert.equal(detached, phase === 'attach' ? 1 : 0);
    assert.equal(catchUps, 0);
  });
}
