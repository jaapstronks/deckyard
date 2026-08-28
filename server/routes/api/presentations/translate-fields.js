import { getPresentation } from '../../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { getFeatureFlags } from '../../../config/flags-snapshot.js';
import { translateFieldMap } from '../../../utils/openai/translate.js';
import {
  badRequest,
  methodNotAllowed,
  notFound,
  serveJson,
  requireJsonBody,
  forbidden,
} from '../../../utils/http.js';
import {
  getOptionalString,
  getOptionalObject,
} from '../../../utils/request-validators.js';
import { canReadPresentation } from '../../../utils/presentation-authz/index.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';

export async function handlePresentationTranslateFields(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const flags = getFeatureFlags();
  if (!flags.enableAi) return notFound(res);

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;
  const vendor = getOptionalString(body, 'vendor');
  const pres = await getPresentation(storageScope, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(
      pres.id,
      authedUser.email,
    );
  }

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission }))
    return forbidden(res);

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
