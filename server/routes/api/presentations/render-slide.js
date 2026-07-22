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

import { getPresentation } from '../../../storage/presentations.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { createRouteContext } from '../../../utils/context.js';
import { loadTheme } from '../../../utils/themes.js';
import { canReadPresentation } from '../../../utils/presentation-authz.js';
import { renderSlideHtml } from '../../../../shared/slide-types.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('render-slide');
import {
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  badRequest,
  requireJsonBody,
} from '../../../utils/http.js';

export async function handleRenderSlide(
  { repoRoot, req, res, authedUser } = {},
  presentationId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const ctx = createRouteContext(authedUser);
  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) return notFound(res);

  // Authorization check
  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email,
    ctx
  );
  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res);
  }

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  const slide = body?.slide;
  if (!slide || typeof slide !== 'object') {
    return badRequest(res, 'slide object is required');
  }
  if (!slide.type || typeof slide.type !== 'string') {
    return badRequest(res, 'slide.type is required');
  }

  // Load theme and merged slide types for rendering context
  const theme = await loadTheme(repoRoot, pres?.theme);
  const slideTypes = await buildMergedSlideTypes(ctx);

  const mode = ['preview', 'thumb', 'present', 'follow'].includes(body?.mode)
    ? body.mode
    : 'preview';

  try {
    const html = renderSlideHtml(slide, {
      mode,
      theme,
      slideTypes,
      presentationId,
    });
    serveJson(res, 200, { html });
  } catch (err) {
    log.error('[render-slide] Error rendering slide:', err);
    serveJson(res, 500, { error: 'Failed to render slide' });
  }

  return true;
}