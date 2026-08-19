import { createPresentation } from '../../../storage/presentations/index.js';
import { serveJson, requireJsonBody } from '../../../utils/http.js';
import { getTrimmedString } from '../../../utils/request-validators.js';
import { recordPresentationCreated } from '../../../services/activity-events.js';
import { recordSlideLibraryUsage } from '../../../storage/slide-library-usage/index.js';

/**
 * Build the usage refs for a compose-from-library create: each source slide id
 * plus (when the deck started from a saved collection) the collection id. Both
 * become "used by you", clearing the Home shelf's "new to you" badge.
 * @param {object} body - the POST /api/presentations body
 * @returns {Array<{ type: 'slide'|'collection', id: string }>}
 */
function usageRefsFromBody(body) {
  const refs = [];
  const ids = Array.isArray(body?.sourceLibraryItemIds)
    ? body.sourceLibraryItemIds
    : [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (id) refs.push({ type: 'slide', id });
  }
  const collectionId = getTrimmedString(body, 'sourceCollectionId') || '';
  if (collectionId) refs.push({ type: 'collection', id: collectionId });
  return refs;
}

export async function handlePresentationsCreate({
  storageScope,
  req,
  res,
  authedUser,
} = {}) {
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const created = await createPresentation(storageScope, {
    ...body,
    ownerEmail: authedUser?.email || null,
  });

  // Record activity event (non-blocking)
  if (authedUser?.email) {
    void recordPresentationCreated({
      presentation: created,
      actor: authedUser,
      scope: storageScope,
    });

    // Record library-usage server-side so it also covers MCP/agent composes
    // (non-blocking; badge tracking must never fail a create).
    const usageRefs = usageRefsFromBody(body);
    if (usageRefs.length) {
      void recordSlideLibraryUsage(
        storageScope,
        authedUser.email,
        usageRefs,
      ).catch(() => {});
    }
  }

  serveJson(res, 201, created);
  return true;
}
