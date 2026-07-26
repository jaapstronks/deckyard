import {
  getPresentation,
  updatePresentation,
  createPresentationVersion,
  getPresentationVersion,
} from '../../../storage/presentations.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { createRouteContext } from '../../../utils/context.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  jsonError,
} from '../../../utils/http.js';
import { errorToResponse } from '../../../utils/errors.js';
import { canWritePresentation } from '../../../utils/presentation-authz.js';
import { parseIfMatchRevision } from './helpers.js';

export async function handlePresentationRestoreVersion(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
  versionId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(storageScope, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  const ctx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
  }

  if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) return unauthorized(res);

  // If-Match required for everyone, admins included (escape hatch removed).
  const expectedRevision = parseIfMatchRevision(req);
  if (expectedRevision == null)
    return jsonError(res, 428, 'missing_if_match', 'Missing If-Match revision');

  const v = await getPresentationVersion(storageScope, id, versionId);
  const snapPres = v?.presentation;
  if (!v || !snapPres) return notFound(res);

  // Safety net: snapshot current state before restoring.
  try {
    await createPresentationVersion(storageScope, id, pres, {
      actorEmail: authedUser?.email || null,
      reason: 'pre_restore',
      label: `before restore ${versionId}`,
    });
  } catch {
    // best-effort
  }

  try {
    const updated = await updatePresentation(storageScope, id, snapPres, {
      expectedRevision,
      actorEmail: authedUser?.email || null,
      restoreFromVersionId: versionId,
      reason: 'restore',
    });
    serveJson(res, 200, { ok: true, presentation: updated });
  } catch (e) {
    // Optimistic-lock failures (ConflictError/LockedError from
    // updatePresentation) carry a statusCode; emit them through the canonical
    // error envelope ({ ok:false, error:'<code>', message, details }) instead of
    // a hand-rolled body. Unexpected errors propagate to the top-level handler.
    if (e?.statusCode)
      return serveJson(res, e.statusCode, errorToResponse(e));
    throw e;
  }
  return true;
}
