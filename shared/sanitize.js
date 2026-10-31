/**
 * Isomorphic HTML Sanitization Module
 *
 * Provides defense-in-depth HTML sanitization using DOMPurify.
 * Works in both browser and Node.js environments.
 *
 * One job: author HTML of a custom-HTML slide (`sanitizeSlideHtmlSync()` and
 * the two readers of its tree). Markdown does not come here; it is safe by
 * construction in `shared/markdown.js`.
 */

let purify = null;
let initPromise = null;

/**
 * Initialize DOMPurify for synchronous use.
 * Call this at server startup before using sync sanitization functions.
 * Returns the DOMPurify instance.
 */
export async function initSanitizer() {
  return initPurify();
}

async function initPurify() {
  if (purify) return purify;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Browser environment
    if (
      typeof window !== 'undefined' &&
      typeof window.document !== 'undefined'
    ) {
      const DOMPurify = globalThis.DOMPurify || window.DOMPurify;
      if (DOMPurify) {
        purify = DOMPurify;
        return purify;
      }
      throw new Error(
        'DOMPurify not available in browser. Ensure it is loaded.',
      );
    }

    // Node.js environment
    const { JSDOM } = await import('jsdom');
    const createDOMPurify = (await import('dompurify')).default;
    const { window: jsdomWindow } = new JSDOM('');
    purify = createDOMPurify(jsdomWindow);
    return purify;
  })();

  return initPromise;
}

/**
 * The escape fallback of the slide sanitizer.
 *
 * Escaping is the safe degradation — nothing unsafe is injected — but it makes
 * authored markup render as visible text, which is the "raw HTML in the slide"
 * symptom. The cause is always the same: no DOMPurify instance. In the browser
 * that means the vendored bundle failed to load; in Node it means the process
 * never called initSanitizer(). Warn once per process so the next occurrence is
 * diagnosable from a log instead of only from a screenshot.
 *
 * @param {string} html - Raw HTML to escape
 * @returns {string} Escaped, inert HTML
 */
