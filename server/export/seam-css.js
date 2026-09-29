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
 *
 * Deliberately conservative where CSS is ambiguous: a class inside a
 * functional pseudo-class (`:is()`, `:not()`, `:has()`) is not a requirement,
 * and a selector the scanner cannot read keeps its images inlined.
 */

import { resolveSlideTypeName } from '../../shared/slide-types.js';
import { slideRootClass } from '../../shared/slide-types/validate-definition.js';
import { embedLocalCssUrls } from '../utils/html-utils.js';

/** Group at-rules whose body is itself a list of rules. */
const GROUP_AT_RULE_RE = /^@(media|supports|container|layer|document|scope)\b/i;

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
    if (key) usedRoots.add(slideRootClass(key));
  }
  const unused = (cls) => allRoots.has(cls) && !usedRoots.has(cls);

  const withheld = [];
  collectWithheldBodies(text, 0, text.length, unused, withheld);
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
 * Walk the rules in `css[from, to)` and push the `[start, end)` body range of
 * every style rule that cannot match. Recurses into group at-rules.
 *
 * @param {string} css
 * @param {number} from
 * @param {number} to
 * @param {(cls: string) => boolean} unused
 * @param {Array<[number, number]>} out
 */
function collectWithheldBodies(css, from, to, unused, out) {
  let preludeStart = from;
  let i = from;
  while (i < to) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close < 0 ? to : close + 2;
    } else if (c === '"' || c === "'") {
      i = skipString(css, i, to);
    } else if (c === ';' || c === '}') {
      preludeStart = i + 1;
      i++;
    } else if (c === '{') {
      const end = matchingBrace(css, i, to);
      const prelude = stripComments(css.slice(preludeStart, i)).trim();
      if (GROUP_AT_RULE_RE.test(prelude)) {
        collectWithheldBodies(css, i + 1, end, unused, out);
      } else if (!prelude.startsWith('@') && cannotMatch(prelude, unused)) {
        out.push([i + 1, end]);
      }
      i = end + 1;
      preludeStart = i;
    } else {
      i++;
    }
  }
}

/**
 * True when every selector in the list requires an unused type root class.
 *
 * @param {string} selectorList
 * @param {(cls: string) => boolean} unused
 * @returns {boolean}
 */
function cannotMatch(selectorList, unused) {
  const selectors = splitTopLevelCommas(selectorList);
  return selectors.every((sel) => {
    const required = dropParenthesized(sel).match(/\.[\w-]+/g) || [];
    return required.some((cls) => unused(cls.slice(1)));
  });
}

/** Split a selector list on commas outside parentheses. */
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let buf = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  parts.push(buf);
  return parts;
}

/** A selector without its parenthesized arguments (`:not(.x)` → `:not`). */
function dropParenthesized(s) {
  let depth = 0;
  let out = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return out;
}

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Index just past the string literal opening at `i`. */
function skipString(css, i, to) {
  const quote = css[i];
  let j = i + 1;
  while (j < to && css[j] !== quote) j += css[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** Index of the `}` closing the `{` at `open` (or `to` when unbalanced). */
function matchingBrace(css, open, to) {
  let depth = 0;
  let i = open;
  while (i < to) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close < 0 ? to : close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(css, i, to);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
    i++;
  }
  return to;
}
