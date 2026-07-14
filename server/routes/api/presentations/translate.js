import { getPresentation, updatePresentation } from '../../../storage/presentations.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { createRouteContext } from '../../../utils/context.js';
import { getFeatureFlags } from '../../../config/feature-flags.js';
import { translatePresentationStrings } from '../../../utils/ai.js';
import {
  badRequest,
  json,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../../utils/http.js';
import { canWritePresentation } from '../../../utils/presentation-authz.js';
import { normalizeTranslationLang, normalizeLang } from '../../../storage/presentations/i18n.js';

export async function handlePresentationTranslate(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const flags = getFeatureFlags();
  if (flags.disableAi) return notFound(res);

  const body = await json(req);
  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  const ctx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
  }

  if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) return unauthorized(res);

  pres.i18n = pres.i18n && typeof pres.i18n === 'object' ? pres.i18n : {};
  pres.i18n.versions =
    pres.i18n.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : {};

  // Resolve source language: use body.from if valid, else fall back to pres active/dominant
  const from =
    normalizeTranslationLang(body?.from) ||
    normalizeLang(pres.i18n.active) ||
    normalizeLang(pres.i18n.dominant) ||
    'nl';

  // Resolve target language: use body.to if valid, else default to opposite of source
  const to =
    normalizeTranslationLang(body?.to) ||
    (from === 'nl' ? 'en-GB' : from === 'en-GB' ? 'nl' : 'en-GB');

  // Validate that from and to are different
  if (from === to) {
    return badRequest(res, 'Source and target languages must be different.');
  }

  const overwrite = !!body?.overwrite;
  const fillMissing = body?.fillMissing !== false; // default true

  // Ensure from-version exists (back-compat: store current top-level as the dominant version).
  // dominant/active only support nl/en-GB, so we only set them if 'from' is a legacy language.
  const dominant = normalizeLang(pres.i18n.dominant) || normalizeLang(from) || 'nl';
  pres.i18n.dominant = dominant;
  // Only update active if 'from' is a legacy language (nl/en-GB)
  if (normalizeLang(from)) {
    pres.i18n.active = from;
  }
  if (!pres.i18n.versions[dominant]) {
    pres.i18n.versions[dominant] = { title: pres.title, slides: pres.slides };
  }
  if (!pres.i18n.versions[from]) {
    pres.i18n.versions[from] = { title: pres.title, slides: pres.slides };
  }

  if (pres.i18n.versions[to] && !overwrite && !fillMissing)
    return badRequest(
      res,
      `Target language version already exists (${to}). Pass { overwrite: true } to replace it.`
    );

  const src =
    pres.i18n.versions[from] && typeof pres.i18n.versions[from] === 'object'
      ? pres.i18n.versions[from]
      : { title: pres.title, slides: pres.slides };

  const existingTarget =
    !overwrite && pres.i18n.versions[to] && typeof pres.i18n.versions[to] === 'object'
      ? pres.i18n.versions[to]
      : null;
  const translated = await translatePresentationStrings(
    { title: src.title, slides: src.slides },
    { from, to, existingTarget, fillMissing: !!fillMissing && !overwrite }
  );

  pres.i18n.versions[to] = { title: translated.title, slides: translated.slides };

  // Persist (server-side update will keep top-level aligned to dominant)
  const updated = await updatePresentation(repoRoot, id, pres, {
    actorEmail: authedUser?.email || null,
  });
  serveJson(res, 200, { ok: true, from, to, presentation: updated });
  return true;
}
