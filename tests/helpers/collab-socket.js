/**
 * Real-socket helpers for the collab access tests (B767): a mounted
 * Hocuspocus server on a fresh HTTP server, and the editor's provider
 * connected as a seeded user with that user's session cookie.
 *
 * Server modules are imported inside the functions, so a test file can set
 * its environment (auth, collab, multi-organization) before any of them
 * loads.
 *
 * @module tests/helpers/collab-socket
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { createMockReq, createMockRes } from './http-mocks.js';

/** A marker no slide renders, so its presence in a client's state is a leak. */
export const NOTE = 'SOURCE-QUOTE-B767-COLLAB';

/** Poll until `fn()` is truthy or the timeout elapses. */
export async function waitFor(fn, { timeout = 8000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The `sb_session` cookie the server would set for a seeded user.
 *
 * @param {Object} row - the user's `users` row
 * @returns {Promise<string>}
 */
export async function cookieFor(row) {
  const { setSessionCookie } = await import('../../server/auth/auth.js');
  const { sessionVersion } =
    await import('../../server/utils/session-version.js');
  const res = createMockRes();
  setSessionCookie(createMockReq(), res, {
    email: row.email,
    role: 'user',
    name: row.name,
    v: sessionVersion(row),
  });
  return String(res.headers['Set-Cookie']).split(';')[0];
}

/**
 * A deck whose slides carry the three AI review notes, each quoting `NOTE`.
 *
 * @param {import('../../server/storage/scope.js').StorageScope} scope
 * @param {Object} [fields] - presentation fields (`ownerEmail`, `visibility`, …)
 * @returns {Promise<Object>}
 */
export async function createNotedDeck(scope, fields = {}) {
  const { createPresentation } =
    await import('../../server/storage/presentations/index.js');
  const noted = (title) => ({
    type: 'content-slide',
    content: { title },
    _aiReasoning: `Kept the claim "${NOTE}" from page 3`,
    _aiAlternatives: [{ type: 'quote-slide', reason: `${NOTE} as a quote` }],
    _aiWarnings: [`${NOTE} was shortened`],
  });
  return createPresentation(scope, {
    title: 'Generated deck',
    lang: 'nl',
    slides: [noted('Eerste'), noted('Tweede')],
    ...fields,
  });
}

/**
 * Mount collab on a fresh HTTP server.
 *
 * @param {{ repoRoot: string, authorizationLeaseMs?: number }} opts
 */
export async function startCollabServer(opts) {
  const { maybeAttachCollab, shutdownCollab } =
    await import('../../server/collab/mount.js');
  const server = http.createServer((req, res) => res.end('ok'));
  const hocuspocus = await maybeAttachCollab(server, opts);
  assert.ok(hocuspocus, 'collab should mount');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    hocuspocus,
    url: `ws://127.0.0.1:${server.address().port}/collab`,
    /** The open server-side connections on a deck's document. */
    connections(deckId) {
      return (
        hocuspocus.documents.get(`presentation:${deckId}`)?.getConnections() ??
        []
      );
    },
    async stop() {
      await shutdownCollab();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Open the editor's provider on a deck with a session cookie on the upgrade,
 * and record what the server answered. `silence()` stops the client sending
 * anything while it keeps receiving: the shape of a revoked user who just
 * listens.
 *
 * @param {string} url
 * @param {string} deckId
 * @param {string} cookie
 */
export async function connectAs(url, deckId, cookie) {
  const { Y, HocuspocusProvider } =
    await import('../../client/vendor/collab.js');
  let silent = false;
  class CookieWebSocket extends WebSocket {
    constructor(address, protocols) {
      super(address, { protocols, headers: { cookie } });
    }
    send(data) {
      if (!silent) super.send(data);
    }
  }
  const events = newEvents();
  const provider = new HocuspocusProvider({
    url,
    name: `presentation:${deckId}`,
    WebSocketPolyfill: CookieWebSocket,
    ...recordInto(events),
  });
  provider.awareness.setLocalState({ view: null });
  return {
    ...observe(Y, provider, events),
    silence: () => {
      silent = true;
    },
  };
}

/**
 * Open a further deck on a connected client's socket, the way Hocuspocus
 * multiplexes documents: no new upgrade, so nothing on the wire tells the
 * server whether the socket's original authentication still holds.
 *
 * @param {{ provider: Object }} client - a client from `connectAs`
 * @param {string} deckId
 */
export async function openOnSocket(client, deckId) {
  const { Y, HocuspocusProvider } =
    await import('../../client/vendor/collab.js');
  const events = newEvents();
  const provider = new HocuspocusProvider({
    websocketProvider: client.provider.configuration.websocketProvider,
    name: `presentation:${deckId}`,
    ...recordInto(events),
  });
  provider.attach();
  return observe(Y, provider, events);
}

const newEvents = () => ({ authenticated: false, denied: false, closes: 0 });

/** Provider callbacks that record what the server answered. */
const recordInto = (events) => ({
  onAuthenticated: () => {
    events.authenticated = true;
  },
  onAuthenticationFailed: () => {
    events.denied = true;
  },
  onClose: () => {
    events.closes += 1;
  },
});

/** What a test reads from, and does with, one provider. */
function observe(Y, provider, events) {
  return {
    provider,
    events,
    /** Whether `marker` is anywhere in the state this client received. */
    holds: (marker = NOTE) =>
      Buffer.from(Y.encodeStateAsUpdate(provider.document)).includes(marker),
    hasDeck: () => provider.document.getMap('meta').get('extra') !== undefined,
    /** Append `marker` to the first slide's reasoning, as an editor would. */
    writeNote(marker) {
      const slide = provider.document.getArray('slides').get(0);
      const reasoning = slide.get('_aiReasoning');
      if (reasoning instanceof Y.Text)
        reasoning.insert(reasoning.length, marker);
      else slide.set('_aiReasoning', `${reasoning ?? ''} ${marker}`);
    },
    destroy: () => provider.destroy(),
  };
}
