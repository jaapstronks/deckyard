import { createPresentation } from '../../../services/presentations.js';
import { serveJson, requireJsonBody } from '../../../utils/http.js';

/**
 * POST /api/presentations — create a deck for the session user. The handling
 * (refused fields, ownership, activity, slide-library usage) is the service's
 * (B521); this route parses and answers.
 */
export async function handlePresentationsCreate({
  storageScope,
  req,
  res,
  authedUser,
} = {}) {
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const created = await createPresentation(
    storageScope,
    { actor: authedUser },
    parsed.body,
  );
  serveJson(res, 201, created);
  return true;
}
