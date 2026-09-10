import { getInteractionCatchUp } from '../../storage/interactions.js';
import { sseWrite } from '../../utils/sse.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('interaction-catch-up');

/**
 * Write the current interaction state to a client that just attached.
 *
 * `attachSessionSseClient()` opens with the session's `state` and
 * `controlEnabled`, and every interaction payload after that is a push: a
 * vote, a status change, a reset. So a client that attaches *after* the votes
 * are in — a presenter reloading mid-poll, a second presenter window, a phone
 * joining late — renders "Total: 0" until somebody votes again. It also made
 * the two marketing shots of a live poll a coin flip: the votes are seeded
 * before the browser exists, and the broadcast that would have carried them
 * races the browser's own attach (`Stage tally never reached 47 — last read
 * "Totaal: 0"`, roughly one run in twenty).
 *
 * Sent as the same `interactionState` event a push uses, so no client needs to
 * learn a second shape. A slide with no interaction row sends nothing.
 *
 * `deviceId` is deliberately not resolved here: the follower's own answer
 * rides on its device cookie, which the SSE response can no longer set once
 * the stream headers are out. The follow client keeps its own record of what
 * it submitted (`client/views/follow/interactions/local-cache.js`); the
 * catch-up carries the crowd, not the reader.
 *
 * @param {import('../../storage/scope.js').StorageScope} scope
 * @param {object} spec
 * @param {string} spec.sessionId
 * @param {string} spec.slideId The session's current slide.
 * @param {import('node:http').ServerResponse} spec.res
 * @returns {Promise<void>}
 */
export async function sendInteractionCatchUp(
  scope,
  { sessionId, slideId, res },
) {
  if (!slideId) return;
  try {
    const agg = await getInteractionCatchUp(scope, sessionId, { slideId });
    if (!agg) return;
    sseWrite(res, {
      event: 'interactionState',
      data: { ...agg, updatedAt: Date.now() },
    });
  } catch (err) {
    // A catch-up nobody could compute is not a reason to drop the stream: the
    // client still gets every push from here on, so this is logged, not thrown.
    log.warn(`catch-up for session ${sessionId} failed: ${err.message}`);
  }
}
