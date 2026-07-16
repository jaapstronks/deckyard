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

    const result = await listActivityEvents(ctx, opts);

    // Enrich events with presentation titles and filter by access
    const enrichedEvents = await enrichEventsWithPresentations(
      result.events,
      repoRoot,
      authedUser,
      ctx
    );

    serveJson(res, 200, {
      ok: true,
      events: enrichedEvents,
      // Note: total may be higher than accessible events; this is acceptable
      // as the client handles pagination gracefully
      total: result.total,
      limit: result.limit,
      offset: result.offset,
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

  // Fetch presentations and check access
  const presentations = new Map();
  const accessibleIds = new Set();

  for (const pid of presentationIds) {
    const pres = await getReadablePresentation(pid, repoRoot, authedUser, ctx);
    if (pres) {
      accessibleIds.add(pid);
      presentations.set(pid, {
        id: pres.id,
        title: pres.title,
        ownerEmail: pres.ownerEmail,
      });
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
    .map((event) => ({
      ...event,
      presentation: event.presentationId
        ? presentations.get(event.presentationId) || null
        : null,
    }));
}