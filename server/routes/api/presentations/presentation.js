import {
  deletePresentation,
  updatePresentation,
} from '../../../storage/presentations.js';
import { getTagsForPresentation } from '../../../storage/tags.js';
import {
  json,
  methodNotAllowed,
  notFound,
  serveJson,
} from '../../../utils/http.js';
import { getEffectivePermission } from '../../../utils/presentation-authz.js';
import {
  withPresentationAuth,
  canEditCustomHtml,
  customHtmlEditViolation,
} from '../../../utils/route-middleware.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { parseIfMatchRevision, diffAddedSlideIds } from './helpers.js';
import {
  recordPresentationUpdated,
  recordPresentationDeleted,
  recordPresentationMovedToWorkspace,
  recordSlidesAdded,
} from '../../../services/activity-events.js';
import { notifyDeckActivity } from '../../../services/deck-activity-notifications.js';
import { createRouteContext } from '../../../utils/context.js';
import { filterForViewOnly } from '../../../utils/public-output.js';
import { broadcastToPresentation, PresentationEventTypes } from '../../../services/comment-events.js';

/**
 * GET /api/presentations/:id/revision — lightweight revision probe.
 * Lets a waking editor tab check whether the server has moved on without
 * downloading the whole deck (see client/views/editor/remote-refresh.js).
 */
export async function handlePresentationRevision(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({ repoRoot, id, authedUser, res, permission: 'read' });
  if (!pres) return true;
  serveJson(res, 200, {
    id: pres.id,
    revision: pres.revision,
    modified: pres.modified,
    updatedBy: pres.updatedBy || null,
  });
  return true;
}

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

    // If-Match is required for everyone, admins included. Admins used to bypass
    // the check (expectedRevision=null → blind overwrite with no merge, wiping
    // even slides they never loaded); that escape hatch was removed so every
    // writer goes through the same optimistic-lock + slide-level merge path.
    const expectedRevision = parseIfMatchRevision(req);
    if (expectedRevision == null)
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

    // Base fingerprints of the modified slides (id → hash) let the merge
    // detect slides that were also changed server-side since the client's
    // base, instead of last-writer-wins (see shared/slide-fingerprint.js).
    let slideBaseFingerprints = null;
    const baseFingerprintsHeader = req.headers['x-slide-base-fingerprints'];
    if (baseFingerprintsHeader) {
      try {
        const parsed = JSON.parse(baseFingerprintsHeader);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          slideBaseFingerprints = parsed;
        }
      } catch {
        slideBaseFingerprints = null;
      }
    }

    // Did the client actually reorder slides since its base? '0' keeps the
    // server's slide order authoritative in a merge (a stale tab must not
    // reshuffle the deck); absent header = legacy client → old behaviour.
    let clientReordered = null;
    const orderChangedHeader = req.headers['x-slides-order-changed'];
    if (orderChangedHeader === '1' || orderChangedHeader === 'true') {
      clientReordered = true;
    } else if (orderChangedHeader === '0' || orderChangedHeader === 'false') {
      clientReordered = false;
    }

    let updated = null;
    try {
      updated = await updatePresentation(repoRoot, id, body, {
        expectedRevision,
        actorEmail: authedUser?.email || null,
        user: authedUser || null,
        modifiedSlideIds,
        slideBaseFingerprints,
        clientReordered,
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

      // Slides this actor added, for the slide.added feed event.
      const submittedSlides = Array.isArray(body?.slides) ? body.slides : updated.slides;
      const addedSlideIds = diffAddedSlideIds(existing.slides, submittedSlides, updated.slides);

      // Check if scope changed to workspace
      if (existing.scope !== updated.scope && updated.scope === 'workspace') {
        void recordPresentationMovedToWorkspace({
          presentation: updated,
          actor: authedUser,
          previousScope: existing.scope,
          ctx,
        });
      } else if (addedSlideIds.length > 0) {
        // A slide-add is more specific than a generic update, so emit it
        // instead of `presentation.updated` — and for decks of any scope, since
        // this is the collaborator-awareness signal. The feed enrichment
        // filters by read access, so it never leaks to non-readers.
        void recordSlidesAdded({
          presentation: updated,
          actor: authedUser,
          slideIds: addedSlideIds,
          ctx,
        });
        // Bundled "someone worked on your deck" bell notification for the
        // owner/collaborators (coalesced per actor within the debounce window;
        // the actor never notifies themselves). Fire-and-forget.
        void notifyDeckActivity({
          presentation: updated,
          actor: authedUser,
          slideCount: addedSlideIds.length,
          ctx,
        });
      } else if (updated.scope === 'workspace') {
        // Record general update (only for workspace presentations to reduce noise)
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

  return methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
}
