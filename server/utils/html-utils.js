/**
 * Shared HTML utilities for export modules
 * Consolidates duplicate functions from export-html.js, export-pdf-slides.js,
 * render-png.js, export-png-slides.js, and export-print.js
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { SLIDE_TYPES } from '../../shared/slide-types.js';
import { isServedAssetRef } from '../../shared/slide-types/deck-assets.js';
import { isIconUrl } from '../../shared/icon-names.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';
import { resolveServedPath } from './served-asset-path.js';
import { isRemoteHttpUrl, safeFetchRemoteImage } from './ssrf-guard.js';
import { mapLimit, exportEmbedConcurrency } from './map-limit.js';
import { createLogger } from './logger.js';
import { cssUrlReferences, rewriteCssUrls } from './css-urls.js';

const log = createLogger('html-utils');

/** 1x1 fully transparent PNG — what an unembeddable image becomes. */
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * Read a file, returning empty string if it doesn't exist
 * @param {string} p - File path
 * @returns {Promise<string>} File contents or empty string
 */
export async function readTextIfExists(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Get MIME type from file extension
 * @param {string} ext - File extension (without dot)
 * @returns {string} MIME type
 */
export function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  switch (e) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'avif':
      return 'image/avif';
    case 'woff2':
      return 'font/woff2';
    case 'woff':
      return 'font/woff';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Is `s` a local file the render side inlines into a self-contained export?
 *
 * Exactly the deck-asset class — {@link isServedAssetRef}, the one spelling of
 * "a path this installation serves as an asset" (D99) — plus the icon SVGs the
 * renderer emits itself ({@link isIconUrl}). Nothing else under `/client/`:
 * the client tree is code, not content, and slide text that names
 * `/client/lib/…` has no business being read into an export.
 * @param {unknown} s
 * @returns {boolean}
 */
export function isRenderAssetRef(s) {
  return isServedAssetRef(s) || isIconUrl(s);
}

/**
 * Resolve a render asset ref to an absolute path contained in the directory
 * the server serves it from, or null when `s` is outside
 * {@link isRenderAssetRef} or escapes that directory. The prefix → root table
 * is the served one ({@link resolveServedPath}), so an installation that moved
 * its uploads or fork root inlines its own files rather than the checkout's.
 * @param {string} repoRoot - Installation root
 * @param {string} s - A root-relative URL path (e.g. `/assets/x.png`)
 * @returns {string|null} Contained absolute path, or null
 */
export function resolveRenderAssetPath(repoRoot, s) {
  if (!isRenderAssetRef(s)) return null;
  return resolveServedPath(repoRoot, s)?.path ?? null;
}

/**
 * Convert a local path to a data URL if it's an upload or asset
 * @param {string} repoRoot - Repository root path
 * @param {string} urlOrPath - URL or path to convert
 * @param {Object} options - Options
 * @param {(buf: Buffer, ext: string, mime: string, url?: string) => Promise<{buf: Buffer, mime: string}>} [options.transform]
 *   Optional async transform applied to the image bytes before base64-encoding
 *   (e.g. downsample/recompress for PDF). Receives the source URL/path so a
 *   transform can size per image (see image-measure.js). Must resolve to `{ buf, mime }`.
 * @param {boolean} [options.embedRemote] When true, remote http(s) image URLs
 *   are fetched through the SSRF guard and inlined as data URLs; a blocked or
 *   failed fetch returns '' (stripped) so the URL never reaches headless Chrome.
 *   Only enable on server-side export/render paths. See
 *   docs/reference/security-posture.md § SSRF guard on server-side image fetches.
 * @param {Map<string, Promise<string>>} [options.cache] Optional per-export-run
 *   cache keyed by source URL/path. When supplied, the same source is fetched +
 *   recompressed at most once across every embed pass in the run (the in-flight
 *   promise is memoised, so concurrent callers dedupe too). Scope one Map to a
 *   single export run with a single transform config; do not share across runs.
 * @returns {Promise<string>} Data URL or original string
 */
export function toDataUrlIfLocal(repoRoot, urlOrPath, options = {}) {
  const s = String(urlOrPath || '');
  const cache = options.cache || null;
  if (cache) {
    const existing = cache.get(s);
    if (existing) return existing;
  }
  const promise = computeDataUrlIfLocal(repoRoot, s, options);
  if (cache) cache.set(s, promise);
  return promise;
}

/**
 * Async worker behind {@link toDataUrlIfLocal}. Kept separate so the public
 * function can memoise the returned promise synchronously (dedupe in-flight
 * fetches) before the first await.
 * @param {string} repoRoot
 * @param {string} s - Already-stringified URL or path
 * @param {Object} options - Same shape as toDataUrlIfLocal options (minus cache)
 * @returns {Promise<string>}
 */
async function computeDataUrlIfLocal(
  repoRoot,
  s,
  { transform = null, embedRemote = false } = {},
) {
  if (!isRenderAssetRef(s)) {
    // Remote http(s) images: on export/render paths, inline through the SSRF
    // guard or strip. Everything else (data: URIs, other schemes) is untouched.
    if (embedRemote && isRemoteHttpUrl(s)) {
      const fetched = await safeFetchRemoteImage(s);
      if (!fetched) return '';
      let buf = fetched.buffer;
      let mime = fetched.contentType || 'application/octet-stream';
      const ext = mime.startsWith('image/') ? mime.slice(6) : '';
      if (typeof transform === 'function') {
        const r = await transform(buf, ext, mime, s);
        if (r && Buffer.isBuffer(r.buf)) {
          buf = r.buf;
          if (r.mime) mime = r.mime;
        }
      }
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
    return s;
  }

  const abs = resolveRenderAssetPath(repoRoot, s);
  if (!abs) return s;

  try {
    let buf = await fs.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    let mime = mimeFromExt(ext);
    if (typeof transform === 'function') {
      const r = await transform(buf, ext, mime, s);
      if (r && Buffer.isBuffer(r.buf)) {
        buf = r.buf;
        if (r.mime) mime = r.mime;
      }
    }
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return s;
  }
}

/**
 * Replace img src attributes with data URLs for local assets
 * @param {string} repoRoot - Repository root path
 * @param {string} html - HTML string
 * @param {Object} options - Options
 * @param {Function} [options.transform] - Optional image-bytes transform (see toDataUrlIfLocal)
 * @param {Map<string, Promise<string>>} [options.cache] - Optional per-run embed cache (see toDataUrlIfLocal)
 * @returns {Promise<string>} HTML with embedded images
 */
export async function embedImgSrcDataUrls(
  repoRoot,
  html,
  { transform = null, embedRemote = false, cache = null } = {},
) {
  // CSS first, while the document is still small: only what a browser reads
  // as CSS (see cssRegionsOfHtml). Remote url() is the safety net for a
  // custom-HTML slide's `background-image:url('http://…')`, which the
  // field-level embed pass and the <img src> net below both miss; left intact
  // it reaches headless Chrome at setContent → server-side fetch (SSRF), so it
  // is inlined through the guard or blanked (only with embedRemote, the
  // export/render path; docs/reference/security-posture.md § SSRF guard on
  // server-side image fetches). Local url() — a CSS mask or background
  // pointing at an asset of this install — runs on every path, for the same
  // reason as the <img src> pass: the document has no base URL once it
  // reaches headless Chrome.
  const s = await embedCssUrlsInHtml(repoRoot, String(html || ''), {
    embedRemote,
    transform,
    cache,
  });
  const uniq = new Map();
  for (const m of s.matchAll(LOCAL_SRC_RE)) {
    if (isRenderAssetRef(m[1])) uniq.set(m[1], true);
  }
  // Safety net: when inlining remote images, also catch raw remote <img src>
  // (e.g. from custom HTML) so no http(s) src reaches headless Chrome.
  if (embedRemote) {
    for (const m of s.matchAll(/\ssrc="(https?:\/\/[^"]+)"/gi)) {
      uniq.set(m[1], true);
    }
  }
  // Resolve every unique src concurrently (bounded), then apply all string
  // replacements once. Building the src->data map first avoids re-scanning
  // mutated output and partial-match races during parallel fetches.
  let out = s;
  if (uniq.size) {
    const srcs = [...uniq.keys()];
    const datas = await mapLimit(srcs, exportEmbedConcurrency(), (src) =>
      toDataUrlIfLocal(repoRoot, src, {
        transform,
        embedRemote,
        cache,
      }),
    );
    for (let i = 0; i < srcs.length; i++) {
      const src = srcs[i];
      let data = datas[i];
      if (data === '') {
        // A remote image that could not be fetched (gone, blocked, timed out).
        // An *empty* src is not "no image": the browser resolves it against the
        // document, fails, and draws its broken-image glyph plus the alt text —
        // which then bakes into the PDF. A transparent pixel leaves a blank
        // space instead, which is what a missing decorative image should be.
        log.debug(`[export] image could not be embedded, blanked: ${src}`);
        data = TRANSPARENT_PIXEL;
      }
      if (data !== src) {
        out = out.split(`src="${src}"`).join(`src="${data}"`);
      }
    }
  }

  return out;
}

/** A remote http(s) target of a CSS `url(...)`. */
const REMOTE_URL_RE = /^https?:\/\//i;

/** Match a root-relative `src="…"`; {@link isRenderAssetRef} decides. */
const LOCAL_SRC_RE = /\ssrc="(\/[^"]+)"/g;

