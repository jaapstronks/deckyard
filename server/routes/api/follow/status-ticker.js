/**
 * Shared per-presentation status ticker for the follow SSE endpoints.
 *
 * Previously every follower connection ran its own setInterval that re-read
 * the follow state and the full presentation on each tick, so server work
 * scaled as followers × deck size. This module runs ONE tick per presentation
 * and shares the per-language audience state across subscribed connections.
 */

import { getFollowStateForPresentation } from '../../../storage/live-sessions/index.js';
import { getPresentationCached } from '../../../storage/presentations/index.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';
import {
  followAudienceState,
  followAudienceScope,
  loadFollowAudience,
} from './helpers.js';

const TICK_MS = 2000;

/**
 * @typedef {Object} SharedStatus
 * @property {any} rawState - Internal session state, including its capability
 * @property {any} pres - Original deck for capability computation
 * @property {(lang: string) => Promise<any>} audienceStateForLang - Shared language projection
 */

/** @type {Map<string, { repoRoot: string, presentationId: string, subscribers: Set<Function>, timer: any }>} */
const groups = new Map();

async function computeShared(g) {
  const state = await getFollowStateForPresentation(
    followAudienceScope(g.repoRoot),
    g.presentationId,
  );
  const pres = await getPresentationCached(
    followAudienceScope(g.repoRoot),
    g.presentationId,
  );
  const projected = pres
    ? await loadFollowAudience(g.repoRoot, pres, null)
    : null;
  const audienceState = followAudienceState(state, pres, projected);
  const languageStates = new Map([['', Promise.resolve(audienceState)]]);
  return {
    rawState: state,
    pres,
    audienceStateForLang(lang) {
      const key = lang || '';
      if (!pres) return Promise.resolve(audienceState);
      if (!languageStates.has(key)) {
        languageStates.set(
          key,
          loadFollowAudience(g.repoRoot, pres, key).then((deck) =>
            followAudienceState(state, pres, deck),
          ),
        );
      }
      return languageStates.get(key);
    },
  };
}

function dispatch(subscriber, shared) {
  try {
    fireAndForget(subscriber(shared), 'follow status subscriber');
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
  for (const subscriber of Array.from(g.subscribers))
    dispatch(subscriber, shared);
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
      fireAndForget(tickGroup(g), 'follow status tick');
    }, TICK_MS);
    g.timer.unref?.();
    groups.set(key, g);
  }
  g.subscribers.add(subscriber);

  // Immediate first tick for this subscriber only, so a new connection gets
  // its initial `status` event right away.
  fireAndForget(
    computeShared(g).then((shared) => {
      if (g.subscribers.has(subscriber)) dispatch(subscriber, shared);
    }),
    'follow status first tick',
  );

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
