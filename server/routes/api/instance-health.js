/**
 * `GET /api/instance-health` — the admin view of what this install uses
 * (A7.3, B516, D249).
 *
 * One answer, two kinds of number (D245):
 *
 *   - **`census`** — what the instance holds right now, computed at the moment
 *     the view opens (`server/storage/instance-census.js`): slide types with
 *     decks and slides, custom-type keys, settings keys that differ from their
 *     default. The census is the instance's T0.
 *   - **`usage`** — what the counters saw in the window, per axis and key:
 *     days active, last seen and the raw count (the instance-health counters, D246).
 *
 * Plus `firstMeasuredAt` (the first counted day) and `decisionDueAt` (that day
 * plus three months, D26): the date from which "maybe someone uses it" needs a
 * number from this view.
 *
 * Instance-wide, so only an **instance** admin (`users.role`, not a membership
 * role) may read it; nothing in the answer names a deck, a person, an
 * organization or a setting's value.
 *
 * @module server/routes/api/instance-health
 */

import {
  badRequest,
  forbidden,
  serveJson,
  unauthorized,
  withErrorHandler,
} from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import { crossOrganizationScope, repoRootOf } from '../../storage/scope.js';
import {
  readChangedSettingsKeys,
  readCustomTypeCensus,
  readSlideTypeCensus,
} from '../../storage/instance-census.js';
import {
  readFirstInstanceHealthDay,
  readInstanceHealth,
  summarizeInstanceHealth,
} from '../../storage/instance-health.js';

/** The windows the view offers, in days. */
const INSTANCE_HEALTH_WINDOWS = Object.freeze([30, 90, 365]);

/** The window when `?days=` is absent. */
const DEFAULT_WINDOW = 90;

/** How long after the first counted day the pruning decision is due (D26). */
const DECISION_TERM_MONTHS = 3;

/**
 * `day` shifted by whole UTC days.
 *
 * @param {string} day - `YYYY-MM-DD`.
 * @param {number} days
 * @returns {string}
 */
function addDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * `day` shifted by whole calendar months, clamped to the last day of the
 * target month (30 November + 3 months is 28 or 29 February).
 *
 * @param {string} day - `YYYY-MM-DD`.
 * @param {number} months
 * @returns {string}
 */
export function addMonths(day, months) {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * The window asked for: `?days=` absent is the default, anything outside
 * {@link INSTANCE_HEALTH_WINDOWS} is refused rather than rounded.
 *
 * @param {URL} url
 * @returns {number|null} `null` when the value is not one of the windows.
 */
function parseWindow(url) {
  const raw = url.searchParams.get('days');
  if (raw === null) return DEFAULT_WINDOW;
  const days = Number(raw);
  return INSTANCE_HEALTH_WINDOWS.includes(days) ? days : null;
}

/**
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<true>}
 */
async function handleInstanceHealth({ res, url, storageScope }) {
  const days = parseWindow(url);
  if (days === null) {
    return badRequest(
      res,
      `days must be one of ${INSTANCE_HEALTH_WINDOWS.join(', ')}`,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const since = addDays(today, 1 - days);
  // The census reads organization-owned rows across the instance and answers
  // only aggregates (storage-scope.md § category 4).
  const scope = crossOrganizationScope(
    repoRootOf(storageScope),
    'instance-health census: aggregate counts for the instance admin',
  );

  const [slideTypes, customTypes, settings, rows, firstMeasuredAt] =
    await Promise.all([
      readSlideTypeCensus(scope),
      readCustomTypeCensus(scope),
      readChangedSettingsKeys(scope),
      readInstanceHealth({ sinceDay: since }),
      readFirstInstanceHealthDay(),
    ]);

  serveJson(res, 200, {
    days,
    since,
    firstMeasuredAt,
    decisionDueAt: firstMeasuredAt
      ? addMonths(firstMeasuredAt, DECISION_TERM_MONTHS)
      : null,
    census: { slideTypes, customTypes, settings },
    usage: summarizeInstanceHealth(rows),
  });
  return true;
}

/** @type {import('../../utils/router.js').Route[]} */
export const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/instance-health',
    handler: handleInstanceHealth,
  },
];

/**
 * Handle `/api/instance-health`. Mounted after the auth gate; the user is
 * resolved on the context.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>} true if the request was handled.
 */
export const handleInstanceHealthRoutes = withErrorHandler(
  'instance-health',
  (ctx) => {
    if (!ctx.url.pathname.startsWith('/api/instance-health')) return false;
    if (!ctx.authedUser) {
      return unauthorized(ctx.res, 'Authentication required');
    }
    if (!ctx.authedUser.isAdmin) {
      return forbidden(ctx.res, 'Admin access required');
    }
    return dispatchRoutes(ROUTES, ctx);
  },
);
