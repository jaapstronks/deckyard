// Shared helpers used by slide type registry + renderers.

import { SLIDE_BG_ID_RE } from '../theme-slide-backgrounds.js';

export function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Alias for escapeHtml - use this when "escapeHtml" reads more clearly in context
export { esc as escapeHtml };

/**
 * Normalize a string value: trim whitespace and return empty string if falsy.
 * Use this for content fields that may be empty or contain only whitespace.
 */
export function nonEmpty(s) {
  const t = String(s || '').trim();
  return t || '';
}

/**
 * Standard background field definition for slide types.
 * Use this constant instead of duplicating the field definition.
 */
export const BACKGROUND_FIELD = {
  key: 'background',
  label: 'Background',
  type: 'enum',
  required: false,
  options: ['lime', 'mist'],
};

/**
 * Named table style variants for the structured Table slide type.
 * Each variant maps to a `md-table--<value>` class whose colours resolve from
 * the theme palette by default (see `client/styles/slides/.../35-table-slide.css`),
 * so a table looks designed on any theme with zero per-theme work. A theme may
 * remap a variant's colours via `--t-table-<variant>-*` tokens.
 *  - `plain`: transparent surface, gridlines only (the historical look).
 *  - `panel`: filled panel with an emphasized header row + first (label) column.
 *  - `soft` : near-white panel with a coloured header and a faint label column.
 */
export const TABLE_STYLE_FIELD = {
  key: 'tableStyle',
  label: 'Table style',
  type: 'enum',
  required: false,
  options: [
    { value: 'plain', label: 'Plain' },
    { value: 'panel', label: 'Panel' },
    { value: 'soft', label: 'Soft' },
  ],
};

/**
 * Map a table style value to its CSS class. Unknown/empty values fall back to
 * `plain` (the transparent historical look), so old decks render unchanged.
 * @param {string} style - Table style value (plain, panel, soft)
 * @returns {string} CSS class name (e.g. 'md-table--panel')
 */
export function tableStyleClass(style) {
  const v = String(style || 'plain');
  if (v === 'panel') return 'md-table--panel';
  if (v === 'soft') return 'md-table--soft';
  return 'md-table--plain';
}

/**
 * Extended background field with additional theme colors.
 * Use for slide types that support more background options.
 */
export const BACKGROUND_FIELD_EXTENDED = {
  key: 'background',
  label: 'Background',
  type: 'enum',
  required: false,
  options: [
    { value: 'lime', label: 'Lime' },
    { value: 'mist', label: 'Mist' },
    { value: 'dark', label: 'Dark' },
    { value: 'accent', label: 'Accent' },
    { value: 'brand-1', label: 'Brand 1' },
    { value: 'brand-2', label: 'Brand 2' },
    { value: 'custom', label: 'Custom color' },
  ],
};

function inferAltFromUrl(urlOrPath) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const base = decodeURIComponent(u.pathname.split('/').pop() || '');
    return humanizeFilename(base);
  } catch {
    const base = raw.split('?')[0].split('#')[0].split('/').pop() || '';
    return humanizeFilename(base);
  }
}

function humanizeFilename(filename) {
  const f = String(filename || '').trim();
  if (!f) return '';
  const noExt = f.replace(/\.[a-z0-9]{2,5}$/i, '');
  const cleaned = noExt
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  // Capitalize first letter, keep the rest as-is.
  return cleaned[0].toUpperCase() + cleaned.slice(1);
}

export function pickAltText({
  explicit,
  src,
  fallbacks = [],
  hardFallback = '',
} = {}) {
  const e = String(explicit || '').trim();
  if (e) return e;
  for (const f of fallbacks) {
    const t = String(f || '').trim();
    if (t) return t;
  }
  const inferred = inferAltFromUrl(src);
  if (inferred) return inferred;
  return String(hardFallback || '').trim();
}

export function normalizeUrl(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  // Allow protocol-relative URLs too (//...)
  if (/^https?:\/\//i.test(t) || t.startsWith('//')) return t;
  return t;
}

function looksLikeUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || '').trim()
  );
}

