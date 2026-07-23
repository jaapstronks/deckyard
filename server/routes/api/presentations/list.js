import { listPresentations } from '../../../storage/presentations.js';
import { getTagsForPresentations } from '../../../storage/tags.js';
import { serveJson } from '../../../utils/http.js';
import { normalizePresentationScope, isUnrestricted } from '../../../utils/presentation-authz.js';
import { normalizeEmail } from '../../../utils/normalize.js';
import { withDbGuard } from '../../../storage/utils/db-guard.js';
import { getOrgId } from '../../../utils/context.js';

// Filter for what appears in a user's collection (not authorization).
// Invariant: a deck card is only shown when canReadPresentation would also
// let the user open it — so no ownerless-legacy exception here (the view
// route would refuse those anyway, leaving a dead card).
export function belongsInCollection({ user, pres } = {}) {
  if (!pres || typeof pres !== 'object') return false;
  // Auth-off single operator sees every deck (matches canReadPresentation).
  if (isUnrestricted(user)) return true;
  const scope = normalizePresentationScope(pres?.scope);
  if (scope === 'workspace') return true;

  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;

  const owner = normalizeEmail(pres?.ownerEmail);
  const createdBy = normalizeEmail(pres?.createdBy);

  // User owns or created the presentation
  if (owner && owner === userEmail) return true;
  if (createdBy && createdBy === userEmail) return true;

  return false;
}

export async function handlePresentationsList({ repoRoot, res, authedUser } = {}) {
  const list = await listPresentations(repoRoot);
  // Filter to show only the user's own presentations + workspace presentations.
  // Admin status doesn't change what appears in their collection.
  const filtered = authedUser
    ? list.filter((p) => belongsInCollection({ user: authedUser, pres: p }))
    : list;

  // Fetch tags for all presentations in the list
  const presentationIds = filtered.map((p) => p.id);
  const tagsMap = await getTagsForPresentations(presentationIds);

  // Fetch published status and collaborator counts
  const ctx = { user: authedUser };
  const publishedSet = await getPublishedPresentationIds(presentationIds, ctx);
  const collaboratorCounts = await getCollaboratorCounts(presentationIds, ctx);

  // Attach tags, isPublished, and collaboratorCount to each presentation
  const withMetadata = filtered.map((p) => ({
    ...p,
    tags: tagsMap.get(p.id) || [],
    isPublished: publishedSet.has(p.id),
    collaboratorCount: collaboratorCounts.get(p.id) || 0,
  }));

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
