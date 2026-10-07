/**
 * API endpoint for moving a deck between private and the organization.
 *
 * PATCH /api/presentations/:id/visibility
 * Headers: If-Match: <revision>
 * Body: { visibility: "private" | "organization", isViewOnly?: boolean }
 *
 * An adapter: it parses the request and answers. Who may change a deck's
 * visibility, and to what, is decided in `server/services/visibility.js`
 * (B574).
 */

import { changeVisibility } from '../../../services/visibility.js';
import {
  methodNotAllowed,
  serveJson,
  requireJsonBody,
} from '../../../utils/http.js';
import { parseIfMatchRevision } from './helpers.js';

export async function handlePresentationVisibility(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH']);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body || {};

  const updated = await changeVisibility(
    storageScope,
    { actor: authedUser },
    {
      presentationId: id,
      visibility: body.visibility,
      isViewOnly: body.isViewOnly,
      expectedRevision: parseIfMatchRevision(req),
    },
  );
  serveJson(res, 200, updated);
  return true;
}
