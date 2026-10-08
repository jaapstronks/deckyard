/**
 * `POST /api/presentations/:id/translate` — translate a deck into another
 * language. The route parses and answers; the translation is
 * `translatePresentation` (`server/services/translate.js`, B610).
 */

import {
  methodNotAllowed,
  serveJson,
  requireJsonBody,
} from '../../../utils/http.js';
import { getOptionalString } from '../../../utils/request-validators.js';
import { translatePresentation } from '../../../services/translate.js';

/**
 * Body: `to` (required), `from` (defaults to the version on screen, else the
 * source version), `overwrite`, `fillMissing`, `vendor`. A refusal is the
 * service's 400 `invalid` naming the field; the module-level error handler
 * renders it.
 */
export async function handlePresentationTranslate(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body || {};

  const { from, to, presentation } = await translatePresentation(
    storageScope,
    { actor: authedUser },
    {
      presentationId: id,
      from: body.from,
      to: body.to,
      overwrite: body.overwrite,
      fillMissing: body.fillMissing,
      vendor: getOptionalString(body, 'vendor'),
    },
  );
  serveJson(res, 200, { ok: true, from, to, presentation });
  return true;
}