/**
 * The local `url(...)` targets in some CSS texts that may be inlined, mapped
 * to their data URL. An allowed asset that could not be read maps to itself
 * and is named in a warning: unresolvable is better than silently rewritten,
 * and it shows up in the export as the same missing asset it already was. Not
 * silently, though: the same refusal form as an unreadable font (B542, D278).
 *
 * Same predicate and containment check as the `<img src>` pass, so a `url()`
 * widens *where* a local asset may be referenced from, not *which* files can
 * be read.
 *
 * @param {string} repoRoot
 * @param {string[]} cssTexts
 * @param {Object} opts
 * @returns {Promise<Map<string, string>>}
 */
async function localCssUrlMap(repoRoot, cssTexts, { transform, cache }) {
  const uniq = new Set();
  for (const css of cssTexts) {
    for (const { url } of cssUrlReferences(css)) {
      if (url.startsWith('/') && isRenderAssetRef(url)) uniq.add(url);
    }
  }
  const urls = [...uniq];
  const datas = await mapLimit(urls, exportEmbedConcurrency(), (url) =>
    toDataUrlIfLocal(repoRoot, url, { transform, cache }),
  );
  const map = new Map(urls.map((u, i) => [u, datas[i] || u]));
  for (const [url, data] of map) {
    if (data === url) {
      log.warn(`Not inlining ${url}: local asset unresolvable or unreadable`);
    }
  }
  return map;
}

