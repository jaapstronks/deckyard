import { toStorageContext } from '../backend-dispatch.js';
import { LIVE_WINDOW_MS } from './constants.js';
import { hydrateSessionsForPresentation } from './db.js';
import { sessions } from './state.js';

/**
 * Capability-based read: the follow code resolved the presentation id, which
 * makes it the authorization, so an audience scope may read cross-organization.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} presentationId
 * @param {{liveWindowMs?: number}} [opts]
 */
export async function getFollowStateForPresentation(
  scope,
  presentationId,
  { liveWindowMs = LIVE_WINDOW_MS } = {}
) {
  toStorageContext(scope, 'getFollowStateForPresentation', {}, { allowCrossOrganization: true });
  const pid = String(presentationId || '').trim();
  if (!pid)
    return {
      status: 'not_found',
      presentationId: '',
      sessionId: '',
      slideId: '',
      slideIndex: 0,
      updatedAt: 0,
    };

  // Adopt stored sessions for this deck: a follower may be reading from a
  // process other than the one the presenter is pushing state to.
  await hydrateSessionsForPresentation(pid);

  let foundAny = false;
  let best = null;
  let bestTs = -1;
  for (const s of sessions.values()) {
    if (!s || s.presentationId !== pid) continue;
    foundAny = true;
    const ts = Number(s?.state?.updatedAt || 0) || Number(s?.createdAt || 0) || 0;
    if (ts > bestTs) {
      bestTs = ts;
      best = s;
    }
  }

  if (!best) {
    return {
      status: foundAny ? 'ended' : 'not_started',
      presentationId: pid,
      sessionId: '',
      slideId: '',
      slideIndex: 0,
      updatedAt: 0,
    };
  }

  const updatedAt = Number(best?.state?.updatedAt || 0) || 0;
  const now = Date.now();
  const isLive =
    updatedAt &&
    now - updatedAt <= Math.max(10_000, Number(liveWindowMs || 0) || LIVE_WINDOW_MS);

  return {
    status: isLive ? 'live' : foundAny ? 'ended' : 'not_started',
    presentationId: pid,
    sessionId: best.sessionId,
    slideId: String(best?.state?.slideId || ''),
    slideIndex: Number(best?.state?.slideIndex || 0) || 0,
    slideType: String(best?.state?.slideType || ''),
    stepIdx: Math.max(0, Number(best?.state?.stepIdx || 0) || 0),
    stepParagraphs: !!best?.state?.stepParagraphs,
    updatedAt,
  };
}
