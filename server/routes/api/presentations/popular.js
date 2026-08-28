/**
 * Popular presentations API endpoint.
 * Returns presentations with recent activity, sorted by most recent views.
 */

import { getOrgId } from '../../../utils/context.js';
import { serveJson, unauthorized } from '../../../utils/http.js';
import { withDbGuard } from '../../../storage/utils/index.js';
import { getTagsForPresentations } from '../../../storage/tags.js';
import { canReadPresentation } from '../../../utils/presentation-authz/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import {
  resolveDisplayNames,
  toDisplayIdentity,
} from '../../../storage/display-identity.js';
import { withDeckCardFields } from '../../../utils/deck-card-fields.js';

/**
 * Get popular presentations based on recent activity.
 * Returns presentations that are organization-visible or published,
 * sorted by recent activity (views, updates).
 */
export async function handlePopularPresentations({
  repoRoot,
  storageScope,
  res,
  authedUser,
}) {
  if (!authedUser) {
    return unauthorized(res);
  }

  // The organization comes from the request's storage scope, so this list stays
  // inside the organization the session is working in. `repoRoot` rides along
  // because the deck-card fields need it to resolve each deck's theme.
  const ctx = {
    repoRoot,
    user: authedUser,
    organizationId: storageScope?.organizationId,
  };
  const presentations = await getPopularPresentations(ctx);

  serveJson(res, 200, presentations);
  return true;
}

/**
 * Fetch popular presentations from the database.
 * Uses activity_events to find presentations with recent activity.
 * Exported so the `/api/home` aggregation can reuse the exact same list.
 * @param {{ repoRoot?: string, user: object, organizationId?: string }} ctx -
 *   Carries the session's organization; it doubles as the storage scope for the
 *   tag lookup and as the theme-resolution context for the deck-card fields.
 * @returns {Promise<object[]>}
 */
export async function getPopularPresentations(ctx) {
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    // Get presentations with recent activity (last 30 days)
    // Prioritize presentations with more recent activity
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Query: Find presentations with activity events, sorted by most recent
    // Filter to organization visibility OR published presentations
    const rows = await db
      .selectFrom('presentations as p')
      .leftJoin('activity_events as ae', (join) =>
        join
          .onRef('ae.presentation_id', '=', 'p.id')
          .on('ae.organization_id', '=', orgId)
          .on('ae.created_at', '>=', thirtyDaysAgo),
      )
      .leftJoin('published_presentations as pub', 'pub.presentation_id', 'p.id')
      .select([
        'p.id',
        'p.title',
        'p.theme',
        'p.visibility',
        'p.owner_user_id',
        'p.owner_email',
        'p.created_by_user_id',
        'p.created_by',
        'p.updated_by_user_id',
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
          eb('p.visibility', '=', 'organization'),
          eb('pub.id', 'is not', null),
        ]),
      )
      .groupBy([
        'p.id',
        'p.title',
        'p.theme',
        'p.visibility',
        'p.owner_user_id',
        'p.owner_email',
        'p.created_by_user_id',
        'p.created_by',
        'p.updated_by_user_id',
        'p.updated_by',
        'p.created_at',
        'p.modified_at',
        'p.slides',
      ])
      .having((eb) => eb.fn.count('ae.id'), '>', 0)
      .orderBy('last_activity', 'desc')
      .limit(10)
      .execute();

    // If no presentations with activity, fall back to recently modified organization-visible presentations
    if (rows.length === 0) {
      const fallbackRows = await db
        .selectFrom('presentations as p')
        .leftJoin(
          'published_presentations as pub',
          'pub.presentation_id',
          'p.id',
        )
        .select([
          'p.id',
          'p.title',
          'p.theme',
          'p.visibility',
          'p.owner_user_id',
          'p.owner_email',
          'p.created_by_user_id',
          'p.created_by',
          'p.updated_by_user_id',
          'p.updated_by',
          'p.created_at',
          'p.modified_at',
          'p.slides',
        ])
        .where('p.organization_id', '=', orgId)
        .where('p.trashed_at', 'is', null)
        .where((eb) =>
          eb.or([
            eb('p.visibility', '=', 'organization'),
            eb('pub.id', 'is not', null),
          ]),
        )
        .orderBy('p.modified_at', 'desc')
        .limit(10)
        .execute();

      return formatPresentations(
        await filterReadableRows(fallbackRows, ctx),
        ctx,
      );
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
  // Every row here came out of a query scoped on getOrgId(ctx), so the deck's
  // organization is the one the request is acting in. Naming it explicitly
  // keeps this hand-built presentation shape readable by the authorization
  // layer, which refuses an organization-visible deck whose organization it cannot see.
  const organizationId = getOrgId(ctx);
  const readable = [];
  for (const row of rows) {
    // The deciders key on the stable ids (shared/identity-match.js); the
    // creator arrives as a pair with the id half, like every mapped deck.
    const pres = {
      id: row.id,
      organizationId,
      visibility: row.visibility,
      ownerId: row.owner_user_id || null,
      ownerEmail: row.owner_email,
      createdBy: { id: row.created_by_user_id || null },
    };
    let collaboratorPermission = null;
    if (canReadPresentation({ user, pres })) {
      readable.push(row);
      continue;
    }
    try {
      collaboratorPermission = await getCollaboratorPermission(
        row.id,
        user?.email,
      );
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
  const tagsMap = await getTagsForPresentations(ctx, presentationIds);

  // One batched lookup for the whole board (D22); see
  // server/storage/display-identity.js.
  const displayNames = await resolveDisplayNames(
    rows.flatMap((row) => [
      { id: row.updated_by_user_id, email: row.updated_by },
      { id: row.created_by_user_id, email: row.created_by },
    ]),
  );

  const items = rows.map((row) => {
    // Extract first slide from slides JSONB array
    const slides = Array.isArray(row.slides) ? row.slides : [];
    const first = slides[0] || null;

    return {
      id: row.id,
      title: row.title,
      theme: row.theme,
      visibility: row.visibility,
      // The owner keeps both fields (key + an address colleagues in the org
      // may have); the creator is named, not addressed (D22).
      ownerId: row.owner_user_id || null,
      ownerEmail: row.owner_email,
      createdBy: toDisplayIdentity(
        row.created_by_user_id,
        row.created_by,
        displayNames,
      ),
      updatedBy: toDisplayIdentity(
        row.updated_by_user_id,
        row.updated_by,
        displayNames,
      ),
      created: row.created_at,
      modified: row.modified_at,
      hasSlides: !!first,
      tags: tagsMap.get(row.id) || [],
      activityCount: Number(row.activity_count) || 0,
      lastActivity: row.last_activity || row.modified_at,
    };
  });

  return withDeckCardFields(ctx?.repoRoot, items, ctx);
}
