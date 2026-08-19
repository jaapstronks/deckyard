/**
 * Route handlers for activity feed.
 * Provides endpoints for listing events and tracking read status.
 */

import {
  methodNotAllowed,
  serveJson,
  unauthorized,
  requireJsonBody,
  withErrorHandler,
} from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';
import {
  listActivityEvents,
  getUnreadEventCountsByPresentation,
  updateUserEventRead,
} from '../../storage/activity-events.js';
import { dispatchRoutes } from '../../utils/router.js';
import { getPresentation } from '../../storage/presentations/index.js';
import { canReadPresentation } from '../../utils/presentation-authz.js';
import { getCollaboratorPermission } from '../../storage/collaborators.js';

// GET /api/activity - List activity events
async function handleActivityList({ storageScope, res, url, authedUser }) {
  const email = String(authedUser?.email || '').trim();

  // Parse query params
  const { limit, offset } = parsePaginationParams(url.searchParams);
  const presentationId = url.searchParams.get('presentationId') || null;
  const eventType = url.searchParams.get('eventType') || null;
  const excludeSelf = url.searchParams.get('excludeSelf') === 'true';

  const opts = {
    limit,
    offset,
    presentationId,
    eventType,
  };

  // Optionally exclude the user's own events
  if (excludeSelf) {
    opts.excludeActorEmail = email;
  }

  const payload = await getEnrichedActivity({ storageScope, authedUser, opts });

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
 * List activity events and enrich them with readable presentation info,
 * dropping events on presentations the user cannot access. Shared by the
 * standalone `/api/activity` route and the `/api/home` aggregation so both
 * apply the same access filtering and event shape.
 *
 * @param {object} args
 * @param {import('../../storage/scope.js').StorageScope} args.storageScope - The request's storage scope
 * @param {object} args.authedUser
 * @param {object} args.opts - listActivityEvents filters (limit, offset,
 *   presentationId, eventType, eventTypes[], actorEmail, excludeActorEmail,
 *   since, until)
 * @returns {Promise<{events: object[], total: number, limit: number, offset: number}>}
 */
export async function getEnrichedActivity({ storageScope, authedUser, opts }) {
  const result = await listActivityEvents(storageScope, opts);
  const events = await enrichEventsWithPresentations(
    result.events,
    storageScope,
    authedUser,
  );
  return {
    events,
    // Note: total may be higher than accessible events; this is acceptable
    // as the client handles pagination gracefully.
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  };
}

/**
 * Fetch a presentation and return it only if the user can read it
 * (collaborator-aware). Returns null when missing or not accessible.
 */
async function getReadablePresentation(pid, storageScope, authedUser) {
  try {
    const pres = await getPresentation(storageScope, pid);
    if (!pres) return null;

    let collaboratorPermission = null;
    try {
      collaboratorPermission = await getCollaboratorPermission(
        pid,
        authedUser?.email,
      );
    } catch {
      // Ignore - no collaborator access
    }

    const hasAccess = canReadPresentation({
      user: authedUser,
      pres,
      collaboratorPermission,
    });

    return hasAccess ? pres : null;
  } catch {
    // Presentation may have been deleted
    return null;
  }
}

/**
 * Enrich events with presentation information and filter by access.
 * Fetches presentation titles for events that reference presentations,
 * and filters out events for presentations the user cannot access.
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
        }
      }

      return enriched;
    });
}
