/**
 * The live audience-question feed: one SSE subscription, one poll loop, one
 * reading of the `questions` / `status` events.
 *
 * `/api/follow/:id/questions/events` was subscribed to three times — from the
 * follow page, the presenter's notes panel and the moderator route — and each
 * copy re-derived the same things: `JSON.parse(ev.data)`, the questions array
 * out of the payload, `close` meaning disconnect-for-good, and an 8s polling
 * fallback for the events SSE drops when a mobile tab is backgrounded (B153).
 *
 * What stays with the views is policy, not plumbing: what a disabled Q&A does
 * to the layout, which buttons a moderator gets, whether a dead session shows
 * an empty list or a message. This owns the transport and hands over
 * normalized, ranked questions.
 */

import { debugLog } from '../util/debug.js';
import {
  createSSEConnection,
  LONG_LIVED_STREAM,
} from '../net/sse-connection.js';
import { normalizeQuestions, rankQuestions } from './question-model.js';
import { fetchQuestions } from './mutations.js';

/** How often the poll loop re-reads the list when polling is on. */
export const QA_POLL_MS = 8000;

/**
 * Subscribe to the live question list for a presentation.
 *
 * The presentation id is read through a getter at connect/refresh time rather
 * than captured, because the notes panel builds its feed before the presenter
 * has told it which deck is on screen.
 *
 * @param {Object} options
 * @param {Function} options.api - The client's api() function
 * @param {Function} options.getPresentationId - () => string, read lazily
 * @param {Function} options.onQuestions - (questions, meta) => void, with
 *   normalized+ranked questions and `{ live, capabilities }`
 * @param {Function} [options.onCapabilities] - (capabilities) => void, fired
 *   whenever a payload carries them
 * @param {Function} [options.onRefreshError] - (error) => void, fired when the
 *   HTTP re-read fails. The empty list is emitted either way; this is for the
 *   view that also wants to undo whatever the last capabilities told it
 * @param {number} [options.pollMs=QA_POLL_MS] - Poll interval; 0 disables the
 *   fallback loop (the moderator route has no long-lived mobile tab to lose)
 * @param {string} [options.logTag='qa'] - Prefix for debug lines
 * @returns {{connect: Function, disconnect: Function, refresh: Function,
 *   stop: Function, isConnected: Function}}
 */
export function createQuestionsFeed({
  api,
  getPresentationId,
  onQuestions,
  onCapabilities,
  onRefreshError,
  pollMs = QA_POLL_MS,
  logTag = 'qa',
} = {}) {
  let stream = null;
  let pollTid = null;

  const log = (msg, detail) => debugLog(`[${logTag}] ${msg}`, detail);

  /**
   * Hand a payload's questions to the view.
   * @param {Array} rawQuestions - Wire questions, or anything else
   * @param {Object} meta - { live, capabilities }
   * @returns {void}
   */
  const emit = (rawQuestions, meta) => {
    onQuestions?.(rankQuestions(normalizeQuestions(rawQuestions)), meta);
  };

  /**
   * Report capabilities when a payload carries them.
   * @param {Object} [capabilities]
   * @returns {Object|null}
   */
  const reportCapabilities = (capabilities) => {
    if (!capabilities || typeof capabilities !== 'object') return null;
    onCapabilities?.(capabilities);
    return capabilities;
  };

  /**
   * Re-read the list over HTTP. Also the fallback when SSE is dropping events.
   * @returns {Promise<{live: boolean, questions: Array, capabilities: Object|null}>}
   *   `live` is false on a dead session *and* on a failed request — both mean
   *   "nothing to show", which is what every caller does with it.
   */
  const refresh = async () => {
    try {
      const resp = await fetchQuestions(api, getPresentationId?.() || '');
      const capabilities = reportCapabilities(resp?.capabilities);
      const live = resp?.status === 'live';
      const questions = live ? resp?.questions : [];
      emit(questions, { live, capabilities });
      return { live, questions: questions || [], capabilities };
    } catch (e) {
      log('refresh failed', e);
      onRefreshError?.(e);
      emit([], { live: false, capabilities: null });
      return { live: false, questions: [], capabilities: null };
    }
  };

  /**
   * Build the SSE connection. Lazy so the presentation id is read at connect
   * time, and rebuildable after stop().
   * @returns {Object} The connection helper
   */
  const buildStream = () => {
    const pid = encodeURIComponent(String(getPresentationId?.() || ''));
    return createSSEConnection({
      url: `/api/follow/${pid}/questions/events`,
      events: ['questions', 'status', 'close'],
      onEvent: (ev) => {
        switch (ev.type) {
          case 'questions': {
            try {
              const data = JSON.parse(ev.data || '{}');
              emit(data?.questions, { live: true, capabilities: null });
            } catch (e) {
              log('bad questions event', { data: ev?.data, e });
            }
            break;
          }
          case 'status': {
            try {
              const data = JSON.parse(ev.data || '{}');
              const capabilities = reportCapabilities(data?.capabilities);
              const live = data?.status === 'live';
              if (!live) emit([], { live, capabilities });
            } catch (e) {
              log('bad status event', { data: ev?.data, e });
            }
            break;
          }
          case 'close':
            // Server-side end of stream: close for good, don't reopen.
            stream?.disconnect();
            break;
        }
      },
      // Reopening on error is owned by the SSE helper so the pending retry dies
      // with stop(); a bare setTimeout here outlived the view and resurrected
      // the stream into a detached controller.
      ...LONG_LIVED_STREAM,
    });
  };

  /**
   * Open the stream and (unless polling is off) start the fallback loop.
   * @returns {void}
   */
  const connect = () => {
    if (!stream) stream = buildStream();
    stream.connect();
    if (pollMs > 0 && !pollTid) {
      pollTid = setInterval(() => {
        refresh().catch(() => {});
      }, pollMs);
      pollTid.unref?.();
    }
  };

  /**
   * Close the stream for good without tearing the feed down.
   * @returns {void}
   */
  const disconnect = () => {
    stream?.disconnect();
  };

  /**
   * Tear everything down: stream, pending retry, poll loop.
   * @returns {void}
   */
  const stop = () => {
    stream?.stop();
    stream = null;
    if (pollTid) {
      clearInterval(pollTid);
      pollTid = null;
    }
  };

  return {
    connect,
    disconnect,
    refresh,
    stop,
    isConnected: () => Boolean(stream?.isConnected?.()),
  };
}
