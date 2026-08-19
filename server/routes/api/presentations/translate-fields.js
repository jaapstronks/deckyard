import { getPresentation } from '../../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { getFeatureFlags } from '../../../config/flags-snapshot.js';
import { translateFieldMap } from '../../../utils/ai.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  requireJsonBody,
} from '../../../utils/http.js';
import {
  getOptionalString,
  getOptionalObject,
} from '../../../utils/request-validators.js';
import { normalizeLang, otherLang } from '../../../utils/translation-status.js';
import { canReadPresentation } from '../../../utils/presentation-authz.js';

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
    return unauthorized(res);

  const from =
    normalizeLang(body?.from) ||
    normalizeLang(pres?.i18n?.active) ||
    normalizeLang(pres?.i18n?.dominant) ||
    'nl';
  const to = normalizeLang(body?.to) || otherLang(from);
  const fields = getOptionalObject(body, 'fields') || {};

  const translations = await translateFieldMap(fields, { from, to, vendor });
  serveJson(res, 200, { ok: true, from, to, translations });
  return true;
}
