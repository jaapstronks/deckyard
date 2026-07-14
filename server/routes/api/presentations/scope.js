import { getPresentation, updatePresentation } from '../../../storage/presentations.js';
import {
  badRequest,
  json,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../../utils/http.js';
import { canChangePresentationScope, canManageStarterKit } from '../../../utils/presentation-authz.js';
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

  // Handle isStarterKit flag (only when sharing to workspace)
  let nextIsStarterKit = existing.isStarterKit || false;
  if (typeof body?.isStarterKit === 'boolean') {
    // Only owner/admin can toggle starter kit status
    if (!canManageStarterKit({ user: authedUser, pres: existing })) {
      return unauthorized(res, 'Only the owner can set starter kit status');
    }
    // Starter kits must be in workspace scope
    if (body.isStarterKit && nextScope !== 'workspace') {
      return badRequest(res, 'Starter kits must be shared with the workspace');
    }
    nextIsStarterKit = body.isStarterKit;
  }

  // Handle isViewOnly flag (only when sharing to workspace)
  let nextIsViewOnly = existing.isViewOnly || false;
  if (typeof body?.isViewOnly === 'boolean') {
    // Only owner/admin can toggle view-only status
    if (!canManageStarterKit({ user: authedUser, pres: existing })) {
      return unauthorized(res, 'Only the owner can set view-only status');
    }
    // View-only must be in workspace scope
    if (body.isViewOnly && nextScope !== 'workspace') {
      return badRequest(res, 'View-only presentations must be shared with the workspace');
    }
    nextIsViewOnly = body.isViewOnly;
  }

  // If moving to private, automatically remove starter kit and view-only status
  if (nextScope === 'private') {
    nextIsStarterKit = false;
    nextIsViewOnly = false;
  }

  // Starter kit and view-only are mutually exclusive - starter kit takes precedence
  if (nextIsStarterKit) {
    nextIsViewOnly = false;
  }

  const expectedRevision = authedUser?.isAdmin ? null : parseIfMatchRevision(req);
  if (!authedUser?.isAdmin && expectedRevision == null)
    return serveJson(res, 428, { error: 'Missing If-Match revision' });

  const nextPres = { ...existing, scope: nextScope, isStarterKit: nextIsStarterKit, isViewOnly: nextIsViewOnly };
  try {
    const updated = await updatePresentation(repoRoot, id, nextPres, {
      expectedRevision,
      actorEmail: authedUser?.email || null,
      allowScopeChange: true,
      allowStarterKitChange: true,
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
          isStarterKit: updated.isStarterKit,
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
