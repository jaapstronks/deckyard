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

import { loadThemeAssets } from '../../../utils/themes.js';
import { resolveDeckLang } from '../../../../shared/i18n-utils.js';
import { methodNotAllowed, requireJsonBody } from '../../../utils/http.js';
import { serveSlideRender } from '../render-slide.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';

export async function handleRenderSlide(
  { repoRoot, storageScope, req, res, authedUser } = {},
  presentationId,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
  });
  if (!pres) return true;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;

  return serveSlideRender({ storageScope, res }, jsonResult.body, {
    theme: await loadThemeAssets(repoRoot, pres?.theme, storageScope),
    // Custom types render here, so they get the same deck language the
    // bundled ones get on the client canvas.
    lang: resolveDeckLang(pres),
    presentationId,
  });
}
