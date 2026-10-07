import { importJsonDeck } from '../../../services/import-json.js';
import { badRequest, serveJson, requireJsonBody } from '../../../utils/http.js';

// Error handling lives in the `withErrorHandler` wrapper on the presentations
// dispatcher: typed AppErrors (sandbox quota, validation) surface their own
// status + safe message, anything else is a generic 500 — err.message/stack
// never reach the client (public in sandbox/demo mode, security-audit H7).
export async function handlePresentationsImportJson({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
} = {}) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const result = await importJsonDeck({
    repoRoot,
    storageScope,
    actor: authedUser,
    deck: body?.deck || body,
    lang: body?.lang,
  });
  if (!result.ok) {
    badRequest(res, result.message);
    return true;
  }

  serveJson(res, 201, result.presentation);
  return true;
}