export function youtubeEmbedUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').trim();
      if (!id) return '';
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
        id
      )}?rel=0&modestbranding=1`;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) {
        return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
          v
        )}?rel=0&modestbranding=1`;
      }
      const m = u.pathname.match(/\/embed\/([^/]+)/);
      if (m?.[1]) {
        return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
          m[1]
        )}?rel=0&modestbranding=1`;
      }
      const s = u.pathname.match(/\/shorts\/([^/]+)/);
      if (s?.[1]) {
        return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
          s[1]
        )}?rel=0&modestbranding=1`;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

export function vimeoEmbedUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const host = u.hostname.toLowerCase();
    if (host.endsWith('vimeo.com')) {
      let id = '';
      const m1 = u.pathname.match(/\/video\/(\d+)/);
      if (m1?.[1]) id = m1[1];
      else {
        const m2 = u.pathname.match(/\/(\d+)/);
        if (m2?.[1]) id = m2[1];
      }
      if (!id) return '';
      return `https://player.vimeo.com/video/${encodeURIComponent(id)}`;
    }
  } catch {
    // ignore
  }
  return '';
}

export function appendQuery(url, params) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null) continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  } catch {
    // Fallback: only append if it doesn't already have a query string.
    const qs = Object.entries(params || {})
      .filter(([, v]) => v != null)
      .map(
        ([k, v]) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
      )
      .join('&');
    if (!qs) return raw;
    return raw.includes('?') ? `${raw}&${qs}` : `${raw}?${qs}`;
  }
}

export function bunnyEmbedUrlFromInput(input, { libraryId = '366590' } = {}) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  // If user pasted the Bunny "play" URL, convert it to an embed URL.
  // Example: https://iframe.mediadelivery.net/play/366590/<uuid>
  if (/iframe\.mediadelivery\.net\/play\//i.test(raw)) {
    try {
      const u = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
      const m = u.pathname.match(/\/play\/(\d+)\/([0-9a-f-]{36})/i);
      if (m?.[1] && m?.[2]) {
        const lib = m[1];
        const id = m[2];
        return `https://iframe.mediadelivery.net/embed/${encodeURIComponent(
          lib
        )}/${encodeURIComponent(id)}`;
      }
    } catch {
      // ignore
    }
  }

  if (/iframe\.mediadelivery\.net\/embed\//i.test(raw)) {
    return normalizeUrl(raw);
  }
  if (looksLikeUuid(raw)) {
    return `https://iframe.mediadelivery.net/embed/${encodeURIComponent(
      libraryId
    )}/${encodeURIComponent(raw)}`;
  }
  return '';
}

export const BUNNY_PLAYER_COLORS = {
  // Brand palette (hex without #) for Bunny Stream embeds.
  primaryColor: 'dbff00',
  controlsColor: 'dbff00',
  accentColor: '375c5d',
};

export function curlyQuote(raw) {
  // Wrap in curly double quotes, but avoid double-wrapping if the user already typed quotes.
  let t = String(raw || '').trim();
  if (!t) return '';

  const OPEN = new Set(['"', '“', '„', '«']);
  const CLOSE = new Set(['"', '”', '“', '»']);
  if (t.length >= 2 && OPEN.has(t[0]) && CLOSE.has(t[t.length - 1])) {
    t = t.slice(1, -1).trim();
  }
  if (!t) return '';
  return `“${t}”`;
}

export function bgClass(bg) {
  const v = String(bg || 'lime').trim().toLowerCase();
  if (v === 'mist') return 'slide-bg-mist';
  if (v === 'lime') return 'slide-bg-lime';
  // Theme-defined variant (see shared/theme-slide-backgrounds.js). The class
  // is inert unless the active theme ships CSS for it, so an id from another
  // theme degrades to the slide type's default background.
  if (SLIDE_BG_ID_RE.test(v)) return `slide-bg-${v}`;
  return 'slide-bg-lime';
}

/**
 * Extended background class helper that includes additional theme colors.
 * Returns the appropriate CSS class for the given background value.
 * @param {string} bg - Background value (lime, mist, dark, accent, brand-1, brand-2, custom)
 * @returns {string} CSS class name
 */
export function bgClassExtended(bg) {
  const v = String(bg || 'lime').trim().toLowerCase();
  switch (v) {
    case 'mist': return 'slide-bg-mist';
    case 'dark': return 'slide-bg-dark';
    case 'accent': return 'slide-bg-accent';
    case 'brand-1': return 'slide-bg-brand-1';
    case 'brand-2': return 'slide-bg-brand-2';
    case 'custom': return 'slide-bg-custom';
    case 'lime': return 'slide-bg-lime';
    default:
      // Theme-defined variant, same rules as bgClass().
      return SLIDE_BG_ID_RE.test(v) ? `slide-bg-${v}` : 'slide-bg-lime';
  }
}

