/**
 * Home aggregation endpoint.
 *
 * `GET /api/home` returns, in a single round-trip, everything the Home view
 * currently fetches asynchronously after mount:
 *
 *   - `popular`       — popular presentations (same as `/api/presentations/popular`)
 *   - `activity`      — the "from others" feed ({ events, total, limit, offset },
 *                       same shape + access filtering as `/api/activity`)
 *   - `buildingBlocks`— slide collections (personal + team) and recent team
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
} from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';
import { createRouteContext } from '../../utils/context.js';
import { getPopularPresentations } from './presentations/popular.js';
import { getEnrichedActivity } from './activity.js';
import { listTeamLibrary } from '../../storage/slide-library.js';
import { listSlideLibraryUsage } from '../../storage/slide-library-usage.js';
import {
  listPersonalCollections,
  listTeamCollections,
} from '../../storage/collections.js';

/**
 * Build the activity filter opts from the request, mirroring `/api/activity`.
 * Defaults match the Home rail: at most 20 recent events, excluding the user's
 * own (`excludeSelf=false` opts out). The full storage filter surface
 * (since / until / actorEmail / eventTypes[]) is threaded through so a caller
 * can narrow the feed without a second endpoint.
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

  const actorEmail = searchParams.get('actorEmail');
  if (actorEmail) opts.actorEmail = actorEmail;

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
 * @param {object} ctx - { repoRoot, req, res, url, authedUser }
 * @returns {Promise<boolean>} true if handled
 */
export async function handleHome({ repoRoot, req, res, url, authedUser }) {
  if (url.pathname !== '/api/home') return false;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const email = String(authedUser?.email || '').trim().toLowerCase();
  if (!email) return unauthorized(res);

  const ctx = createRouteContext(authedUser);
  const activityOpts = buildActivityOpts(url.searchParams, email);

  // Fire every section's storage read in parallel — the whole point of the
  // aggregation. Each piece degrades to an empty result so one failing section
  // never takes down the rest of Home.
  const [popular, activity, personalCols, teamCols, teamLib, usage] =
    await Promise.all([
      getPopularPresentations({ user: authedUser }).catch(() => []),
      getEnrichedActivity({ repoRoot, authedUser, ctx, opts: activityOpts }).catch(
        () => ({ events: [], total: 0, limit: activityOpts.limit, offset: 0 })
      ),
      listPersonalCollections(repoRoot, email).catch(() => ({ items: [] })),
      listTeamCollections(repoRoot, { userEmail: email }).catch(() => ({ items: [] })),
      listTeamLibrary(repoRoot, { userEmail: email }).catch(() => ({ items: [] })),
      listSlideLibraryUsage(repoRoot, email).catch(() => ({ items: [] })),
    ]);

  const asItems = (r) => (Array.isArray(r?.items) ? r.items : []);

  serveJson(res, 200, {
    ok: true,
    popular: Array.isArray(popular) ? popular : [],
    activity,
    buildingBlocks: {
      collections: {
        personal: asItems(personalCols),
        team: asItems(teamCols),
      },
      teamSlides: asItems(teamLib),
    },
    usage: { items: asItems(usage) },
  });
  return true;
}
