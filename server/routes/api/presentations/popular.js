/**
 * Popular presentations API endpoint.
 * Returns presentations with recent activity, sorted by most recent views.
 */

import { getOrgId } from '../../../utils/context.js';
import { serveJson, unauthorized, methodNotAllowed } from '../../../utils/http.js';
import { withDbGuard } from '../../../storage/utils/db-guard.js';
import { getTagsForPresentations } from '../../../storage/tags.js';
import { canReadPresentation } from '../../../utils/presentation-authz.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';

/**
 * Get popular presentations based on recent activity.
 * Returns presentations that are workspace-scoped or published,
 * sorted by recent activity (views, updates).
 */
export async function handlePopularPresentations({ res, authedUser }) {
  if (!authedUser) {
    return unauthorized(res);
  }

  const ctx = { user: authedUser };
  const presentations = await getPopularPresentations(ctx);

  serveJson(res, 200, presentations);
  return true;
}

/**
 * Fetch popular presentations from the database.
 * Uses activity_events to find presentations with recent activity.
 */
async function getPopularPresentations(ctx) {
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    // Get presentations with recent activity (last 30 days)
    // Prioritize presentations with more recent activity
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Query: Find presentations with activity events, sorted by most recent
    // Filter to workspace scope OR published presentations
    const rows = await db
      .selectFrom('presentations as p')
      .leftJoin('activity_events as ae', (join) =>
        join
          .onRef('ae.presentation_id', '=', 'p.id')
          .on('ae.organization_id', '=', orgId)
          .on('ae.created_at', '>=', thirtyDaysAgo)
      )
      .leftJoin('published_presentations as pub', 'pub.presentation_id', 'p.id')
      .select([
        'p.id',
        'p.title',
        'p.theme',
        'p.scope',
        'p.owner_email',
        'p.created_by',
        'p.updated_by',
        'p.created_at',
        'p.modified_at',
        'p.slides',
      ])
      .select((eb) => eb.fn.count('ae.id').as('activity_count'))
      .select((eb) => eb.fn.max('ae.created_at').as('last_activity'))
      .where('p.organization_id', '=', orgId)
      .where('p.trashed_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('p.scope', '=', 'workspace'),
          eb('pub.id', 'is not', null),
        ])
      )
      .groupBy([
        'p.id',
        'p.title',
        'p.theme',
        'p.scope',
        'p.owner_email',
        'p.created_by',
        'p.updated_by',
        'p.created_at',
        'p.modified_at',
        'p.slides',
      ])
      .having((eb) => eb.fn.count('ae.id'), '>', 0)
      .orderBy('last_activity', 'desc')
      .limit(10)
      .execute();

    // If no presentations with activity, fall back to recently modified workspace presentations
    if (rows.length === 0) {
      const fallbackRows = await db
        .selectFrom('presentations as p')
        .leftJoin('published_presentations as pub', 'pub.presentation_id', 'p.id')
        .select([
          'p.id',
          'p.title',
          'p.theme',
          'p.scope',
          'p.owner_email',
          'p.created_by',
          'p.updated_by',
          'p.created_at',
          'p.modified_at',
          'p.slides',
        ])
        .where('p.organization_id', '=', orgId)
        .where('p.trashed_at', 'is', null)
        .where((eb) =>
          eb.or([
            eb('p.scope', '=', 'workspace'),
            eb('pub.id', 'is not', null),
          ])
        )
        .orderBy('p.modified_at', 'desc')
        .limit(10)
        .execute();

      return formatPresentations(await filterReadableRows(fallbackRows, ctx), ctx);
    }

    return formatPresentations(await filterReadableRows(rows, ctx), ctx);
  });
}

/**
 * Drop rows the user cannot read. The query keeps published private decks
 * in scope for their own readers, but a card must never surface a deck
 * (title + first-slide thumbnail) the click can't open.
 */
async function filterReadableRows(rows, ctx) {
  const user = ctx?.user || null;
  const readable = [];
  for (const row of rows) {
    const pres = {
      id: row.id,
      scope: row.scope,
      ownerEmail: row.owner_email,
      createdBy: row.created_by,
    };
    let collaboratorPermission = null;
    if (canReadPresentation({ user, pres })) {
      readable.push(row);
      continue;
    }
    try {
      collaboratorPermission = await getCollaboratorPermission(row.id, user?.email, ctx);
    } catch {
      collaboratorPermission = null;
    }
    if (canReadPresentation({ user, pres, collaboratorPermission })) {
      readable.push(row);
    }
  }
  return readable;
}

/**
 * Format database rows into presentation objects.
 */
async function formatPresentations(rows, ctx) {
  if (rows.length === 0) return [];

  // Get tags for all presentations
  const presentationIds = rows.map((r) => r.id);
  const tagsMap = await getTagsForPresentations(presentationIds);

  return rows.map((row) => {
    // Extract first slide from slides JSONB array
    const slides = Array.isArray(row.slides) ? row.slides : [];
    const first = slides[0] || null;
    const firstSlide = first
      ? { id: first.id, type: first.type, content: first.content || {} }
      : null;

    return {
      id: row.id,
      title: row.title,
      theme: row.theme,
      scope: row.scope,
      ownerEmail: row.owner_email,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      created: row.created_at,
      modified: row.modified_at,
      firstSlide,
      tags: tagsMap.get(row.id) || [],
      activityCount: Number(row.activity_count) || 0,
      lastActivity: row.last_activity || row.modified_at,
    };
  });
}
