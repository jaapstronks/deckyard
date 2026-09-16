import {
  methodNotAllowed,
  notFound,
  requireJsonBody,
} from '../../../utils/http.js';
import { getFollowStateForPresentation } from '../../../storage/live-sessions/index.js';
import { getPresentation } from '../../../storage/presentations/index.js';
import {
  normalizeLang,
  resolveDeckLang,
} from '../../../../shared/i18n-utils.js';
import { serveDeckSlideRender } from '../render-slide.js';
import { followAudienceScope, pickPresentationForLang } from './helpers.js';

/**
 * POST /api/follow/:presentationId/render-slide — render one slide the
 * audience is shown, server-side (B287).
 * Body: `{ slideId, lang, mode? }`.
 *
 * The same authorization as `GET …/presentation`: the deck is only served
 * while its follow state is live. `lang` is the version the audience asked
 * that route for (null for the deck's own slides); a version the deck does not
 * carry is not a slide the audience was shown, so it is `not_found` rather than
 * the base slides under a foreign language.
 */
export async function handleFollowRenderSlide(
  { repoRoot, req, res },
  presentationId,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const state = await getFollowStateForPresentation(
    followAudienceScope(repoRoot),
    presentationId,
  );
  if (state.status !== 'live') return notFound(res);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const pres = await getPresentation(
    followAudienceScope(repoRoot),
    presentationId,
  );
  if (!pres) return notFound(res);

  const deckLang = resolveDeckLang(pres);
  const lang = normalizeLang(body?.lang);
  if (lang && lang !== deckLang && !pres.i18n?.versions?.[lang]) {
    return notFound(res);
  }
  const picked = pickPresentationForLang(pres, lang);
  return serveDeckSlideRender({ repoRoot, res }, body, {
    pres,
    slides: Array.isArray(picked.slides) ? picked.slides : [],
    lang: lang || deckLang,
  });
}
