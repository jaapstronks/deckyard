/**
 * Retention-window declarations — the one place where a "how long do we keep
 * this" env var is read. Like `config/features.js`, every window is a
 * call-time function rather than a module-load constant, so `.env` loading
 * order cannot bite and a test can set the variable before the first read.
 *
 * A window is always a positive whole number of days. There is deliberately no
 * "0 means never" spelling: the trash hint promises deletion, and a value that
 * silently turns the promise off would put back the exact mismatch B330
 * removes. An operator who wants a longer safety net raises the number.
 */

import { envInt } from './utils.js';

/** Days a trashed presentation stays recoverable before it is purged. */
const DEFAULT_TRASH_RETENTION_DAYS = 30;

/** Days an activity event is kept; they carry actor emails. */
const DEFAULT_ACTIVITY_RETENTION_DAYS = 180;

/**
 * How long a trashed presentation stays in the trash before the daily
 * retention job deletes it for good. This is the number the trash hint shows,
 * so the copy and the sweep can never disagree. Override with
 * `TRASH_RETENTION_DAYS`.
 * @returns {number} Whole days, at least 1.
 */
export function trashRetentionDays() {
  return envInt('TRASH_RETENTION_DAYS', DEFAULT_TRASH_RETENTION_DAYS, {
    min: 1,
  });
}

/**
 * How long an activity event is kept in the organization feed. They carry
 * actor emails, so they are kept long enough to be a useful feed and no
 * longer. Override with `ACTIVITY_RETENTION_DAYS`.
 * @returns {number} Whole days, at least 1.
 */
export function activityRetentionDays() {
  return envInt('ACTIVITY_RETENTION_DAYS', DEFAULT_ACTIVITY_RETENTION_DAYS, {
    min: 1,
  });
}