function hash32(str) {
  // Small deterministic hash for seeding PRNG (FNV-1a style).
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    h = (h * 0x01000193) >>> 0;
  }
  // eslint-disable-next-line no-bitwise
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    // eslint-disable-next-line no-bitwise
    a = (a + 0x6d2b79f5) >>> 0;
    // eslint-disable-next-line no-bitwise
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    // eslint-disable-next-line no-bitwise
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    // eslint-disable-next-line no-bitwise
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pct(n) {
  return `${Math.round(n)}%`;
}

export function gradientVarsForSlide(slideId, salt) {
  if (!slideId) return null;
  const rnd = mulberry32(hash32(`${salt}:${slideId}`));

  // Base positions (similar to current quote), with small deterministic jitter.
  // g1: top-middle-ish, slightly right
  // g2: bottom-right
  // g3: bottom-left
  const g1x = clamp(56 + rnd() * 12, 52, 68);
  const g1y = clamp(10 + rnd() * 18, 8, 32);
  const g2x = clamp(84 + rnd() * 14, 70, 96);
  const g2y = clamp(72 + rnd() * 20, 58, 96);
  const g3x = clamp(8 + rnd() * 18, 4, 30);
  const g3y = clamp(72 + rnd() * 20, 58, 96);

  return {
    '--g1x': pct(g1x),
    '--g1y': pct(g1y),
    '--g2x': pct(g2x),
    '--g2y': pct(g2y),
    '--g3x': pct(g3x),
    '--g3y': pct(g3y),
  };
}

export function styleAttrFromVars(vars) {
  if (!vars) return '';
  const parts = Object.entries(vars).map(([k, v]) => `${k}:${v}`);
  return ` style="${parts.join(';')}"`;
}

function normalizePct01to100(raw) {
  // Accept numbers or numeric strings; return integer 0..100 or null.
  if (raw == null) return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  const n = Number(raw);
  if (Number.isNaN(n)) return null;
  return Math.round(clamp(n, 0, 100));
}

export function objectPositionStyleAttrFromFocus({ focusX, focusY } = {}) {
  const x = normalizePct01to100(focusX);
  const y = normalizePct01to100(focusY);
  if (x == null && y == null) return '';
  const xx = x == null ? 50 : x;
  const yy = y == null ? 50 : y;
  return styleAttrFromVars({
    'object-position': `${xx}% ${yy}%`,
  });
}

export function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Clamp a number to an integer within [min, max], with a fallback if NaN.
 */
export function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (Number.isFinite(v)) return Math.max(min, Math.min(max, Math.round(v)));
  return fallback;
}

/**
 * Get subheading text from slide content.
 * @param {object} content - Slide content object
 * @returns {string} Trimmed subheading text or empty string
 */
export function getSubheadingText(content) {
  return (typeof content?.subheading === 'string' && content.subheading.trim()) || '';
}

/**
 * Render subheading HTML.
 * @param {object} content - Slide content object
 * @param {string} className - CSS class name (default: 'subheading')
 * @returns {string} HTML string or empty string
 */
export function renderSubheadingHtml(content, className = 'subheading') {
  const text = getSubheadingText(content);
  return text ? `<p class="${className}" data-inline-field="subheading" dir="auto">${esc(text)}</p>` : '';
}

/**
 * Render bottom subheading HTML.
 * @param {object} content - Slide content object
 * @returns {string} HTML string or empty string
 */
export function renderBottomSubheadingHtml(content) {
  const text = typeof content?.bottomSubheading === 'string'
    ? content.bottomSubheading.trim()
    : '';
  return text ? `<p class="bottom-subheading" data-inline-field="bottomSubheading" dir="auto">${esc(text)}</p>` : '';
}

/**
 * Check if content has a bottom subheading.
 * @param {object} content - Slide content object
 * @returns {boolean}
 */
export function hasBottomSubheading(content) {
  return typeof content?.bottomSubheading === 'string' && content.bottomSubheading.trim().length > 0;
}

export function isIsoString(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

export function isUuid(v) {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  );
}

