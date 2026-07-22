import { getPresentation, updatePresentation } from '../../../storage/presentations.js';
import {
  badRequest,
  json,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../../utils/http.js';
import { canChangePresentationScope, isPresentationAuthor } from '../../../utils/presentation-authz.js';
import { maybeFireWebhook } from '../../../utils/webhooks.js';
import { parseIfMatchRevision } from './helpers.js';

export async function handlePresentationScope(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH']);
  const existing = await getPresentation(repoRoot, id);
  if (!existing) return notFound(res);
  if (!authedUser) return unauthorized(res);

  const body = await json(req);
  const nextScope =
    body?.scope === 'workspace'
      ? 'workspace'
      : body?.scope === 'private'
      ? 'private'
      : null;
  if (!nextScope) return badRequest(res, 'Invalid scope');
  if (!canChangePresentationScope({ user: authedUser, pres: existing, nextScope }))
    return unauthorized(res);

  // Handle isViewOnly flag (only when sharing to workspace)
  let nextIsViewOnly = existing.isViewOnly || false;
  if (typeof body?.isViewOnly === 'boolean') {
    // Only owner/creator can toggle view-only status
    if (!isPresentationAuthor({ user: authedUser, pres: existing })) {
      return unauthorized(res, 'Only the owner can set view-only status');
    }
    // View-only must be in workspace scope
    if (body.isViewOnly && nextScope !== 'workspace') {
      return badRequest(res, 'View-only presentations must be shared with the workspace');
    }
    nextIsViewOnly = body.isViewOnly;
  }

  // If moving to private, automatically remove view-only status
  if (nextScope === 'private') {
    nextIsViewOnly = false;
  }

  // If-Match required for everyone, admins included (escape hatch removed).
  const expectedRevision = parseIfMatchRevision(req);
  if (expectedRevision == null)
    return serveJson(res, 428, { error: 'Missing If-Match revision' });

  const nextPres = { ...existing, scope: nextScope, isViewOnly: nextIsViewOnly };
  try {
    const updated = await updatePresentation(repoRoot, id, nextPres, {
      expectedRevision,
      actorEmail: authedUser?.email || null,
      allowScopeChange: true,
      allowViewOnlyChange: true,
    });

    if (existing?.scope !== 'workspace' && updated?.scope === 'workspace') {
      await maybeFireWebhook(repoRoot, req, {
        event: 'presentation.moved_to_workspace',
        pres: updated,
        authedUser,
        extra: {
          fromScope: existing?.scope || 'private',
          toScope: 'workspace',
        },
      });
    }
    serveJson(res, 200, updated);
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
