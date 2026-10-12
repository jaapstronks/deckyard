import { listPresentationsForActor } from '../../../services/presentations.js';
import { getTagsForPresentations } from '../../../storage/tags.js';
import { serveJson } from '../../../utils/http.js';
import { withDeckCardFields } from '../../../utils/deck-card-fields.js';
import {
  getPublishedPresentationIds,
  getCollaboratorCounts,
} from '../../../storage/presentations/index.js';

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
  const publishedSet = await getPublishedPresentationIds(
    storageScope,
    presentationIds,
  );
  const collaboratorCounts = await getCollaboratorCounts(
    storageScope,
    presentationIds,
  );

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
