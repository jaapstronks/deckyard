import { translateFieldMap } from '../../../utils/openai/translate.js';
import {
  badRequest,
  methodNotAllowed,
  serveJson,
  requireJsonBody,
} from '../../../utils/http.js';
import {
  getOptionalString,
  getOptionalObject,
} from '../../../utils/request-validators.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';

export async function handlePresentationTranslateFields(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const vendor = getOptionalString(body, 'vendor');
  const pres = await withPresentationAuth({
    storageScope,
    id,
    authedUser,
    res,
  });
  if (!pres) return true;

  const from =
    normalizeLang(body?.from) ||
    normalizeLang(pres?.i18n?.active) ||
    normalizeLang(pres?.i18n?.dominant) ||
    DEFAULT_DECK_LANG;
  // `to` is required. It used to fall back to `otherLang(from)`, which is null
  // off the NL/EN pair — the request then reached the translator with no target
  // language at all instead of being refused here (D72).
  const to = normalizeLang(body?.to);
  if (!to) return badRequest(res, 'A target language ("to") is required.');
  const fields = getOptionalObject(body, 'fields') || {};

  const translations = await translateFieldMap(fields, { from, to, vendor });
  serveJson(res, 200, { ok: true, from, to, translations });
  return true;
}
