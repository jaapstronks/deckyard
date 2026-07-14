/**
 * Isomorphic HTML Sanitization Module
 *
 * Provides defense-in-depth HTML sanitization using DOMPurify.
 * Works in both browser and Node.js environments.
 *
 * Usage:
 * - sanitizeHtml(html, config): Full HTML sanitization with allowed tags
 * - sanitizeInline(html): Inline-only (strong, em, a, span)
 * - stripHtml(html): Remove all HTML, return plain text
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
    if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
      const DOMPurify = globalThis.DOMPurify || window.DOMPurify;
      if (DOMPurify) {
        purify = DOMPurify;
        return purify;
      }
      throw new Error('DOMPurify not available in browser. Ensure it is loaded.');
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
 * Default allowed tags for full HTML sanitization
 */
const DEFAULT_ALLOWED_TAGS = [
  // Block elements
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'hr', 'br',
  // Inline elements
  'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'a', 'span', 'sub', 'sup', 'mark',
  // Media (sanitized attributes)
  'img',
];

/**
 * Default allowed attributes
 */
const DEFAULT_ALLOWED_ATTR = [
  'href', 'target', 'rel', 'title', 'alt', 'src',
  'class', 'id', 'style',
  'colspan', 'rowspan', 'scope',
  'data-lang', 'data-math', // Code highlighting and math rendering
];

/**
 * Inline-only allowed tags (for sanitizeInline)
 */
const INLINE_ALLOWED_TAGS = ['strong', 'b', 'em', 'i', 'a', 'span', 'br', 'code'];

/**
 * Inline-only allowed attributes
 */
const INLINE_ALLOWED_ATTR = ['href', 'target', 'rel', 'class', 'data-math'];

/**
 * Sanitize HTML with full tag support
 *
 * @param {string} html - Raw HTML to sanitize
 * @param {Object} config - Optional DOMPurify config overrides
 * @returns {Promise<string>} Sanitized HTML
 */
export async function sanitizeHtml(html, config = {}) {
  if (!html || typeof html !== 'string') return '';

  const DOMPurify = await initPurify();

  const mergedConfig = {
    ALLOWED_TAGS: config.ALLOWED_TAGS || DEFAULT_ALLOWED_TAGS,
    ALLOWED_ATTR: config.ALLOWED_ATTR || DEFAULT_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    // Force safe link targets
    ADD_ATTR: ['target'],
    ...config,
  };

  let result = DOMPurify.sanitize(html, mergedConfig);

  // Ensure external links have proper security attributes
  result = result.replace(
    /<a\s+([^>]*href=["'][^"']*["'][^>]*)>/gi,
    (match, attrs) => {
      if (!attrs.includes('target=')) {
        attrs += ' target="_blank"';
      }
      if (!attrs.includes('rel=')) {
        attrs += ' rel="noopener noreferrer"';
      }
      return `<a ${attrs}>`;
    }
  );

  return result;
}

/**
 * Sanitize HTML allowing only inline elements
 * Use for text that should not contain block elements
 *
 * @param {string} html - Raw HTML to sanitize
 * @returns {Promise<string>} Sanitized inline HTML
 */
export async function sanitizeInline(html) {
  if (!html || typeof html !== 'string') return '';

  const DOMPurify = await initPurify();

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: INLINE_ALLOWED_TAGS,
    ALLOWED_ATTR: INLINE_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Strip all HTML tags and return plain text
 *
 * @param {string} html - Raw HTML to strip
 * @returns {Promise<string>} Plain text
 */
export async function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';

  const DOMPurify = await initPurify();

  // Use DOMPurify with no allowed tags to strip all HTML
  const text = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });

  // Decode common HTML entities
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Synchronous sanitization
 * Uses pre-initialized purify instance (server or browser)
 * Falls back to escaping if DOMPurify not available
 */
export function sanitizeHtmlSync(html, config = {}) {
  if (!html || typeof html !== 'string') return '';

  // Use pre-initialized purify instance (works for both server and browser)
  if (purify) {
    return purify.sanitize(html, {
      ALLOWED_TAGS: config.ALLOWED_TAGS || DEFAULT_ALLOWED_TAGS,
      ALLOWED_ATTR: config.ALLOWED_ATTR || DEFAULT_ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ...config,
    });
  }

  // Browser environment with DOMPurify available
  if (typeof window !== 'undefined' && (globalThis.DOMPurify || window.DOMPurify)) {
    const DOMPurify = globalThis.DOMPurify || window.DOMPurify;
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: config.ALLOWED_TAGS || DEFAULT_ALLOWED_TAGS,
      ALLOWED_ATTR: config.ALLOWED_ATTR || DEFAULT_ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ...config,
    });
  }

  // Fallback: escape HTML (not ideal but safe)
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
  'script', 'noscript', 'style', 'iframe', 'object', 'embed',
  'form', 'input', 'button', 'textarea', 'select', 'option',
  'link', 'meta', 'base', 'title',
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
 * @param {string} html - Raw author HTML
 * @returns {string} Sanitized HTML safe to inject via innerHTML
 */
export function sanitizeSlideHtmlSync(html) {
  if (!html || typeof html !== 'string') return '';

  const config = {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_ATTR: ['target'],
    FORBID_TAGS: SLIDE_FORBID_TAGS,
    FORBID_ATTR: SLIDE_FORBID_ATTR,
    ALLOW_DATA_ATTR: true,
  };

  const dp =
    purify ||
    (typeof window !== 'undefined'
      ? globalThis.DOMPurify || window.DOMPurify
      : null);

  if (dp) return dp.sanitize(html, config);

  // Fallback: escape so the source shows as text instead of injecting unsafe HTML.
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Synchronous inline sanitization
 * Uses pre-initialized purify instance (server or browser)
 */
export function sanitizeInlineSync(html) {
  if (!html || typeof html !== 'string') return '';

  // Use pre-initialized purify instance (works for both server and browser)
  if (purify) {
    return purify.sanitize(html, {
      ALLOWED_TAGS: INLINE_ALLOWED_TAGS,
      ALLOWED_ATTR: INLINE_ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
    });
  }

  if (typeof window !== 'undefined' && (globalThis.DOMPurify || window.DOMPurify)) {
    const DOMPurify = globalThis.DOMPurify || window.DOMPurify;
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: INLINE_ALLOWED_TAGS,
      ALLOWED_ATTR: INLINE_ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
    });
  }

  // Fallback: escape HTML
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
