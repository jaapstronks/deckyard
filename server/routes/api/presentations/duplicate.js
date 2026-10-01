import { duplicatePresentation } from '../../../storage/presentations/index.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  requireJsonBody,
} from '../../../utils/http.js';
import { withDeckCardFields } from '../../../utils/deck-card-fields.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';

export async function handlePresentationDuplicate(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({
    storageScope,
    id,
    authedUser,
    res,
  });
  if (!pres) return true;

  // For now we only support simple server-side duplication. Keep request body as a
  // forward-compatible hook for future options (e.g. scope override for admins).
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;

  const created = await duplicatePresentation(storageScope, id, {
    actorEmail: authedUser?.email || null,
  });
  if (!created.ok) return notFound(res);
  // The client turns this straight into a card (toListItem), so it needs the
  // same deck-card fields a list row carries — otherwise the freshly duplicated
  // deck is the one card in the grid with a colorless placeholder.
  const [item] = await withDeckCardFields(
    repoRoot,
    [created.presentation],
    storageScope,
  );
  serveJson(res, 201, item);
  return true;
}
