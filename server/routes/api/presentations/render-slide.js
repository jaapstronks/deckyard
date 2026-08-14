/**
 * API endpoint for server-side slide rendering.
 *
 * This endpoint is used by the client to render custom slide types
 * that aren't bundled in the browser build. Custom slide types have
 * their renderHtml functions loaded only on the server.
 *
 * POST /api/presentations/:id/render-slide
 * Body: { slide: { id, type, content, notes }, mode?: 'preview' | 'thumb' }
 */

import { getPresentation } from '../../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { loadThemeAssets } from '../../../utils/themes.js';
import { canReadPresentation } from '../../../utils/presentation-authz.js';
import { renderSlideHtml } from '../../../../shared/slide-types.js';
import { resolveDeckLang } from '../../../../shared/i18n-utils.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import {
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  badRequest,
  requireJsonBody,
} from '../../../utils/http.js';
import { getOptionalObject, getString } from '../../../utils/request-validators.js';

export async function handleRenderSlide(
  { repoRoot, storageScope, req, res, authedUser } = {},
  presentationId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);

  // Authorization check
  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email
  );
  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res);
  }

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  const slide = getOptionalObject(body, 'slide');
  if (!slide) {
    return badRequest(res, 'slide object is required');
  }
  if (!getString(slide, 'type')) {
    return badRequest(res, 'slide.type is required');
  }

  // Load theme and merged slide types for rendering context
  const theme = await loadThemeAssets(repoRoot, pres?.theme);
  const slideTypes = await buildMergedSlideTypes(storageScope);

  const mode = ['preview', 'thumb', 'present', 'follow'].includes(body?.mode)
    ? body.mode
    : 'preview';

  const html = renderSlideHtml(slide, {
    mode,
    theme,
    slideTypes,
    presentationId,
    // Custom types render here, so they get the same deck language the
    // bundled ones get on the client canvas.
    lang: resolveDeckLang(pres),
  });
  serveJson(res, 200, { html });

  return true;
}
