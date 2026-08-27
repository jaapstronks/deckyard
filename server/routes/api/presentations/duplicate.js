import {
  duplicatePresentation,
  getPresentation,
} from '../../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  requireJsonBody,
  forbidden,
} from '../../../utils/http.js';
import { canReadPresentation } from '../../../utils/presentation-authz/index.js';

export async function handlePresentationDuplicate(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
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

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission }))
    return forbidden(res);

  // For now we only support simple server-side duplication. Keep request body as a
  // forward-compatible hook for future options (e.g. scope override for admins).
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;

  const created = await duplicatePresentation(storageScope, id, {
    actorEmail: authedUser?.email || null,
  });
  if (!created.ok) return notFound(res);
  serveJson(res, 201, created.presentation);
  return true;
}
