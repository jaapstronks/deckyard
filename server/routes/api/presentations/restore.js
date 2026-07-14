import { getPresentation, updatePresentation } from '../../../storage/presentations.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { createRouteContext } from '../../../utils/context.js';
import {
  createPresentationVersion,
  getPresentationVersion,
} from '../../../storage/presentations/versions.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../../utils/http.js';
import { canWritePresentation } from '../../../utils/presentation-authz.js';
import { parseIfMatchRevision } from './helpers.js';

export async function handlePresentationRestoreVersion(
  { repoRoot, req, res, authedUser } = {},
  id,
  versionId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  const ctx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
  }

  if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) return unauthorized(res);

  const expectedRevision = authedUser?.isAdmin ? null : parseIfMatchRevision(req);
  if (!authedUser?.isAdmin && expectedRevision == null)
    return serveJson(res, 428, { error: 'Missing If-Match revision' });

  const v = await getPresentationVersion(repoRoot, id, versionId);
  const snapPres = v?.presentation;
  if (!v || !snapPres) return notFound(res);

  // Safety net: snapshot current state before restoring.
  try {
    await createPresentationVersion(repoRoot, id, pres, {
      actorEmail: authedUser?.email || null,
      reason: 'pre_restore',
      label: `before restore ${versionId}`,
    });
  } catch {
    // best-effort
  }

  try {
    const updated = await updatePresentation(repoRoot, id, snapPres, {
      expectedRevision,
      actorEmail: authedUser?.email || null,
      restoreFromVersionId: versionId,
      reason: 'restore',
    });
    serveJson(res, 200, { ok: true, presentation: updated });
  } catch (e) {
    if (e?.statusCode)
      return serveJson(res, e.statusCode, {
        error: e.message,
        details: e.details || null,
      });
    throw e;
  }
  return true;
}
