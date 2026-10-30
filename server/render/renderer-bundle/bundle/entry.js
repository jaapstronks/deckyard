/**
 * The render entry: one function that turns a frozen edition input into both
 * public views of it.
 *
 * This is the single entry the brief asks for ("één gedeelde canvas/reader-
 * entry"): canvas and reader are derived from the same input by the same
 * bundle, so they cannot drift apart over the life of a published edition. It
 * calls the two document assemblers the live export paths call -
 * `server/export/canvas-document.js` and `server/export/reader-document.js` -
 * so there is no second renderer to keep in step.
 *
 * **What it may not do.** Nothing here reads a current value. No database, no
 * HTTP, no feature-flag snapshot, no live theme or slide-type registry, no
 * clock, no process environment. Everything that varies per installation is
 * either in the input (content, effective theme, slide-type snapshot, font CSS,
 * asset bytes) or in the bundle (renderer code, core CSS, the fork seam). The
 * closure scan in `scripts/build-renderer-bundle.js` is what holds this to more
 * than a promise.
 *
 * **What it refuses.** An input of an unknown schema, and an input carrying a
 * dependency the bundle cannot close - today that is author markup in a
 * `markup: true` field, which the live canvas runs through the HTML sanitizer,
 * whose `jsdom`/`dompurify` sit outside the bundle. Rendering it anyway would
 * escape the markup instead of sanitising it: the same deck, quietly different.
 * The refusal is the documented answer for an unsealable dependency
 * (`docs/plans/briefs/publication-records.md` § Bevroren rendercontract).
 */

import path from 'node:path';

import { readCssWithImports } from '../../../utils/read-css-with-imports.js';
import { themeVarsCssText } from '../../../utils/theme-vars-css.js';
import { resolveDocLangFromPresentation } from '../../../utils/doc-lang.js';
import { resolveDeckLang } from '../../../../shared/i18n-utils.js';
import { SLIDE_TYPES } from '../../../../shared/slide-types/registry.js';
import { renderCanvasDocument } from '../../../export/canvas-document.js';
import { renderReaderDocument } from '../../../export/reader-document.js';
import { RENDERER_BUNDLE_ERRORS, RendererBundleError } from '../errors.js';
import { EDITION_INPUT_SCHEMA } from '../edition-input.js';
import { findUnsealableSlides } from '../sealable.js';

/**
 * Refuse an input whose render would need something the bundle does not carry.
 *
 * The rule itself is `../sealable.js`, shared with the edition-input builder;
 * here the first unsealable slide is a refusal.
 *
 * Exported so the two refusals can be read against a registry of their own:
 * the fork-type half is unreachable in a checkout without `custom/slide-types/`,
 * and a guard nobody can see refuse is a guard nobody has tested.
 *
 * @param {object} presentation
 * @param {Record<string, object>} [registry] - Defaults to the bundle's own
 */
export function assertSealableEdition(presentation, registry = SLIDE_TYPES) {
  const [first] = findUnsealableSlides(presentation?.slides, registry);
  if (!first) return;
  throw new RendererBundleError(
    RENDERER_BUNDLE_ERRORS.UNSEALABLE_INPUT,
    first.message,
    first.field
      ? { index: first.index, type: first.type, field: first.field }
      : { index: first.index, type: first.type },
  );
}

/**
 * Render both public views of one edition.
 *
 * @param {string} bundleRoot - Root of the unpacked renderer tree. Core CSS,
 *   the fork seam and the vendored Prism/KaTeX bytes are read from under it.
 * @param {object} input - The frozen edition input
 * @param {string} input.schema - Must be {@link EDITION_INPUT_SCHEMA}
 * @param {object} input.presentation - Public projection of the deck, with
 *   every asset reference already an inline data URL
 * @param {object|null} [input.theme] - Effective theme record
 * @param {object} [input.css] - Frozen CSS layers the bundle cannot derive:
 *   `{ fontCss, wmCss, wmHtml }`
 * @param {string} [input.metaDescription] - `<meta name="description">`
 * @param {string} [input.canonicalUrl] - The canvas address, for the reader's
 *   "view the slides" link
 * @returns {Promise<{canvas: string, reader: string}>}
 */
export async function renderEdition(bundleRoot, input) {
  if (input?.schema !== EDITION_INPUT_SCHEMA) {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.INPUT_INVALID,
      `edition input declares schema ${JSON.stringify(input?.schema)}, expected ${EDITION_INPUT_SCHEMA}`,
    );
  }
  const pres = input.presentation;
  if (!pres || typeof pres !== 'object' || !Array.isArray(pres.slides)) {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.INPUT_INVALID,
      'edition input has no presentation with a slides array',
    );
  }

  assertSealableEdition(pres);

  const theme = input.theme || null;
  const frozenCss = input.css || {};
  const [chromeCss, slidesCss] = await Promise.all([
    readCssWithImports(
      bundleRoot,
      path.join(bundleRoot, 'client', 'styles', 'export.css'),
    ),
    readCssWithImports(
      bundleRoot,
      path.join(bundleRoot, 'client', 'styles', 'slides.css'),
    ),
  ]);

  const css = {
    // Font faces are bytes, so they are frozen in the edition input rather than
    // derived here: which font files a theme resolves to is an installation
    // question, and the edition answered it on its publication day.
    fontCss: typeof frozenCss.fontCss === 'string' ? frozenCss.fontCss : '',
    chromeCss,
    slidesCss,
    themeVarsCss: themeVarsCssText(theme),
    wmCss: typeof frozenCss.wmCss === 'string' ? frozenCss.wmCss : '',
    wmHtml: typeof frozenCss.wmHtml === 'string' ? frozenCss.wmHtml : '',
    // `null` hands the fork seam back to the CSS chain, which reads
    // `custom/styles/` under the bundle root: the fork's own stylesheet, frozen
    // with the renderer it was written against.
    customCss: null,
  };

  const docLang = resolveDocLangFromPresentation(pres);
  const deckLang = resolveDeckLang(pres);

  const canvas = await renderCanvasDocument(bundleRoot, pres, {
    slides: pres.slides,
    css,
    theme,
    // No registry from the input: the bundle's own frozen `SLIDE_TYPES` is the
    // registry, which is what keeps a published edition out of reach of a core
    // slide type's later render changes.
    slideTypes: null,
    docLang,
    deckLang,
    metaDescription:
      typeof input.metaDescription === 'string' ? input.metaDescription : '',
    // A published edition links the Prism/KaTeX bytes this installation serves
    // rather than inlining them, the same way the live `/p/` page does.
    context: 'published',
  });

  const reader = renderReaderDocument(bundleRoot, pres, {
    slideTypes: null,
    canonicalUrl:
      typeof input.canonicalUrl === 'string' ? input.canonicalUrl : '',
  });

  return { canvas, reader };
}
