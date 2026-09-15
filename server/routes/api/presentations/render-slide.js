/**
 * API endpoint for server-side slide rendering against a deck.
 *
 * POST /api/presentations/:id/render-slide
 * Body: { slide: { id, type, content, notes }, mode?: 'preview' | 'thumb' }
 *
 * The deck is the authorization and the source of the theme and language; the
 * render itself is `serveSlideRender` in `../render-slide.js`, which the
 * deckless `POST /api/render-slide` calls too (B278).
 */

import { getPresentation } from '../../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { loadThemeAssets } from '../../../utils/themes.js';
import { canReadPresentation } from '../../../utils/presentation-authz/index.js';
import { resolveDeckLang } from '../../../../shared/i18n-utils.js';
import {
  methodNotAllowed,
  notFound,
  requireJsonBody,
  forbidden,
} from '../../../utils/http.js';
import { serveSlideRender } from '../render-slide.js';

export async function handleRenderSlide(
  { repoRoot, storageScope, req, res, authedUser } = {},
  presentationId,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);

  // Authorization check
  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    authedUser?.email,
  );
  if (
    !canReadPresentation({ user: authedUser, pres, collaboratorPermission })
  ) {
    return forbidden(res);
  }

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;

  return serveSlideRender({ storageScope, res }, jsonResult.body, {
    theme: await loadThemeAssets(repoRoot, pres?.theme),
    // Custom types render here, so they get the same deck language the
    // bundled ones get on the client canvas.
    lang: resolveDeckLang(pres),
    presentationId,
  });
}
