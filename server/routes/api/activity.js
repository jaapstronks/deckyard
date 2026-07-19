/**
 * Route handlers for activity feed.
 * Provides endpoints for listing events and tracking read status.
 */

import {
  json,
  methodNotAllowed,
  serveJson,
  unauthorized,
} from '../../utils/http.js';
import { parsePaginationParams } from '../../utils/request-validators.js';
import {
  listActivityEvents,
  getUnreadEventCountsByPresentation,
  updateUserEventRead,
} from '../../storage/activity-events.js';
import { createRouteContext } from '../../utils/context.js';
import { getPresentation } from '../../storage/presentations.js';
import { canReadPresentation } from '../../utils/presentation-authz.js';
import { getCollaboratorPermission } from '../../storage/collaborators.js';

const getCtx = createRouteContext;

/**
 * Handle activity API routes.
 */
export async function handleActivity({ repoRoot, req, res, url, authedUser }) {
  const email = String(authedUser?.email || '').trim();
  if (!email) return unauthorized(res);

  const ctx = getCtx(authedUser);

  // GET /api/activity - List activity events
  if (url.pathname === '/api/activity') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

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

    const payload = await getEnrichedActivity({ repoRoot, authedUser, ctx, opts });

    serveJson(res, 200, {
      ok: true,
      ...payload,
    });
    return true;
  }

  // GET /api/activity/unread-count - Get unread event count
  if (url.pathname === '/api/activity/unread-count') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

    // Same invariant as the feed itself: only count events on presentations
    // the user can read (a raw org-wide count leaks activity on private decks).
    const grouped = await getUnreadEventCountsByPresentation(email, ctx);
    let count = 0;
    for (const entry of grouped) {
      if (!entry.presentationId) {
        count += entry.count;
        continue;
      }
      const pres = await getReadablePresentation(
        entry.presentationId,
        repoRoot,
        authedUser,
        ctx
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
  if (url.pathname === '/api/activity/mark-read') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const body = await json(req);
    const eventId = body?.eventId || null; // Can be null to mark "all read"

    const result = await updateUserEventRead(email, eventId, ctx);

    serveJson(res, 200, result);
    return true;
  }

  return false;
}

/**
 * List activity events and enrich them with readable presentation info,
 * dropping events on presentations the user cannot access. Shared by the
 * standalone `/api/activity` route and the `/api/home` aggregation so both
 * apply the same access filtering and event shape.
 *
 * @param {object} args
 * @param {string} args.repoRoot
 * @param {object} args.authedUser
 * @param {object} args.ctx - storage/route context
 * @param {object} args.opts - listActivityEvents filters (limit, offset,
 *   presentationId, eventType, eventTypes[], actorEmail, excludeActorEmail,
 *   since, until)
 * @returns {Promise<{events: object[], total: number, limit: number, offset: number}>}
 */
export async function getEnrichedActivity({ repoRoot, authedUser, ctx, opts }) {
  const result = await listActivityEvents(ctx, opts);
  const events = await enrichEventsWithPresentations(
    result.events,
    repoRoot,
    authedUser,
    ctx
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
async function getReadablePresentation(pid, repoRoot, authedUser, ctx) {
  try {
    const pres = await getPresentation(repoRoot, pid);
    if (!pres) return null;

    let collaboratorPermission = null;
    try {
      collaboratorPermission = await getCollaboratorPermission(pid, authedUser?.email, ctx);
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
async function enrichEventsWithPresentations(events, repoRoot, authedUser, ctx) {
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
    const pres = await getReadablePresentation(pid, repoRoot, authedUser, ctx);
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
      const pres = event.presentationId ? presMap.get(event.presentationId) : null;
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
      if (pres && event.eventType === 'comment.created' && event.data?.slideId) {
        const slide = (Array.isArray(pres.slides) ? pres.slides : []).find(
          (s) => s?.id === event.data.slideId
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