/** Apply a {@link localCssUrlMap} to one CSS text. */
function rewriteLocalCssUrls(css, map) {
  if (!map.size) return css;
  return rewriteCssUrls(css, (url) => {
    const data = map.get(url);
    return data && data !== url ? `url('${data}')` : undefined;
  });
}

/**
 * The remote `url(...)` targets in some CSS texts, mapped to what the SSRF
 * guard made of them: a data URL, or `''` when the fetch was blocked or
 * failed.
 *
 * @param {string} repoRoot
 * @param {string[]} cssTexts
 * @param {Object} opts
 * @returns {Promise<Map<string, string>>}
 */
async function remoteCssUrlMap(repoRoot, cssTexts, { transform, cache }) {
  const uniq = new Set();
  for (const css of cssTexts) {
    for (const { url } of cssUrlReferences(css)) {
      if (REMOTE_URL_RE.test(url)) uniq.add(url);
    }
  }
  const urls = [...uniq];
  const datas = await mapLimit(urls, exportEmbedConcurrency(), (url) =>
    // embedRemote inlines through the guard or returns '' (stripped).
    toDataUrlIfLocal(repoRoot, url, { embedRemote: true, transform, cache }),
  );
  return new Map(urls.map((u, i) => [u, datas[i] || '']));
}

/** Apply a {@link remoteCssUrlMap} to one CSS text: a blocked or failed
 *  target becomes `url('')`, so Chrome fetches nothing. */
