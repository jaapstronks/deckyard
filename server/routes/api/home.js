/**
 * Home aggregation endpoint.
 *
 * `GET /api/home` returns, in a single round-trip, everything the Home view
 * currently fetches asynchronously after mount:
 *
 *   - `popular`       — popular presentations (same as `/api/presentations/popular`)
 *   - `activity`      — the "from others" feed ({ events, nextCursor }, same
 *                       page, filters and access as `/api/activity`)
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
import { getPopularPresentations } from './presentations/popular.js';
import { getEnrichedActivity, parseActivityQuery } from './activity.js';
import {
  getLibraryItemsByIds,
  listLibraryShelf,
} from '../../storage/slide-library.js';
import { listSlideLibraryUsage } from '../../storage/slide-library-usage.js';
import {
  listPersonalCollections,
  listOrganizationCollections,
} from '../../storage/collections.js';
import { normalizeEmail } from '../../../shared/email.js';

/**
 * How much of each shelf the building-blocks row reads: it shows at most four
 * collections and six slides (client/views/list/views/home-view.js), so a
 * first page of each is the whole answer (D358, B822).
 */
const HOME_BLOCK_COLLECTIONS = 4;
const HOME_BLOCK_SLIDES = 6;

/**
 * The Home rail's activity page: the `/api/activity` query with Home's
 * defaults, at most 20 recent events and the reader's own left out
 * (`excludeSelf=false` opts out). A bad `limit` or `cursor` is a 400 for the
 * whole aggregation, as it is on `/api/activity`.
 *
 * @param {URLSearchParams} searchParams
 * @returns {ReturnType<typeof parseActivityQuery>}
 */
export function homeActivityQuery(searchParams) {
  return parseActivityQuery(searchParams, {
    excludeSelfByDefault: true,
    defaultLimit: 20,
  });
}

/**
 * Handle `GET /api/home`.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>} true if handled
 */
async function handleHomeGet({ repoRoot, storageScope, res, url, authedUser }) {
  const email = normalizeEmail(authedUser?.email);
  if (!email) return unauthorized(res);

  const activityQuery = homeActivityQuery(url.searchParams);

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
      repoRoot,
      user: authedUser,
      organizationId: storageScope?.organizationId,
    }).catch(() => []),
    getEnrichedActivity({ storageScope, authedUser, ...activityQuery }).catch(
      () => ({ events: [], nextCursor: null }),
    ),
    listPersonalCollections(storageScope, email, {
      limit: HOME_BLOCK_COLLECTIONS,
    }).catch(() => ({ items: [] })),
    listOrganizationCollections(
      storageScope,
      { userEmail: email },
      { limit: HOME_BLOCK_COLLECTIONS },
    ).catch(() => ({ items: [] })),
    listLibraryShelf(
      storageScope,
      { shelf: 'organization', readerEmail: email },
      { limit: HOME_BLOCK_SLIDES },
    ).catch(() => ({ items: [] })),
    listSlideLibraryUsage(storageScope, email).catch(() => ({ items: [] })),
  ]);

  const asItems = (r) => (Array.isArray(r?.items) ? r.items : []);

  // A collection card previews its first slide; resolve those few directly
  // instead of hoping they are among the newest slides.
  const firstIds = [...asItems(personalCols), ...asItems(organizationCols)]
    .map((col) => (Array.isArray(col.slideIds) ? col.slideIds[0] : null))
    .filter(Boolean);
  const collectionSlides = await getLibraryItemsByIds(storageScope, firstIds, {
    userEmail: email,
  }).catch(() => []);

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
      collectionSlides: collectionSlides.filter((item) => !item.trashedAt),
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
