/**
 * The fork seam's local `url()`s, inlined for an export only where they can
 * be drawn.
 *
 * An export document is self-contained (Puppeteer `setContent`, or a
 * downloaded .html), so every local `url()` the seam references has to become
 * a data URL or it silently resolves to nothing (B554). Doing that for the
 * whole seam, used or not, put every image any fork type references into every
 * export: ~835 KB of fork artwork in a deck that never shows it, and per page
 * on the PNG path (B557).
 *
 * The line is drawn on the one thing a seam rule is declared against: a slide
 * type's root class. `slideRootClass()` is the single derivation of it, and it
 * is what a fork's `custom/styles/*.css` nests under (see
 * docs/reference/fork-setup.md). A rule whose every selector requires the root
 * class of a registered type that this export does not render cannot match
 * anything in it, so its `url()`s stay as written; everything else is inlined
 * as before. That includes `@font-face` sources, and any rule not scoped to a
 * type root: the pass only ever withholds what provably cannot be drawn.
 * "Renders" is read from each slide's markup, not only from its type: a type
 * may carry another type's root next to its own (DY-852).
 *
 * The rule scanner and its conservative reading of selectors live in
 * `server/utils/css-type-scope.js`, which the MCP preview shares.
 */

import {
  renderSlideHtml,
  resolveSlideTypeName,
} from '../../shared/slide-types.js';
import { slideRootClass } from '../../shared/slide-types/validate-definition.js';
import { embedLocalCssUrls } from '../utils/html-utils.js';
import {
  rootClassesInMarkup,
  unmatchableRuleRanges,
} from '../utils/css-type-scope.js';

/**
 * Inline the seam's local `url()`s, except inside rules that can only match a
 * slide type this export does not render.
 *
 * @param {string} repoRoot
 * @param {string} css - the seam text (`readCustomStylesCss`).
 * @param {Object} opts
 * @param {Array<Object>} opts.slides - the slides the export renders.
 * @param {Record<string, object>} opts.slideTypes - the registry to resolve
 *   their types against.
 * @param {Function} [opts.transform] - Image-bytes transform.
 * @param {Map<string, Promise<string>>} [opts.cache] - Shared per-run embed cache.
 * @returns {Promise<string>}
 */
export async function embedSeamCssUrls(
  repoRoot,
  css,
  { slides, slideTypes, transform = null, cache = null },
) {
  const text = String(css || '');
  const allRoots = new Set(Object.keys(slideTypes).map(slideRootClass));
  const usedRoots = new Set();
  for (const slide of slides) {
    const key = resolveSlideTypeName(slide?.type, slideTypes);
    if (!key) continue;
    usedRoots.add(slideRootClass(key));
    for (const cls of rootsInRender(
      { ...slide, type: key },
      slideTypes,
      allRoots,
    ))
      usedRoots.add(cls);
  }
  const unused = (cls) => allRoots.has(cls) && !usedRoots.has(cls);

  const withheld = unmatchableRuleRanges(text, unused, { part: 'body' });
  if (!withheld.length) {
    return embedLocalCssUrls(repoRoot, text, { transform, cache });
  }

  // Inline the stretches between withheld bodies; the bodies stay verbatim.
  const parts = [];
  let at = 0;
  for (const [start, end] of withheld) {
    parts.push(
      embedLocalCssUrls(repoRoot, text.slice(at, start), { transform, cache }),
    );
    parts.push(text.slice(start, end));
    at = end;
  }
  parts.push(embedLocalCssUrls(repoRoot, text.slice(at), { transform, cache }));
  return (await Promise.all(parts)).join('');
}

/**
 * The type roots a slide's markup carries besides its own: a likert slider is
 * also `.slide-likert`, a feedback slide also `.slide-follow-invite`. Read
 * from a render rather than declared per type, the same way the MCP preview
 * reads them (`rootClassesInMarkup`), so a fork rule under a shared root
 * keeps its image (DY-852). A render that throws adds nothing; the slide's
 * own root is already counted.
 *
 * @param {Object} slide - with `type` resolved to a registry key
 * @param {Record<string, object>} slideTypes
 * @param {Set<string>} allRoots
 * @returns {Set<string>}
 */
function rootsInRender(slide, slideTypes, allRoots) {
  try {
    return rootClassesInMarkup(
      // No deck language: which root classes a slide carries does not
      // depend on the copy it renders, only on its type and content.
      renderSlideHtml(slide, {
        slideTypes,
        stripEditorAttrs: true,
        lang: null,
      }),
      allRoots,
    );
  } catch {
    return new Set();
  }
}
