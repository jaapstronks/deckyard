/**
 * Route handlers for activity feed.
 * Provides endpoints for listing events and tracking read status.
 *
 *   GET /api/activity?limit=20&cursor=…&excludeSelf=true - One page of the
 *     feed on the list-page contract (D358): `{ events, nextCursor }`.
 */

import {
  methodNotAllowed,
  serveJson,
  unauthorized,
  requireJsonBody,
  withErrorHandler,
} from '../../utils/http.js';
import {
  listActivityEvents,
  getUnreadEventCountsByPresentation,
  updateUserEventRead,
} from '../../storage/activity-events.js';
import { dispatchRoutes } from '../../utils/router.js';
import { resolveDeckLang } from '../../../shared/i18n-utils.js';
import {
  listReader,
  loadPresentationForActor,
} from '../../services/presentations.js';
import { listPageResult, parseListPage } from '../../services/list-page.js';

// GET /api/activity - List activity events
async function handleActivityList({ storageScope, res, url, authedUser }) {
  const query = parseActivityQuery(url.searchParams);
  const payload = await getEnrichedActivity({
    storageScope,
    authedUser,
    ...query,
  });

  serveJson(res, 200, {
    ok: true,
    ...payload,
  });
  return true;
}

// GET /api/activity/unread-count - Get unread event count
async function handleUnreadCount({ storageScope, res, authedUser }) {
  const email = String(authedUser?.email || '').trim();

  // Same invariant as the feed itself: only count events on presentations
  // the user can read (a raw org-wide count leaks activity on private decks).
  const grouped = await getUnreadEventCountsByPresentation(storageScope, email);
  let count = 0;
  for (const entry of grouped) {
    if (!entry.presentationId) {
      count += entry.count;
      continue;
    }
    const pres = await getReadablePresentation(
      entry.presentationId,
      storageScope,
      authedUser,
    );
    if (pres) count += entry.count;
  }

  serveJson(res, 200, {
    ok: true,
    count,
  });
  return true;
}

// POST /api/activity/mark-read - Mark events as read
async function handleMarkRead({ storageScope, req, res, authedUser }) {
  const email = String(authedUser?.email || '').trim();

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const eventId = body?.eventId || null; // Can be null to mark "all read"

  const result = await updateUserEventRead(storageScope, email, eventId);

  serveJson(res, 200, result);
  return true;
}

/**
 * Declarative route table for `/api/activity*` (A7.19 C8). Order matches the
 * previous if-chain; each path sent an explicit 405 for the wrong method,
 * preserved here as trailing catch-all rows.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/activity', handler: handleActivityList },
  {
    pattern: '/api/activity',
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
  {
    method: 'GET',
    pattern: '/api/activity/unread-count',
    handler: handleUnreadCount,
  },
  {
    pattern: '/api/activity/unread-count',
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
  {
    method: 'POST',
    pattern: '/api/activity/mark-read',
    handler: handleMarkRead,
  },
  {
    pattern: '/api/activity/mark-read',
    handler: ({ res }) => methodNotAllowed(res, ['POST']),
  },
];

/**
 * Handle activity API routes. The module-wide auth guard (a valid email) runs
 * before dispatch, exactly as the original chain did — an unauthenticated
 * request gets a 401 for any of these paths, not a fall-through.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleActivity = withErrorHandler('activity', (ctx) => {
  const email = String(ctx.authedUser?.email || '').trim();
  if (!email) return unauthorized(ctx.res);
  return dispatchRoutes(ROUTES, ctx);
});

/**
 * Read the feed's filters and page from a query string: one parse for
 * `/api/activity` and the `/api/home` rail, so both refuse the same inputs.
 * The filters are the cursor's fingerprint (server/services/list-page.js): a
 * cursor is only valid with the filters it was made under.
 *
 * @param {URLSearchParams} searchParams - `limit`, `cursor`, `presentationId`,
 *   `eventType`, `eventTypes[]`, `since`, `until`, `excludeSelf`.
 * @param {Object} [options]
 * @param {boolean} [options.excludeSelfByDefault=false] - Whether the reader's
 *   own events are left out when `excludeSelf` is absent (Home: yes).
 * @param {number} [options.defaultLimit] - Page size when none is named.
 * @returns {{filters: Object, page: import('../../services/list-page.js').ListPage}}
 * @throws {import('../../utils/errors.js').AppError} 400 `invalid` naming
 *   `limit`, `cursor` or a refused `offset`.
 */
