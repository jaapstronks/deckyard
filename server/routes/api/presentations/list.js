import { listPresentationsForActor } from '../../../services/presentations.js';
import { getTagsForPresentations } from '../../../storage/tags.js';
import { serveJson } from '../../../utils/http.js';
import { withDeckCardFields } from '../../../utils/deck-card-fields.js';
import { withDbGuard } from '../../../storage/utils/index.js';
import { getOrgId } from '../../../utils/context.js';

/**
 * GET /api/presentations — the session user's collection (Home), with this
 * route's own enrichment. Who sees what is decided in
 * `listPresentationsForActor` (B607).
 */
export async function handlePresentationsList({
  repoRoot,
  storageScope,
  res,
  authedUser,
} = {}) {
  const { presentations: filtered } = await listPresentationsForActor(
    storageScope,
    { actor: authedUser },
  );

  // Fetch tags for all presentations in the list
  const presentationIds = filtered.map((p) => p.id);
  const tagsMap = await getTagsForPresentations(storageScope, presentationIds);

  // Fetch published status and collaborator counts. The organization rides
  // along on the request's storage scope, so these stay in the session's
  // organization instead of resolving against the instance default.
  const ctx = {
    user: authedUser,
    organizationId: storageScope?.organizationId,
  };
  const publishedSet = await getPublishedPresentationIds(presentationIds, ctx);
  const collaboratorCounts = await getCollaboratorCounts(presentationIds, ctx);

  // Attach tags, isPublished and collaboratorCount here — they are this route's
  // own enrichment; the fields every deck-card producer owes the grid come from
  // the shared mapper.
  const withMetadata = await withDeckCardFields(
    repoRoot,
    filtered.map((p) => ({
      ...p,
      tags: tagsMap.get(p.id) || [],
      isPublished: publishedSet.has(p.id),
      collaboratorCount: collaboratorCounts.get(p.id) || 0,
    })),
    storageScope,
  );

  serveJson(res, 200, withMetadata);
  return true;
}

/**
 * Get the set of presentation IDs that are published.
 */
async function getPublishedPresentationIds(presentationIds, ctx) {
  if (presentationIds.length === 0) return new Set();

  return withDbGuard(new Set(), async (db) => {
    const rows = await db
      .selectFrom('published_presentations')
      .select('presentation_id')
      .where('presentation_id', 'in', presentationIds)
      .execute();

    return new Set(rows.map((r) => r.presentation_id));
  });
}

/**
 * Get collaborator counts for presentations.
 */
async function getCollaboratorCounts(presentationIds, ctx) {
  if (presentationIds.length === 0) return new Map();

  return withDbGuard(new Map(), async (db) => {
    const orgId = getOrgId(ctx);

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
