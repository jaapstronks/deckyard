import {
  deletePresentation,
  getPresentation,
  updatePresentation,
  claimPresentationOwnership,
} from '../../../storage/presentations.js';
import { getTagsForPresentation } from '../../../storage/tags.js';
import {
  json,
  methodNotAllowed,
  notFound,
  serveJson,
} from '../../../utils/http.js';
import { canClaimOwnership, getEffectivePermission } from '../../../utils/presentation-authz.js';
import {
  withPresentationAuth,
  canEditCustomHtml,
  customHtmlEditViolation,
} from '../../../utils/route-middleware.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { parseIfMatchRevision } from './helpers.js';
import {
  recordPresentationUpdated,
  recordPresentationDeleted,
  recordPresentationMovedToWorkspace,
} from '../../../services/activity-events.js';
import { createRouteContext } from '../../../utils/context.js';
import { filterForViewOnly } from '../../../utils/public-output.js';
import { broadcastToPresentation, PresentationEventTypes } from '../../../services/comment-events.js';

export async function handlePresentationItem(
  { repoRoot, req, res, url, authedUser } = {},
  id
) {
  if (req.method === 'GET') {
    const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
    if (!pres) return true;

    // Determine user's effective permission for the client UI
    let collaboratorPermission = null;
    if (authedUser?.email) {
      collaboratorPermission = await getCollaboratorPermission(id, authedUser.email, {});
    }
    const userPermission = getEffectivePermission({
      user: authedUser,
      pres,
      collaboratorPermission,
    });

    // Fetch tags for the presentation
    const tags = await getTagsForPresentation(id);

    const lang = url.searchParams.get('lang');
    if (
      (lang === 'nl' || lang === 'en-GB') &&
      pres?.i18n?.versions &&
      typeof pres.i18n.versions === 'object' &&
      pres.i18n.versions?.[lang]
    ) {
      const v = pres.i18n.versions[lang];
      let projected = {
        ...pres,
        title: typeof v?.title === 'string' ? v.title : pres.title,
        slides: Array.isArray(v?.slides) ? v.slides : pres.slides,
        i18n: {
          ...(pres.i18n && typeof pres.i18n === 'object' ? pres.i18n : {}),
          active: lang,
        },
        tags,
        _userPermission: userPermission,
      };
      // Filter slides for non-editing users (hide hidden slides, mark drafts)
      if (userPermission === 'view' || userPermission === 'comment') {
        projected = filterForViewOnly(projected, { markDrafts: true });
        projected._userPermission = userPermission;
        projected.tags = tags;
      }
      serveJson(res, 200, projected);
      return true;
    }
    // Filter slides for non-editing users (hide hidden slides, mark drafts)
    let responseData = { ...pres, tags, _userPermission: userPermission };
    if (userPermission === 'view' || userPermission === 'comment') {
      responseData = filterForViewOnly(responseData, { markDrafts: true });
      responseData._userPermission = userPermission;
      responseData.tags = tags;
    }
    serveJson(res, 200, responseData);
    return true;
  }

  if (req.method === 'PUT') {
    const body = await json(req);
    const existing = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'write' });
    if (!existing) return true;

    const expectedRevision = authedUser?.isAdmin ? null : parseIfMatchRevision(req);
    if (!authedUser?.isAdmin && expectedRevision == null)
      return serveJson(res, 428, { error: 'Missing If-Match revision' });

    // Gate: only capability-holders may create or change raw HTML/CSS on a
    // custom-html-slide. Non-capable users may still keep/reorder such slides.
    if (Array.isArray(body?.slides)) {
      const violation = customHtmlEditViolation(
        existing.slides,
        body.slides,
        canEditCustomHtml(authedUser)
      );
      if (violation) return serveJson(res, 403, { error: violation });
    }

    // Extract modified slide IDs for slide-level merge (concurrent editing)
    let modifiedSlideIds = null;
    const modifiedSlidesHeader = req.headers['x-modified-slides'];
    if (modifiedSlidesHeader) {
      try {
        modifiedSlideIds = JSON.parse(modifiedSlidesHeader);
        if (!Array.isArray(modifiedSlideIds)) modifiedSlideIds = null;
      } catch {
        modifiedSlideIds = null;
      }
    }

    let updated = null;
    try {
      updated = await updatePresentation(repoRoot, id, body, {
        expectedRevision,
        actorEmail: authedUser?.email || null,
        user: authedUser || null,
        modifiedSlideIds,
      });
    } catch (e) {
      if (e?.statusCode)
        return serveJson(res, e.statusCode, {
          error: e.message,
          details: e.details || null,
        });
      throw e;
    }
    if (!updated) return notFound(res);

    // Record activity event (non-blocking)
    if (authedUser?.email) {
      const ctx = createRouteContext(authedUser);
      // Check if scope changed to workspace
      if (existing.scope !== updated.scope && updated.scope === 'workspace') {
        void recordPresentationMovedToWorkspace({
          presentation: updated,
          actor: authedUser,
          previousScope: existing.scope,
          ctx,
        });
      } else {
        // Record general update (only for workspace presentations to reduce noise)
        if (updated.scope === 'workspace') {
          void recordPresentationUpdated({
            presentation: updated,
            actor: authedUser,
            changes: {
              titleChanged: existing.title !== updated.title,
            },
            ctx,
          });
        }
      }
    }

    // Broadcast to other connected editors (non-blocking, synchronous)
    try {
      broadcastToPresentation(id, PresentationEventTypes.UPDATED, {
        revision: updated.revision,
        modifiedSlideIds: modifiedSlideIds || [],
        actorEmail: authedUser?.email || null,
      });
    } catch {
      // Ignore broadcast failures — SSE is best-effort
    }

    serveJson(res, 200, updated);
    return true;
  }

  if (req.method === 'DELETE') {
    const existing = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'delete' });
    if (!existing) return true;

    // Parse optional message from request body
    let message = null;
    try {
      const body = await json(req);
      message = body?.message || null;
    } catch {
      // No body or invalid JSON is fine
    }

    const deleted = await deletePresentation(repoRoot, id, {
      actorEmail: authedUser?.email,
      message,
    });
    if (!deleted) return notFound(res);

    // Record activity event (non-blocking, only for workspace presentations)
    if (authedUser?.email && existing.scope === 'workspace') {
      void recordPresentationDeleted({
        presentation: existing,
        actor: authedUser,
        ctx: createRouteContext(authedUser),
      });
    }

    serveJson(res, 200, { ok: true });
    return true;
  }

  // PATCH - Claim ownership of a legacy presentation
  if (req.method === 'PATCH') {
    const body = await json(req);
    const existing = await getPresentation(repoRoot, id);
    if (!existing) return notFound(res);

    // Only allow claiming ownership action
    if (body?.action !== 'claim') {
      return serveJson(res, 400, { error: 'Invalid action. Use { "action": "claim" }' });
    }

    if (!canClaimOwnership({ user: authedUser, pres: existing })) {
      return serveJson(res, 403, {
        error: 'Cannot claim ownership. Presentation already has an owner.',
      });
    }

    const claimed = await claimPresentationOwnership(repoRoot, id, {
      ownerEmail: authedUser?.email,
      scope: body?.scope || 'private', // Default to private when claiming
    });

    if (!claimed) return notFound(res);

    serveJson(res, 200, claimed);
    return true;
  }

  return methodNotAllowed(res, ['GET', 'PUT', 'PATCH', 'DELETE']);
}
