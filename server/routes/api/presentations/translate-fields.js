import { getPresentation } from '../../../storage/presentations.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { createRouteContext } from '../../../utils/context.js';
import { getFeatureFlags } from '../../../config/feature-flags.js';
import { translateFieldMap } from '../../../utils/ai.js';
import {
  json,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../../utils/http.js';
import { getOptionalString } from '../../../utils/request-validators.js';
import {
  normalizeLang,
  otherLang,
} from '../../../utils/translation-status.js';
import { canReadPresentation } from '../../../utils/presentation-authz.js';

export async function handlePresentationTranslateFields(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const flags = getFeatureFlags();
  if (flags.disableAi) return notFound(res);

  const body = await json(req);
  const vendor = getOptionalString(body, 'vendor');
  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  const ctx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
  }

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) return unauthorized(res);

  const from =
    normalizeLang(body?.from) ||
    normalizeLang(pres?.i18n?.active) ||
    normalizeLang(pres?.i18n?.dominant) ||
    'nl';
  const to = normalizeLang(body?.to) || otherLang(from);
  const fields = body?.fields && typeof body.fields === 'object' ? body.fields : {};

  const translations = await translateFieldMap(fields, { from, to, vendor });
  serveJson(res, 200, { ok: true, from, to, translations });
  return true;
}
