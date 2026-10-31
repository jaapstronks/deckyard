import { withDbGuard } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { toStorageContext } from '../scope.js';
import {
  deckHasPublicEditionSql,
  latestPublicEditionsForDecks,
} from '../editions.js';

/**
 * Get the set of presentation IDs that have a public edition.
 */
export async function getPublishedPresentationIds(scope, presentationIds) {
  toStorageContext(scope, 'getPublishedPresentationIds');
  if (presentationIds.length === 0) return new Set();

  return withDbGuard(new Set(), async () => {
    const published = await latestPublicEditionsForDecks(
      scope,
      presentationIds,
    );
    return new Set(published.keys());
  });
}

/**
 * Get collaborator counts for presentations.
 */
export async function getCollaboratorCounts(scope, presentationIds) {
  toStorageContext(scope, 'getCollaboratorCounts');
  if (presentationIds.length === 0) return new Map();

  return withDbGuard(new Map(), async (db) => {
    const orgId = getOrgId(scope);

    const rows = await db
      .selectFrom('presentation_collaborators')
      .select(['presentation_id'])
      .select((eb) => eb.fn.count('id').as('count'))
      .where('presentation_id', 'in', presentationIds)
      .where('organization_id', '=', orgId)
      .where('revoked_at', 'is', null)
      .groupBy('presentation_id')
      .execute();

    const counts = new Map();
    for (const row of rows) {
      counts.set(row.presentation_id, Number(row.count) || 0);
    }
    return counts;
  });
}

/** Read recent organization-visible or published candidates; callers enforce read access. */
export async function getPopularPresentationRows(scope) {
  toStorageContext(scope, 'getPopularPresentationRows');
  return withDbGuard([], async (db) => {
    const orgId = getOrgId(scope);

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
          deckHasPublicEditionSql('p.id'),
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
            deckHasPublicEditionSql('p.id'),
          ]),
        )
        .orderBy('p.modified_at', 'desc')
        .limit(10)
        .execute();

      return fallbackRows;
    }

    return rows;
  });
}
