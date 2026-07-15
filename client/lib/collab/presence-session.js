/**
 * Presence session over the /collab WebSocket (Yjs awareness protocol).
 *
 * Transport layer only — no DOM. Phase 1 of the realtime-collaboration ADR:
 * the Y.Doc content is unused; clients exchange awareness states describing
 * who is here, which slide they view and which field they focus. The
 * awareness protocol handles stale-peer cleanup (server drops a client's
 * state on disconnect/timeout), so there is no TTL bookkeeping here.
 *
 * Local awareness state shape:
 *   {
 *     user:  { email, name, color },
 *     view:  { slideId } | null,               // slide the user is on
 *     focus: { slideId, fieldPath } | null,    // field being edited
 *   }
 */

import { HocuspocusProvider, WebSocketStatus } from '../../vendor/collab.js';

/**
 * Saturated, theme-safe colors for presence rings/outlines. Order matters:
 * a user's color is stable per email (hash-picked), like avatar initials.
 */
const PRESENCE_COLORS = [
  '#2563eb', // blue
  '#db2777', // pink
  '#d97706', // amber
  '#059669', // green
  '#7c3aed', // violet
  '#dc2626', // red
  '#0891b2', // cyan
  '#65a30d', // lime
];

/**
 * Deterministic presence color for a user.
 * @param {string} seed - usually the user's email
 * @returns {string} hex color
 */
export function presenceColor(seed) {
  const s = String(seed || '').toLowerCase();
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

/**
 * Open a presence session for a presentation.
 *
 * @param {Object} opts
 * @param {string} opts.presentationId
 * @param {{ email: string, name?: string }} opts.user - current user
 * @param {string} [opts.url] - WebSocket URL override (tests); defaults to
 *   ws(s)://<host>/collab derived from the page origin
 * @param {Function} [opts.WebSocketPolyfill] - for non-browser environments
 * @returns {Object} session API
 */
export function createPresenceSession({
  presentationId,
  user,
  url,
  WebSocketPolyfill,
} = {}) {
  if (!presentationId) throw new Error('createPresenceSession: presentationId is required');
  const email = String(user?.email || '').toLowerCase();
  if (!email) throw new Error('createPresenceSession: user.email is required');

  const wsUrl =
    url ||
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`;

  const provider = new HocuspocusProvider({
    url: wsUrl,
    name: `presentation:${presentationId}`,
    ...(WebSocketPolyfill ? { WebSocketPolyfill } : {}),
  });
  const awareness = provider.awareness;

  const localUser = {
    email,
    name: String(user?.name || '').trim(),
    color: presenceColor(email),
  };
  awareness.setLocalState({ user: localUser, view: null, focus: null });

  const peerListeners = new Set();
  const statusListeners = new Set();
  let destroyed = false;

  /** Remote peers with a valid presence state (one entry per client/tab). */
  const getPeers = () => {
    const peers = [];
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      if (!state?.user?.email) continue;
      peers.push({ clientId, user: state.user, view: state.view || null, focus: state.focus || null });
    }
    return peers;
  };

  const notifyPeers = () => {
    const peers = getPeers();
    for (const fn of peerListeners) {
      try {
        fn(peers);
      } catch {
        // listener errors must not break the awareness pipeline
      }
    }
  };
  awareness.on('change', notifyPeers);

  const onStatus = ({ status }) => {
    const connected = status === WebSocketStatus.Connected;
    for (const fn of statusListeners) {
      try {
        fn(connected);
      } catch {
        // ignore
      }
    }
  };
  provider.on('status', onStatus);

  // Best-effort teardown so peers see us leave immediately instead of after
  // the awareness timeout.
  const onPageHide = () => destroy();
  if (typeof window !== 'undefined')
    window.addEventListener('pagehide', onPageHide);

  function setViewSlide(slideId) {
    if (destroyed) return;
    awareness.setLocalStateField('view', slideId ? { slideId } : null);
  }

  function setFocusField(slideId, fieldPath) {
    if (destroyed) return;
    awareness.setLocalStateField(
      'focus',
      slideId && fieldPath ? { slideId, fieldPath } : null
    );
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (typeof window !== 'undefined')
      window.removeEventListener('pagehide', onPageHide);
    try {
      awareness.off('change', notifyPeers);
      provider.off('status', onStatus);
      awareness.setLocalState(null);
    } catch {
      // ignore
    }
    try {
      provider.destroy();
    } catch {
      // ignore
    }
  }

  return {
    localUser,
    getPeers,
    setViewSlide,
    setFocusField,
    /** Subscribe to peer-list changes; returns an unsubscribe function. */
    onPeersChange(fn) {
      peerListeners.add(fn);
      return () => peerListeners.delete(fn);
    },
    /** Subscribe to connection status (boolean connected). */
    onConnectionChange(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
    destroy,
    /** Exposed for tests/phase 2. */
    _provider: provider,
  };
}
