import { deletePresentation } from '../../../services/presentations.js';
import { getTagsForPresentation } from '../../../storage/tags.js';
import {
  methodNotAllowed,
  serveJson,
  jsonError,
  requireJsonBody,
} from '../../../utils/http.js';
import { getEffectivePermission } from '../../../utils/presentation-authz/index.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { parseIfMatchRevision, parseSlideMergeHeaders } from './helpers.js';
import { savePresentation } from '../../../services/save-presentation.js';
import { filterForViewOnly } from '../../../utils/public-output.js';
import { normalizeLang } from '../../../../shared/i18n-utils.js';

/**
 * GET /api/presentations/:id/revision — lightweight revision probe.
 * Lets a waking editor tab check whether the server has moved on without
 * downloading the whole deck (see client/views/editor/remote-refresh.js).
 */
export async function handlePresentationRevision(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const pres = await withPresentationAuth({
    storageScope,
    id,
    authedUser,
    res,
    permission: 'read',
  });
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
  { storageScope, req, res, url, authedUser } = {},
  id,
) {
  if (req.method === 'GET') {
    const pres = await withPresentationAuth({
      storageScope,
      id,
      authedUser,
      res,
      permission: 'read',
    });
    if (!pres) return true;

    // Determine user's effective permission for the client UI
    let collaboratorPermission = null;
    if (authedUser?.email) {
      collaboratorPermission = await getCollaboratorPermission(
        id,
        authedUser.email,
      );
    }
    const userPermission = getEffectivePermission({
      user: authedUser,
      pres,
      collaboratorPermission,
    });

    // Fetch tags for the presentation
    const tags = await getTagsForPresentation(storageScope, id);

    const lang = normalizeLang(url.searchParams.get('lang'));
    if (
      lang &&
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
    const jsonResult = await requireJsonBody(req, res);
    if (!jsonResult.ok) return true;

    // If-Match is required for everyone, admins included. Admins used to bypass
    // the check (expectedRevision=null → blind overwrite with no merge, wiping
    // even slides they never loaded); that escape hatch was removed so every
    // writer goes through the same optimistic-lock + slide-level merge path.
    const expectedRevision = parseIfMatchRevision(req);
    if (expectedRevision == null)
      return jsonError(
        res,
        428,
        'missing_if_match',
        'Missing If-Match revision',
      );

    // The editor sends back the whole deck it holds. Its owner and theme
    // move through their own handlings (a transfer, /change-theme), possibly
    // in another tab, so the copy here can be stale on them; a save never
    // moved either, and they are not part of what the editor asks to change.
    const { ownerEmail: _owner, theme: _theme, ...changes } = jsonResult.body;

    // Loading, the refusals, the merge and the trail (activity rows, the
    // broadcast to other editors, the thumbnail warm) are the save service's
    // (B608); a refusal (409 conflict, 423 lock, 400 invalid) is thrown and
    // the presentations router's withErrorHandler renders it.
    const updated = await savePresentation(
      storageScope,
      { actor: authedUser },
      {
        presentationId: id,
        changes,
        expectedRevision,
        ...parseSlideMergeHeaders(req),
      },
    );
    serveJson(res, 200, updated);
    return true;
  }

  if (req.method === 'DELETE') {
    // Who may trash the deck and the activity row are the service's (B571);
    // a refusal is thrown and the presentations router renders it.
    await deletePresentation(storageScope, { actor: authedUser }, id);
    serveJson(res, 200, { ok: true });
    return true;
  }

  return methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
}
