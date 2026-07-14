/**
 * Shared per-presentation status ticker for the follow SSE endpoints.
 *
 * Previously every follower connection ran its own setInterval that re-read
 * the follow state and the full presentation on each tick, so server work
 * scaled as followers × deck size. This module runs ONE tick per presentation
 * and fans the (once-serialized) result out to all subscribed connections.
 */

import { getFollowStateForPresentation } from '../../../storage/present-sessions.js';
import { getPresentationCached } from '../../../storage/presentation-cache.js';
import { computeAudienceCapabilitiesFromState } from './helpers.js';

const TICK_MS = 2000;

/**
 * @typedef {Object} SharedStatus
 * @property {any} state - Follow state for the presentation
 * @property {any} capabilities - Audience capabilities derived from the state
 * @property {string} statusJson - Pre-serialized `status` event payload
 */

/** @type {Map<string, { repoRoot: string, presentationId: string, subscribers: Set<Function>, timer: any }>} */
const groups = new Map();

async function computeShared(g) {
  const state = await getFollowStateForPresentation(g.repoRoot, g.presentationId);
  const pres = await getPresentationCached(g.repoRoot, g.presentationId);
  const capabilities = computeAudienceCapabilitiesFromState(state, pres);
  return {
    state,
    capabilities,
    // Serialized once for all subscribers; sseWrite passes strings through.
    statusJson: JSON.stringify({ ...state, capabilities }),
  };
}

function dispatch(subscriber, shared) {
  try {
    const p = subscriber(shared);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // Subscriber errors must not break the shared tick.
  }
}

async function tickGroup(g) {
  if (g.subscribers.size === 0) return;
  let shared;
  try {
    shared = await computeShared(g);
  } catch {
    return;
  }
  for (const subscriber of Array.from(g.subscribers)) dispatch(subscriber, shared);
}

/**
 * Subscribe a follower connection to the shared status tick for a
 * presentation. The subscriber is called once immediately, then on every
 * shared tick, with a {@link SharedStatus}.
 * @param {string} repoRoot
 * @param {string} presentationId
 * @param {(shared: SharedStatus) => void|Promise<void>} subscriber
 * @returns {() => void} Unsubscribe function
 */
export function subscribeFollowStatus(repoRoot, presentationId, subscriber) {
  const key = `${String(repoRoot || '')}\n${String(presentationId || '')}`;
  let g = groups.get(key);
  if (!g) {
    g = { repoRoot, presentationId, subscribers: new Set(), timer: null };
    g.timer = setInterval(() => {
      tickGroup(g).catch(() => {});
    }, TICK_MS);
    g.timer.unref?.();
    groups.set(key, g);
  }
  g.subscribers.add(subscriber);

  // Immediate first tick for this subscriber only, so a new connection gets
  // its initial `status` event right away.
  computeShared(g)
    .then((shared) => {
      if (g.subscribers.has(subscriber)) dispatch(subscriber, shared);
    })
    .catch(() => {});

  return () => {
    g.subscribers.delete(subscriber);
    if (g.subscribers.size === 0) {
      try {
        clearInterval(g.timer);
      } catch {}
      groups.delete(key);
    }
  };
}