export function cryptoUuid() {
  // Browser-safe fallback if crypto.randomUUID isn't available.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // eslint-disable-next-line no-bitwise
  const rnd = (n) => (Math.random() * n) | 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = rnd(16);
    // eslint-disable-next-line no-bitwise
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get card title with back-compat support for legacy 'cardNLabel' field.
 * @param {object} content - Slide content object
 * @param {number} cardIndex - Card index (1-based)
 * @returns {string} Trimmed card title or empty string
 */
export function getCardTitle(content, cardIndex) {
  // DEPRECATED: cardNLabel fallback - Remove after April 2026
  return String(content?.[`card${cardIndex}Title`] || content?.[`card${cardIndex}Label`] || '').trim();
}

/**
 * Get collection items with back-compat support for legacy field names.
 * @param {object} content - Slide content object
 * @param {string} primaryKey - Primary key to check first (e.g., 'items')
 * @param {string[]} fallbackKeys - Fallback keys to check (e.g., ['steps', 'stages'])
 * @returns {Array} Array of items or empty array
 */
export function getCollectionItems(content, primaryKey = 'items', fallbackKeys = []) {
  // DEPRECATED: fallbackKeys support - Remove after April 2026
  const arr = content?.[getCollectionKey(content, primaryKey, fallbackKeys)];
  return Array.isArray(arr) ? arr : [];
}

/**
 * Which content key `getCollectionItems` reads from. Renderers use this to emit
 * `data-inline-field` paths that point at the array actually rendered (legacy
 * decks may still store `steps`/`stages`), and the inline editor uses the same
 * key to write back to that array.
 * @param {object} content - Slide content object
 * @param {string} primaryKey - Primary key to check first (e.g., 'items')
 * @param {string[]} fallbackKeys - Fallback keys to check (e.g., ['steps'])
 * @returns {string} The key holding the rendered collection
 */
export function getCollectionKey(content, primaryKey = 'items', fallbackKeys = []) {
  if (Array.isArray(content?.[primaryKey]) && content[primaryKey].length > 0) {
    return primaryKey;
  }
  for (const key of fallbackKeys) {
    if (Array.isArray(content?.[key]) && content[key].length > 0) {
      return key;
    }
  }
  return primaryKey;
}

/**
 * Resolve a raw per-card `link` value into an anchor descriptor, or `null`.
 *
 * Shared across clickable card/tile slide types (icon-card-grid, logo-wall, …).
 * Supported author input:
 *  - `#slide:<id>` — jump to the deck slide with that id (chosen via the editor
 *    slide picker). Stable across reordering; resolved to a live index by the
 *    presenter. In-deck only, so ignored outside `present`.
 *  - `#N` — jump to slide N (1-based) within the deck (legacy/manual form,
 *    positional). Also in-deck only.
 *  - an `http(s):` or `mailto:` URL — opens in a new tab. Suppressed in
 *    non-interactive previews: thumbnails (`mode === 'thumb'`) and the
 *    inline-edit canvas (`mode === 'edit'`), where an overlay anchor would
 *    intercept click-to-edit. Live modes (present/follow) and exports (mode
 *    undefined) keep the clickable link.
 * Anything else (relative paths, `javascript:`, bare words) is ignored.
 *
 * @param {string} raw
 * @param {string} [mode] render mode from ctx ('present' | 'follow' | 'thumb' | 'edit' | undefined)
 * @returns {{ kind: 'nav', index: number } | { kind: 'nav-id', id: string } | { kind: 'external', href: string } | null}
 */
export function resolveCardLink(raw, mode) {
  const link = String(raw || '').trim();
  if (!link) return null;
  const navId = /^#slide:(.+)$/.exec(link);
  if (navId) {
    if (mode !== 'present') return null;
    return { kind: 'nav-id', id: navId[1].trim() };
  }
  const nav = /^#(\d{1,3})$/.exec(link);
  if (nav) {
    if (mode !== 'present') return null;
    return { kind: 'nav', index: Number(nav[1]) };
  }
  if (mode === 'thumb' || mode === 'edit') return null;
  if (!/^(https?:|mailto:)/i.test(link)) return null;
  return { kind: 'external', href: link };
}

/**
 * Build a full-card overlay anchor for a resolved card link, or `''` when the
 * card has no usable link in this mode. Callers append the returned string as
 * the last child of a `position: relative` card container and add a `has-link`
 * class for the pointer cursor. Styling lives in the shared `.slide .card-link`
 * rule.
 *
 * @param {string} raw raw `link` field value
 * @param {string} [mode] render mode from ctx
 * @param {string} [ariaLabel] accessible name (escaped here)
 * @returns {string} anchor HTML or ''
 */
export function cardLinkOverlayHtml(raw, mode, ariaLabel) {
  const info = resolveCardLink(raw, mode);
  if (!info) return '';
  const aria = esc(ariaLabel || 'Card link');
  if (info.kind === 'nav')
    return `<a class="card-link" data-card-nav="${info.index}" href="#" aria-label="${aria}"></a>`;
  if (info.kind === 'nav-id')
    return `<a class="card-link" data-card-nav-id="${esc(info.id)}" href="#" aria-label="${aria}"></a>`;
  return `<a class="card-link" href="${esc(info.href)}" target="_blank" rel="noopener noreferrer" aria-label="${aria}"></a>`;
}

/**
 * The picture glyph used inside every empty-image placeholder. Decorative:
 * the placeholder itself is `aria-hidden`, and the accessible affordance is
 * the editor's "Add image" chip, not this.
 */
const IMAGE_PLACEHOLDER_ICON =
  '<svg class="image-placeholder-icon" viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true">' +
  '<path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5V5h14v14Zm-3-4-2.5-3.2a1 1 0 0 0-1.6 0L10 14l-.9-1.2a1 1 0 0 0-1.6 0L6 15.2V18h13v-3Zm-8.5-6.5A1.5 1.5 0 1 0 9 7a1.5 1.5 0 0 0-1.5 1.5Z"></path>' +
  '</svg>';

/**
 * Inner content of an empty-image placeholder: icon + label.
 *
 * Every slide type used to inline its own copy of the SVG, and the label was
 * hardcoded per type — image-text said "Afbeelding", image-slide said "Image",
 * neither localised. One helper keeps the glyph in one place and routes the
 * label through the presentation language.
 *
 * Callers own the outer box, because its class is what each type's CSS targets
 * (`.image-placeholder`, `.gallery-image-placeholder`, …).
 *
 * @param {string} [label] Localised label; omit for an icon-only placeholder.
 * @returns {string} HTML for the placeholder's inner content
 */
export function imagePlaceholderInnerHtml(label) {
  const text = nonEmpty(label)
    ? `<div class="image-placeholder-text">${esc(label)}</div>`
    : '';
  return `<div class="image-placeholder-inner">${IMAGE_PLACEHOLDER_ICON}${text}</div>`;
}

/**
 * A complete empty-image placeholder box.
 *
 * Every slide type with an image slot renders one of these, so they share a
 * base class (`image-placeholder`), the glyph, the `is-empty` hook the inline
 * editor keys off, and `aria-hidden` — the box is decorative, the accessible
 * affordance is the editor's "Add image" chip.
 *
 * What stays per type is the *modifier* class, because that is what each
 * type's own CSS targets to size and colour its slot (a 112px round portrait
 * and a full-bleed image frame have nothing in common there).
 *
 * @param {Object} [options]
 * @param {string} [options.className] - Type modifier, e.g. `quote-portrait`.
 * @param {string} [options.label] - Localised label; omit for icon-only.
 * @param {number|string} [options.index] - `data-inline-photo` value. Omit to
 *   leave the attribute off entirely (freeform uses its own hooks).
 * @param {boolean} [options.compact] - Small slot: shrink the glyph, drop the
 *   label. For round portraits and logo cells, where a label cannot fit.
 * @param {string} [options.attrs] - Extra pre-rendered attributes.
 * @returns {string}
 */
export function imagePlaceholderHtml({
  className = '',
  label = '',
  index,
  compact = false,
  attrs = '',
} = {}) {
  const classes = ['image-placeholder', className, compact ? 'is-compact' : '', 'is-empty']
    .filter(Boolean)
    .join(' ');
  // String() first: esc() collapses falsy input to '', which would silently
  // drop index 0 — the first slot of every deck.
  const photoAttr =
    index === undefined || index === null ? '' : ` data-inline-photo="${esc(String(index))}"`;
  const inner = imagePlaceholderInnerHtml(compact ? '' : label);
  return `<div class="${classes}"${photoAttr}${attrs} aria-hidden="true">${inner}</div>`;
}
