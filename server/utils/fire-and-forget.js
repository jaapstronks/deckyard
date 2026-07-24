/**
 * Guard for deliberately un-awaited ("fire-and-forget") background promises.
 *
 * A request handler often kicks off a side task it doesn't wait for — sending
 * an invitation email, writing a notification — and returns its HTTP response
 * immediately. If that task's promise rejects and nothing is attached to catch
 * it, Node treats it as an unhandled rejection, which under the current default
 * (`--unhandled-rejections=throw`) takes the whole process down. Wrapping the
 * promise here attaches a terminal `.catch` so a throwing background task can
 * only ever produce a log line, never a crash.
 *
 * The task's own resolve handler still owns its success/expected-failure logic
 * (e.g. logging `{ ok: false }`); this only backstops an actual rejection.
 */

import { createLogger } from './logger.js';

const log = createLogger('fire-and-forget');

/**
 * Attach a rejection guard to a background promise.
 * @param {Promise<unknown>} promise - The un-awaited task to guard. A non-thenable is ignored.
 * @param {string} [label] - Short description of the task, used in the log line on rejection.
 * @returns {void}
 */
export function fireAndForget(promise, label = 'background task') {
  if (!promise || typeof promise.then !== 'function') return;
  promise.catch((err) => {
    log.error(`${label} rejected:`, err);
  });
}
