/**
 * `DELETE /api/presentations/:id/languages/:lang` — remove a language version
 * (DY-874). The route parses and answers; the removal, its refusals and the
 * version-history backup are `removeLanguageVersion`
 * (`server/services/language-versions.js`).
 */

import { methodNotAllowed, serveJson } from '../../../utils/http.js';
import { removeLanguageVersion } from '../../../services/language-versions.js';

/**
 * A refusal (the source version, a version the deck does not have) is the
 * service's 400 `invalid` naming `lang`; the module-level error handler
 * renders it.
 */
export async function handlePresentationLanguageVersion(
  { storageScope, req, res, authedUser } = {},
  id,
  lang,
) {
  if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE']);
  // A broken percent sequence names no language: it reaches the service as
  // written, which refuses it as unknown.
  let code = lang;
  try {
    code = decodeURIComponent(lang);
  } catch (err) {
    if (!(err instanceof URIError)) throw err;
  }
  const removed = await removeLanguageVersion(
    storageScope,
    { actor: authedUser },
    { presentationId: id, lang: code },
  );
  serveJson(res, 200, { ok: true, ...removed });
  return true;
}