let fallbackWarned = false;
function escapeFallback(html) {
  if (!fallbackWarned) {
    fallbackWarned = true;
    const cause =
      typeof window === 'undefined'
        ? 'this Node process never called initSanitizer() (see server/server.js and server/mcp/index.js)'
        : 'DOMPurify did not load in this page';
    console.warn(
      `[sanitize] No DOMPurify available: ${cause}. Markup is escaped, so authored HTML appears as visible text.`,
    );
  }
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Tags that must never survive in a custom-HTML slide, regardless of the
 * permissive structural/SVG profile below. Blocks script execution, external
 * loads, and form submission while still allowing rich layout markup.
 */
const SLIDE_FORBID_TAGS = [
  'script',
  'noscript',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'link',
  'meta',
  'base',
  'title',
];

/**
 * Attributes that could trigger navigation/submission side effects. DOMPurify
 * already strips on* event handlers and neutralizes javascript: URLs; these are
 * belt-and-braces. xlink:href is intentionally NOT forbidden so SVG <use>
 * symbols keep working (DOMPurify sanitizes its URL value).
 */
const SLIDE_FORBID_ATTR = ['srcdoc', 'ping', 'formaction', 'action'];

/**
 * Sanitize raw author HTML for a custom-HTML slide.
 *
 * Permissive by design (full HTML + SVG + MathML structural markup, class/id/
 * style attributes) so authors can build bespoke layouts and diagrams, but
 * hard-strips anything that executes JS, loads external resources, or submits
 * forms. The output reaches present mode, follow-along and public /p/ share
 * links, so this runs on every viewer-facing render path (it lives inside the
 * slide type's renderHtml, which is isomorphic).
 *
 * Requires DOMPurify to be available: the server pre-initializes it via
 * initSanitizer() at startup, and the browser loads it globally (client/app.js).
 * If neither is present it falls back to escaping the markup, which renders the
 * source as visible text rather than silently injecting unsafe HTML.
 *
 * What is safe is one answer, given here once. What a caller does with the
 * author's presentation is a second question: the canvas keeps it, the
 * reflowable projection has no use for author CSS, whether it sits in the
 * slide's `css` field or in a `style` attribute, and passes
 * `presentation: false` to drop the attribute. Same tree, same safety.
 *
 * @param {string} html - Raw author HTML
 * @param {{ presentation?: boolean }} [opts]
 * @param {boolean} [opts.presentation=true] - `false` also drops `style`
 *   attributes (author CSS is presentation)
 * @returns {string} Sanitized HTML safe to inject via innerHTML
 */
export function sanitizeSlideHtmlSync(html, { presentation = true } = {}) {
  if (!html || typeof html !== 'string') return '';

  const dp = slidePurify();
  if (dp)
    return dp.sanitize(
      html,
      presentation ? SLIDE_HTML_CONFIG : SLIDE_HTML_CONFIG_NO_PRESENTATION,
    );

  // Fallback: escape so the source shows as text instead of injecting unsafe HTML.
  return escapeFallback(html);
}

/**
 * The text of the first `h1`, `h2` or `h3` in author HTML, as
 * {@link sanitizeSlideHtmlSync} keeps it: whitespace collapsed, `''` when
 * there is none. It reads the sanitized tree, never the raw string, so a
 * heading the sanitizer strips (inside a `<template>`, say) names nothing.
 *
 * Without DOMPurify there is no tree to read and the answer is `''`: the
 * markup itself then renders escaped, and escaped source has no headings.
 *
 * @param {string} html - Raw author HTML
 * @returns {string}
 */
export function slideHtmlHeadingTextSync(html) {
  const heading = slideHtmlFragment(html)?.querySelector('h1, h2, h3');
  return heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '';
}

/**
 * How many `<img>` elements in author HTML, as {@link sanitizeSlideHtmlSync}
 * keeps it, carry no `alt` attribute: the pictures the markup leaves unnamed
 * (D137, B318). `alt=""` is HTML's own declaration of a decorative picture
 * and does not count. Like the heading, it reads the sanitized tree, so an
 * `<img>` the sanitizer strips is not there to name.
 *
 * Without DOMPurify the answer is `0`: the markup then renders escaped, and
 * escaped source shows no pictures.
 *
 * @param {string} html - Raw author HTML
 * @returns {number}
 */
export function slideHtmlImagesWithoutAltSync(html) {
  const fragment = slideHtmlFragment(html);
  return fragment ? fragment.querySelectorAll('img:not([alt])').length : 0;
}

/**
 * Author HTML as the slide sanitizer's tree, for the helpers that read it
 * rather than inject it; `null` when there is nothing to read or no DOMPurify.
 */
function slideHtmlFragment(html) {
  if (!html || typeof html !== 'string') return null;
  const dp = slidePurify();
  if (!dp) return null;
  return dp.sanitize(html, { ...SLIDE_HTML_CONFIG, RETURN_DOM_FRAGMENT: true });
}

/** The slide sanitizer's DOMPurify configuration, shared by both readers of it. */
const SLIDE_HTML_CONFIG = Object.freeze({
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_ATTR: ['target'],
  FORBID_TAGS: SLIDE_FORBID_TAGS,
  FORBID_ATTR: SLIDE_FORBID_ATTR,
  ALLOW_DATA_ATTR: true,
});

/**
 * The same safety, minus the author's presentation: `style` is author CSS,
 * and a reflowable document reads without it (D151). Derived, not a second
 * answer to what is safe.
 */
const SLIDE_HTML_CONFIG_NO_PRESENTATION = Object.freeze({
  ...SLIDE_HTML_CONFIG,
  FORBID_ATTR: [...SLIDE_FORBID_ATTR, 'style'],
});

/** The pre-initialized DOMPurify (server) or the global one (browser), if any. */
function slidePurify() {
  return (
    purify ||
    (typeof window !== 'undefined'
      ? globalThis.DOMPurify || window.DOMPurify
      : null)
  );
}
