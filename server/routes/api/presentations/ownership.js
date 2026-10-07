/**
 * API endpoint for transferring presentation ownership.
 *
 * POST /api/presentations/:id/transfer-ownership
 * Body: { newOwnerEmail: "user@example.com", keepAsCollaborator?: boolean }
 *
 * An adapter: it parses the body and answers. Who may hand a deck over, and
 * to whom, is decided in `server/services/ownership.js` (B573).
 */

import { transferOwnership } from '../../../services/ownership.js';
import {
  methodNotAllowed,
  serveJson,
  requireJsonBody,
} from '../../../utils/http.js';

export async function handleOwnershipTransfer(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body || {};

  const result = await transferOwnership(
    storageScope,
    { actor: authedUser },
    {
      presentationId: id,
      newOwnerEmail: body.newOwnerEmail,
      keepAsCollaborator: body.keepAsCollaborator,
    },
  );
  serveJson(res, 200, { ok: true, ...result });
  return true;
}
