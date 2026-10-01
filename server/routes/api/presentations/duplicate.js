import { duplicatePresentation } from '../../../services/presentations.js';
import { methodNotAllowed, serveJson } from '../../../utils/http.js';
import { withDeckCardFields } from '../../../utils/deck-card-fields.js';

/**
 * POST /api/presentations/:id/duplicate — copy a deck for the session user.
 * The handling (who may copy, whose the copy is, the activity row) is the
 * service's (B570); this route answers. A refusal is thrown and the API error
 * handler renders it.
 */
export async function handlePresentationDuplicate(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const created = await duplicatePresentation(
    storageScope,
    { actor: authedUser },
    id,
  );
  // The client turns this straight into a card (toListItem), so it needs the
  // same deck-card fields a list row carries — otherwise the freshly duplicated
  // deck is the one card in the grid with a colorless placeholder.
  const [item] = await withDeckCardFields(repoRoot, [created], storageScope);
  serveJson(res, 201, item);
  return true;
}