function rewriteRemoteCssUrls(css, map) {
  if (!map.size) return css;
  return rewriteCssUrls(css, (url) => {
    if (!map.has(url)) return undefined;
    const data = map.get(url);
    return data ? `url('${data}')` : "url('')";
  });
}

/**
 * Inline local `url(...)` targets in a CSS text as data URLs.
 *
 * The export HTML reaches headless Chrome through `setContent()`, so the
 * document has no base URL and a root-relative path resolves to nothing. For
 * `<img src>` that has always been handled; a `url()` was not, and the gap was
 * invisible until a slide type started drawing with one. `icon-card-grid-slide`
 * does: it passes its icon as `style="--icg-icon-url:url(/client/vendor/…svg)"`
 * and the stylesheet turns that into a `mask`. The mask silently failed to load
 * and the chip rendered as the bare `background-color` — a solid dark square
 * where the icon should be, in every PDF and PNG export.
 *
 * CSS text only (a stylesheet, the theme vars). Markup goes through
 * {@link embedImgSrcDataUrls}, which reads the CSS out of it first: in markup,
 * a `url(...)` in a title or an alt text is text (DY-865).
 *
 * @param {string} repoRoot
 * @param {string} cssText
 * @param {Object} [opts]
 * @param {Function} [opts.transform] - Optional image-bytes transform.
 * @param {Map<string, Promise<string>>} [opts.cache] - Shared per-run embed cache.
 * @returns {Promise<string>}
 */
export async function embedLocalCssUrls(
  repoRoot,
  cssText,
  { transform = null, cache = null } = {},
) {
  const css = String(cssText || '');
  const map = await localCssUrlMap(repoRoot, [css], { transform, cache });
  return rewriteLocalCssUrls(css, map);
}

/**
 * Neutralize every `url(...)` in a stylesheet for a self-contained export:
 * remote targets go through the SSRF guard (inlined, or blanked so nothing is
 * fetched), local ones become data URLs because the document reaches Chrome
 * through `setContent()` and has no base URL to resolve against.
 *
 * Both halves, always: a stylesheet that is handed to headless Chrome with a
 * live remote `url()` is a server-side fetch of a user-supplied address, and a
 * root-relative path that survives resolves to nothing. This is the CSS-text
 * counterpart of what {@link embedImgSrcDataUrls} does for markup, extracted
 * so the theme-vars block can take the same pass — it is assembled separately
 * from the page markup, and used to take none at all.
 *
 * @param {string} repoRoot
 * @param {string} cssText
 * @param {Object} [opts]
 * @param {Function} [opts.transform] - Optional image-bytes transform.
 * @param {Map<string, Promise<string>>} [opts.cache] - Shared per-run embed cache.
 * @returns {Promise<string>}
 */