export function parseActivityQuery(
  searchParams,
  { excludeSelfByDefault = false, defaultLimit } = {},
) {
  const excludeSelf = searchParams.has('excludeSelf')
    ? searchParams.get('excludeSelf') === 'true'
    : excludeSelfByDefault;
  const eventTypes = searchParams.getAll('eventTypes[]').filter(Boolean);
  const filters = {
    presentationId: searchParams.get('presentationId') || null,
    eventType: searchParams.get('eventType') || null,
    eventTypes: eventTypes.length ? [...eventTypes].sort() : null,
    since: searchParams.get('since') || null,
    until: searchParams.get('until') || null,
    excludeSelf,
  };
  const page = parseListPage(searchParams, {
    sortKey: 'created_desc',
    filters,
    ...(defaultLimit ? { defaultLimit } : {}),
  });
  return { filters, page };
}

/**
 * One page of the activity feed, enriched with the readable deck each event
 * is on. Which events the reader may see is decided in the query
 * (`listActivityEvents`), so every page but the last is full (B823). Shared by
 * `/api/activity` and the `/api/home` aggregation.
 *
 * @param {object} args
 * @param {import('../../storage/scope.js').StorageScope} args.storageScope - The request's storage scope
 * @param {object} args.authedUser - The reader.
 * @param {object} args.filters - From {@link parseActivityQuery}.
 * @param {import('../../services/list-page.js').ListPage} args.page
 * @returns {Promise<{events: object[], nextCursor: string|null}>}
 */
export async function getEnrichedActivity({
  storageScope,
  authedUser,
  filters,
  page,
}) {
  const { excludeSelf, ...narrowing } = filters;
  const result = await listActivityEvents(
    storageScope,
    {
      ...narrowing,
      reader: await listReader(authedUser),
      excludeActorEmail: excludeSelf ? authedUser?.email : undefined,
    },
    { limit: page.limit, after: page.after },
  );
  const { events, nextCursor } = listPageResult('events', result, page);
  return {
    events: await enrichEventsWithPresentations(
      events,
      storageScope,
      authedUser,
    ),
    nextCursor,
  };
}

/**
 * Fetch a presentation and return it only if the user can read it
 * (collaborator-aware). Returns null when missing or not accessible.
 */
async function getReadablePresentation(pid, storageScope, authedUser) {
  try {
    return await loadPresentationForActor(
      storageScope,
      { actor: authedUser },
      pid,
    );
  } catch {
    // Deleted since the event, or not readable by this user: leave it out.
    return null;
  }
}

/**
 * Enrich events with presentation information. Fetches the deck of each event
 * that references one, for its title and the rail's slide preview.
 *
 * The query already decided which events the reader may see; the by-id load
 * here asks the same question again and drops an event whose deck it refuses.
 * That only happens when the deck changed between the two reads (unshared,
 * moved, deleted), and then dropping is the safe side; it is not the filter,
 * tests/pg/activity-list-page.pgtest.js holds both answers equal.
 */
async function enrichEventsWithPresentations(events, storageScope, authedUser) {
  // Collect unique presentation IDs
  const presentationIds = new Set();
  for (const event of events) {
    if (event.presentationId) {
      presentationIds.add(event.presentationId);
    }
  }

  // Fetch presentations and check access. Keep the full presentation around
  // (request-scoped, in memory) so we can resolve a commented slide for the
  // activity rail's preview thumbnail without a second read.
  const presMap = new Map();
  const accessibleIds = new Set();

  for (const pid of presentationIds) {
    const pres = await getReadablePresentation(pid, storageScope, authedUser);
    if (pres) {
      accessibleIds.add(pid);
      presMap.set(pid, pres);
    }
  }

  // Filter and enrich events - only include events for accessible presentations
  return events
    .filter((event) => {
      // Include events that don't reference a presentation (rare, but possible)
      if (!event.presentationId) return true;
      // Only include events for presentations the user can access
      return accessibleIds.has(event.presentationId);
    })
    .map((event) => {
      const pres = event.presentationId
        ? presMap.get(event.presentationId)
        : null;
      const enriched = {
        ...event,
        presentation: pres
          ? { id: pres.id, title: pres.title, ownerEmail: pres.ownerEmail }
          : null,
      };

      // Attach the commented slide (a minimal projection) + the deck theme so
      // the rail can render a small preview thumbnail client-side, reusing the
      // same slide renderer the presentation cards use. Only for new comments
      // (the rail's thumb case), and only when the slide still resolves in a
      // deck the user may already read — so it leaks nothing.
      if (
        pres &&
        event.eventType === 'comment.created' &&
        event.data?.slideId
      ) {
        const slide = (Array.isArray(pres.slides) ? pres.slides : []).find(
          (s) => s?.id === event.data.slideId,
        );
        if (slide) {
          enriched.slide = {
            id: slide.id,
            type: slide.type,
            content: slide.content || {},
          };
          enriched.themeId = pres.theme || null;
          // The deck's language rides along with its theme: the rail renders
          // this slide client-side, and an interactive type without a language
          // falls back to DEFAULT_SLIDE_COPY_LANG
          // (docs/reference/slide-copy-language.md).
          enriched.slideLang = resolveDeckLang(pres);
        }
      }

      return enriched;
    });
}
