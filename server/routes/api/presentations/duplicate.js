import { duplicatePresentation, getPresentation } from '../../../storage/presentations.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { createRouteContext } from '../../../utils/context.js';
import { json, methodNotAllowed, notFound, serveJson, unauthorized } from '../../../utils/http.js';
import { canReadPresentation } from '../../../utils/presentation-authz.js';

export async function handlePresentationDuplicate(
  { repoRoot, req, res, authedUser } = {},
  id
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

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) return unauthorized(res);

  // For now we only support simple server-side duplication. Keep request body as a
  // forward-compatible hook for future options (e.g. scope override for admins).
  try {
    await json(req);
  } catch {
    // ignore invalid/empty bodies
  }

  const created = await duplicatePresentation(repoRoot, id, {
    actorEmail: authedUser?.email || null,
  });
  if (!created) return notFound(res);
  serveJson(res, 201, created);
  return true;
}
