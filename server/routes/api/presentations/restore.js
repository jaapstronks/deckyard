import {
  getPresentation,
  updatePresentation,
  createPresentationVersion,
  getPresentationVersion,
} from '../../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  jsonError,
} from '../../../utils/http.js';
import { canWritePresentation } from '../../../utils/presentation-authz/index.js';
import { parseIfMatchRevision } from './helpers.js';

export async function handlePresentationRestoreVersion(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
  versionId,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

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

  if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission }))
    return unauthorized(res);

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

  // Optimistic-lock failures (ConflictError/LockedError from
  // updatePresentation) are AppErrors — the withErrorHandler wrapper on the
  // presentations dispatcher emits them through the canonical envelope.
  const updated = await updatePresentation(storageScope, id, snapPres, {
    expectedRevision,
    actorEmail: authedUser?.email || null,
    restoreFromVersionId: versionId,
    reason: 'restore',
  });
  serveJson(res, 200, { ok: true, presentation: updated });
  return true;
}
