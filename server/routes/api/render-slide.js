/**
 * Server-side slide rendering for the client, against an explicit theme and
 * language.
 *
 * The browser bundles core's renderers only. A fork's custom type, a fork
 * override of a core name and an organization's published database type are
 * drawn here, and the client swaps the markup into a `slide-loading`
 * placeholder (`client/lib/slide-runtime/slide-render.js`).
 *
 * There is one render path. The two ways in for a signed-in session (B278):
 *
 *   POST /api/render-slide
 *     Body: { slide, mode?, theme: <id>|null, lang: <code>|null }
 *     A surface without a deck — the settings curation, the slide-type picker,
 *     a sample — says which theme and which language it renders against. Both
 *     keys are required: leaving one out is not neutral (see `NO_DECK_LANG`),
 *     so the route refuses a body that is silent about either.
 *
 *   POST /api/presentations/:id/render-slide  (presentations/render-slide.js)
 *     Body: { slide, mode? }
 *     Authorizes against the deck, reads theme and language off it, and calls
 *     {@link serveSlideRender} below — the same function, not a second one.
 *
 * What the two share is everything but where theme and language come from: the
 * body contract for `slide` and `mode`, and the registry scope. The registry is
 * always {@link buildMergedSlideTypes} for the request's own organization, so a
 * deckless render sees exactly the fork types and published database types the
 * editor's `/api/slide-types` lists for that session — no more.
 *
 * Authorization differs only in the theme lookup. The deck route loads the
 * deck's theme unscoped, because the deck it just authorized is what names it.
 * This route has no deck, so a database theme UUID is resolved under the
 * session's organization (`loadThemeAssets` with the storage scope): a UUID of
 * another organization's theme renders with the default theme, never with that
 * theme.
 *
 * The anonymous surfaces come in before the login gate, each through the
 * capability that already hands them the deck (B287, D114):
 *
 *   POST /api/share/:token/render-slide         (share-links/public.js)
 *   POST /api/follow/:id/render-slide           (follow/render-slide.js)
 *   POST /api/live-sessions/:id/render-slide    (live-session-audience.js)
 *     Body: { slideId, mode? } (+ `grant` for a share link, `lang` for follow)
 *
 * They do not take a slide from the body. The capability grants the slides of
 * one deck, not the organization's renderer, so each resolves the slides it
 * would serve and names one by id; {@link serveDeckSlideRender} does the rest.
 */

import { loadThemeAssets } from '../../utils/themes.js';
import { renderSlideHtml } from '../../../shared/slide-types.js';
import { buildMergedSlideTypes } from '../../utils/custom-slide-type-runtime.js';
import {
  badRequest,
  notFound,
  requireJsonBody,
  serveJson,
  withErrorHandler,
} from '../../utils/http.js';
import {
  getLang,
  getOptionalObject,
  getString,
  getTrimmedString,
} from '../../utils/request-validators.js';
import { dispatchRoutes } from '../../utils/router.js';

const RENDER_MODES = ['preview', 'thumb', 'present', 'follow'];

/**
 * Render `body.slide` and serve `{ html }`.
 *
 * The caller has authorized the request and resolved the theme and language it
 * renders against; this owns the rest, for both routes.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @param {object} body - the parsed JSON body
 * @param {object} target
 * @param {object|null} target.theme - the loaded theme
 * @param {string|null} target.lang - canonical deck language, or null
 * @param {string} [target.presentationId] - the deck, when there is one
 * @returns {Promise<true>}
 */
export async function serveSlideRender(
  { storageScope, res },
  body,
  { theme, lang, presentationId },
) {
  const slide = getOptionalObject(body, 'slide');
  if (!slide) {
    return badRequest(res, 'slide object is required');
  }
  if (!getString(slide, 'type')) {
    return badRequest(res, 'slide.type is required');
  }

  const slideTypes = await buildMergedSlideTypes(storageScope);
  const mode = RENDER_MODES.includes(body?.mode) ? body.mode : 'preview';

  const html = renderSlideHtml(slide, {
    mode,
    theme,
    slideTypes,
    presentationId,
    lang,
  });
  serveJson(res, 200, { html });
  return true;
}

/**
 * Render one slide of a deck a capability has already authorized, for a
 * surface without a session.
 *
 * `slides` is what the capability serves (the view-only filter for a share
 * link, the picked language version for follow), so a slide the surface would
 * not be handed cannot be rendered either. The theme is the deck's, loaded
 * unscoped because the authorized deck names it; the registry is the deck's
 * organization's, never the requester's — there is no requester organization.
 *
 * @param {{ repoRoot: string|null, res: import('node:http').ServerResponse }} ctx
 * @param {object} body - the parsed JSON body: `{ slideId, mode? }`
 * @param {object} deck
 * @param {object} deck.pres - the authorized presentation
 * @param {object[]} deck.slides - the slides this capability serves
 * @param {string|null} deck.lang - the language those slides are in
 * @returns {Promise<true>}
 */
export async function serveDeckSlideRender(
  { repoRoot, res },
  body,
  { pres, slides, lang },
) {
  const slideId = getTrimmedString(body, 'slideId');
  if (!slideId) return badRequest(res, 'slideId is required');
  const slide = slides.find((s) => s?.id === slideId);
  if (!slide) return notFound(res);

  return serveSlideRender(
    {
      storageScope: { repoRoot, organizationId: pres.organizationId },
      res,
    },
    { slide, mode: body.mode },
    {
      theme: await loadThemeAssets(repoRoot, pres.theme),
      lang,
      presentationId: pres.id,
    },
  );
}

/**
 * POST /api/render-slide — render a slide without a deck.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 */
async function handleRenderSlideWithoutDeck(ctx) {
  const { repoRoot, storageScope, req, res } = ctx;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const body = jsonResult.body;

  if (!Object.hasOwn(body, 'theme') || !Object.hasOwn(body, 'lang')) {
    return badRequest(
      res,
      'theme and lang are required (null for the default theme / no deck language)',
    );
  }
  const themeId = getTrimmedString(body, 'theme');
  if (body.theme !== null && !themeId) {
    return badRequest(res, 'theme must be a theme id or null');
  }
  const lang = getLang(body);
  if (body.lang !== null && !lang) {
    return badRequest(res, 'lang must be a deck language or null');
  }

  const theme = await loadThemeAssets(repoRoot, themeId, storageScope);
  return serveSlideRender(ctx, body, { theme, lang });
}

/**
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'POST',
    pattern: '/api/render-slide',
    handler: handleRenderSlideWithoutDeck,
  },
];

/**
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleRenderSlide = withErrorHandler('render-slide', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