export async function embedCssUrlsForExport(
  repoRoot,
  cssText,
  { transform = null, cache = null } = {},
) {
  const css = String(cssText || '');
  const remote = await remoteCssUrlMap(repoRoot, [css], { transform, cache });
  const remoteEmbedded = rewriteRemoteCssUrls(css, remote);
  const local = await localCssUrlMap(repoRoot, [remoteEmbedded], {
    transform,
    cache,
  });
  return rewriteLocalCssUrls(remoteEmbedded, local);
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// SVG presentation attributes whose CSS grammar accepts URL references.
const SVG_URL_ATTRIBUTES = new Set([
  'fill',
  'stroke',
  'filter',
  'clip-path',
  'mask',
  'cursor',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
]);

/**
 * The CSS in an HTML string, as a browser reads it, with where it stands in
 * that string: the text of every `<style>` element, every `style` attribute,
 * and SVG URL presentation attributes (`fill="url(…)"` and the like).
 * An attribute comes back decoded, the way the browser decodes it. Text and the other HTML
 * attributes are not CSS: a `url(...)` in a title, a body or an alt text is
 * data, and loads nothing (DY-865). Unstamped HTML templates are inert;
 * export documents do not stamp them.
 *
 * Read with an HTML parser, never a regex over the document: the parser
 * decides what is markup and what is text the same way the browser does.
 *
 * @param {string} html
 * @returns {Array<{ start: number, end: number, css: string,
 *   attribute: boolean }>} In document order. For an attribute, `start..end`
 *   spans `name="value"`; for a `<style>`, its text.
 */
export function cssRegionsOfHtml(html) {
  const dom = new JSDOM(html, { includeNodeLocations: true });
  const regions = [];
  const visit = (root) => {
    for (const element of root.querySelectorAll('*')) {
      const loc = dom.nodeLocation(element);
      if (!loc) continue;
      if (element.localName === 'style' && loc.startTag && loc.endTag) {
        regions.push({
          start: loc.startTag.endOffset,
          end: loc.endTag.startOffset,
          css: element.textContent,
          attribute: false,
        });
      }
      const svg = element.namespaceURI === SVG_NAMESPACE;
      for (const { name, value } of element.attributes) {
        if (
          name.toLowerCase() !== 'style' &&
          !(svg && SVG_URL_ATTRIBUTES.has(name))
        )
          continue;
        const at = loc.attrs?.[name] || loc.attrs?.[name.toLowerCase()];
        if (!at) continue;
        regions.push({
          start: at.startOffset,
          end: at.endOffset,
          css: value,
          attribute: true,
        });
      }
    }
  };
  visit(dom.window.document);
  dom.window.close();
  return regions.sort((a, b) => a.start - b.start);
}

/**
 * A value as it is written back between double quotes: as is when nothing in
 * it needs a character reference, which keeps the inlined `url('…')` readable.
 */
function inAttribute(value) {
  return /[&"]/.test(value) ? escapeHtml(value) : value;
}

/**
 * Inline (or blank) the `url(...)` targets of the CSS in an HTML string:
 * local ones always, remote ones through the SSRF guard with `embedRemote`.
 * Only the CSS {@link cssRegionsOfHtml} finds is read and rewritten; every
 * other byte of the document stays as written, a region that does not change
 * included.
 *
 * @param {string} repoRoot
 * @param {string} html
 * @param {Object} opts
 * @returns {Promise<string>}
 */
async function embedCssUrlsInHtml(
  repoRoot,
  html,
  { embedRemote, transform, cache },
) {
  // Every url() needs a `(`: in the source, or as a character reference an
  // attribute decodes to one. Without either there is nothing to read.
  if (
    !html.includes('(') &&
    !/&(?:lpar;|#0*40(?:;|(?=[^0-9]|$))|#x0*28(?:;|(?=[^0-9a-f]|$)))/i.test(
      html,
    )
  ) {
    return html;
  }
  const regions = cssRegionsOfHtml(html).filter(
    (r) => cssUrlReferences(r.css).length,
  );
  if (!regions.length) return html;

  const cssTexts = regions.map((r) => r.css);
  const remote = embedRemote
    ? await remoteCssUrlMap(repoRoot, cssTexts, { transform, cache })
    : new Map();
  const remoteEmbedded = cssTexts.map((css) =>
    rewriteRemoteCssUrls(css, remote),
  );
  const local = await localCssUrlMap(repoRoot, remoteEmbedded, {
    transform,
    cache,
  });

  let out = '';
  let at = 0;
  regions.forEach((region, i) => {
    const css = rewriteLocalCssUrls(remoteEmbedded[i], local);
    if (css === region.css || region.start < at) return;
    const source = html.slice(region.start, region.end);
    const written = region.attribute
      ? `${source.slice(0, source.indexOf('=') + 1)}"${inAttribute(css)}"`
      : css;
    out += html.slice(at, region.start) + written;
    at = region.end;
  });
  return out + html.slice(at);
}

/**
 * Get image field keys for a slide type
 * @param {string} type - Slide type
 * @returns {string[]} Array of field keys that are images
 */
export function imageFieldKeysForType(type) {
  const def = SLIDE_TYPES?.[type];
  if (!def?.fields) return [];
  return def.fields
    .filter((f) => f?.type === 'image' && typeof f?.key === 'string')
    .map((f) => f.key);
}

/**
 * Check if a string looks like a URL
 * @param {string} s - String to check
 * @returns {boolean} True if it looks like a URL
 */
export function isProbablyUrl(s) {
  const t = String(s || '').trim();
  return /^https?:\/\//i.test(t) || t.startsWith('//');
}
