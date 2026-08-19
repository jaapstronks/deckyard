/**
 * Home aggregation endpoint.
 *
 * `GET /api/home` returns, in a single round-trip, everything the Home view
 * currently fetches asynchronously after mount:
 *
 *   - `popular`       — popular presentations (same as `/api/presentations/popular`)
 *   - `activity`      — the "from others" feed ({ events, total, limit, offset },
 *                       same shape + access filtering as `/api/activity`)
 *   - `buildingBlocks`— slide collections (personal + organization) and recent organization
 *                       library slides for the shelf
 *   - `usage`         — the current user's slide-library usage set (powers the
 *                       "new to you" badge)
 *
 * Deliberately excluded: `recent` and total `counts`. Home derives those
 * synchronously from the full presentation list `list.js` already loads once
 * (and shares with the Presentations / search views), so re-deriving them here
 * would add latency for data the client discards.
 *
 * This is a convenience aggregation only. The individual endpoints remain for
 * MCP / external callers, and the Home view falls back to them if this fails.
 */

import {
  serveJson,
  unauthorized,
  methodNotAllowed,
  withErrorHandler,
} from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import { parsePaginationParams } from '../../utils/request-validators.js';
import { getPopularPresentations } from './presentations/popular.js';
import { getEnrichedActivity } from './activity.js';
import { listOrganizationLibrary } from '../../storage/slide-library/index.js';
import { listSlideLibraryUsage } from '../../storage/slide-library-usage/index.js';
import {
  listPersonalCollections,
  listOrganizationCollections,
} from '../../storage/collections/index.js';

/**
 * Build the activity filter opts from the request, mirroring `/api/activity`.
 * Defaults match the Home rail: at most 20 recent events, excluding the user's
 * own (`excludeSelf=false` opts out). The full storage filter surface
 * (since / until / eventTypes[]) is threaded through so a caller can narrow the
 * feed without a second endpoint. There is no actor filter: the only one that
 * ever existed keyed on an address the response no longer carries (D22), and no
 * client ever sent it.
 *
 * @param {URLSearchParams} searchParams
 * @param {string} email - current user's email (for excludeSelf)
 * @returns {object} listActivityEvents opts
 */
export function buildActivityOpts(searchParams, email) {
  const { limit, offset } = parsePaginationParams(searchParams, {
    defaultLimit: 20,
    maxLimit: 100,
  });

  const opts = { limit, offset };

  const eventType = searchParams.get('eventType');
  if (eventType) opts.eventType = eventType;

  const eventTypes = searchParams.getAll('eventTypes[]');
  if (eventTypes.length > 0) opts.eventTypes = eventTypes;

  const since = searchParams.get('since');
  if (since) opts.since = since;

  const until = searchParams.get('until');
  if (until) opts.until = until;

  const presentationId = searchParams.get('presentationId');
  if (presentationId) opts.presentationId = presentationId;

  // Home wants "what others did", so exclude self by default; opt out explicitly.
  if (searchParams.get('excludeSelf') !== 'false' && email) {
    opts.excludeActorEmail = email;
  }

  return opts;
}

/**
 * Handle `GET /api/home`.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>} true if handled
 */
async function handleHomeGet({ storageScope, res, url, authedUser }) {
  const email = String(authedUser?.email || '')
    .trim()
    .toLowerCase();
  if (!email) return unauthorized(res);

  const activityOpts = buildActivityOpts(url.searchParams, email);

  // Fire every section's storage read in parallel — the whole point of the
  // aggregation. Each piece degrades to an empty result so one failing section
  // never takes down the rest of Home.
  const [
    popular,
    activity,
    personalCols,
    organizationCols,
    organizationLib,
    usage,
  ] = await Promise.all([
    getPopularPresentations({
      user: authedUser,
      organizationId: storageScope?.organizationId,
    }).catch(() => []),
    getEnrichedActivity({ storageScope, authedUser, opts: activityOpts }).catch(
      () => ({ events: [], total: 0, limit: activityOpts.limit, offset: 0 }),
    ),
    listPersonalCollections(storageScope, email).catch(() => ({ items: [] })),
    listOrganizationCollections(storageScope, { userEmail: email }).catch(
      () => ({ items: [] }),
    ),
    listOrganizationLibrary(storageScope, { userEmail: email }).catch(() => ({
      items: [],
    })),
    listSlideLibraryUsage(storageScope, email).catch(() => ({ items: [] })),
  ]);

  const asItems = (r) => (Array.isArray(r?.items) ? r.items : []);

  serveJson(res, 200, {
    ok: true,
    popular: Array.isArray(popular) ? popular : [],
    activity,
    buildingBlocks: {
      collections: {
        personal: asItems(personalCols),
        organization: asItems(organizationCols),
      },
      organizationSlides: asItems(organizationLib),
    },
    usage: { items: asItems(usage) },
  });
  return true;
}

/**
 * Declarative route table for `/api/home` (A7.19 C8). Form B: the original ran
 * its method check *before* the auth check (a wrong method 405'd, no user 401'd),
 * so the explicit 405 catch-all sits after the GET row and a non-GET request
 * reaches it before `handleHomeGet` ever runs its auth guard.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/home', handler: handleHomeGet },
  {
    pattern: '/api/home',
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
];

/**
 * Handle `/api/home` requests.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleHome = withErrorHandler('home', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
