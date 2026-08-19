import fs from 'node:fs/promises';
import path from 'node:path';
import { uploadsDir } from '../config/storage-paths.js';
import { assertPublicHttpUrl } from './ssrf-guard.js';
import { cssStringEscape, mergeFontFaces } from '../../shared/theme-fonts.js';

function stripFontFaceBlocks(cssText) {
  return String(cssText || '').replace(/@font-face\s*\{[\s\S]*?\}\s*/g, '');
}

async function readFontAsDataUrl(repoRoot, relPath, mime = 'font/woff2') {
  const abs = path.join(repoRoot, relPath);
  const buf = await fs.readFile(abs);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Resolve a relative /uploads/ URL to a local filesystem data URL.
 * Used when the media provider stores files locally (not on an external CDN).
 */
async function readLocalUploadAsDataUrl(repoRoot, urlPath, format = 'woff2') {
  const mime = format === 'woff' ? 'font/woff' : 'font/woff2';
  // Strip the /uploads/ prefix to get the filename
  const filename = urlPath.replace(/^\/uploads\//, '');
  const abs = path.join(uploadsDir(repoRoot), filename);
  const buf = await fs.readFile(abs);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Fetch a remote URL and return its content as a base64 data URL.
 * Used for embedding uploaded (media-provider-hosted) fonts into exports.
 */
export async function fetchFontAsDataUrl(url, format = 'woff2') {
  const mime = format === 'woff' ? 'font/woff' : 'font/woff2';

  // SSRF guard: reject non-http(s) schemes and any host resolving to a
  // loopback/private/link-local address (incl. cloud metadata), covering the IP
  // encodings / IPv6 / rebinding the old string blocklist missed.
  try {
    await assertPublicHttpUrl(url);
  } catch (e) {
    if (e?.code === 'SSRF_BAD_SCHEME')
      throw new Error('Font URL must use HTTP(S)');
    if (e?.code === 'SSRF_BLOCKED_ADDRESS')
      throw new Error('Font URL must not point to internal addresses');
    throw new Error('Invalid font URL');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // redirect:'error' so a public URL can't 30x-bounce into private space.
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
    });
    if (!resp.ok) return null;
    // Don't embed an internal service's document/data response as a "font".
    // Best-effort blocklist (fonts arrive as font/*, octet-stream, or with no
    // content-type on some CDNs, so we reject the obvious non-font types rather
    // than allowlist and risk dropping legitimate fonts).
    const contentType = String(resp.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (
      /^(text\/|application\/(json|xml|xhtml|javascript|ld\+json))/.test(
        contentType,
      )
    ) {
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > 10 * 1024 * 1024) {
      throw new Error('Font file exceeds 10MB size limit');
    }
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    if (e.message.includes('Font') || e.message.includes('size limit')) throw e;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve one embedFonts entry to its bytes, as a base64 data URL.
 * @returns {Promise<string|null>} data URL, or null when the source is unusable
 */
async function resolveEmbedSource(repoRoot, { url, path: relPath, format }) {
  if (url && url.startsWith('/uploads/')) {
    // Locally-stored uploaded font — read directly from the uploads directory
    try {
      return await readLocalUploadAsDataUrl(repoRoot, url, format);
    } catch {
      return null; // file not found
    }
  }
  if (url) {
    // URL-based font (external CDN / media provider) — fetch and base64-encode
    return await fetchFontAsDataUrl(url, format);
  }
  if (relPath) {
    // Path-based font (local curated file)
    try {
      return await readFontAsDataUrl(repoRoot, relPath);
    } catch {
      return null; // e.g. postinstall download skipped
    }
  }
  return null;
}

export async function buildEmbeddedFontCss(repoRoot, theme = null) {
  // These will be inlined into export HTML so opening the exported file via
  // `file://` still works (no network, no local-path fetches).
  // Themes declare which fonts to embed via embedFonts (theme-builder
  // generates this for managed fonts). Without it there's nothing to embed —
  // the export falls back to the CSS font stacks.
  const list = Array.isArray(theme?.embedFonts) ? theme.embedFonts : [];

  // Resolve each distinct source exactly once. A curated family pins one
  // *variable* woff2 per subset and repeats it for every weight, so a
  // four-weight family names four paths that hold identical bytes; reading
  // (and later inlining) them per entry is where the export's font payload
  // quadrupled.
  const sources = new Map();
  const faces = [];

  for (const f of list) {
    const family = String(f?.family || '').trim();
    if (!family) continue;

    const format = String(f?.format || 'woff2');
    const url = typeof f?.url === 'string' ? f.url.trim() : '';
    const relPath = !url && f?.path ? String(f.path).trim() : '';
    if (!url && !relPath) continue;

    const sourceKey = `${format} ${url || `path:${relPath}`}`;
    if (!sources.has(sourceKey)) {
      sources.set(
        sourceKey,
        resolveEmbedSource(repoRoot, { url, path: relPath, format }),
      );
    }

    faces.push({
      family,
      // Left raw: a curated entry already carries the merged CSS range
      // ("400 700"), which mergeFontFaces knows how to read.
      weight: f?.weight ?? 400,
      style: String(f?.style || 'normal'),
      format,
      // Curated fonts arrive as one entry per weight × Google subset; without
      // the range the second entry would simply override the first and half
      // the glyphs would fall back. Uploaded fonts carry no range and need none.
      unicodeRange: String(f?.unicodeRange || '').trim(),
      sourceKey,
    });
  }

  const dataUrls = new Map(
    await Promise.all(
      [...sources].map(async ([key, promise]) => [key, await promise]),
    ),
  );

  // The data URL *is* the file identity: two entries that base64 to the same
  // string are the same bytes, whatever they were named on disk.
  const identified = [];
  for (const face of faces) {
    const dataUrl = dataUrls.get(face.sourceKey);
    if (!dataUrl) continue; // unreadable / failed fetch — skip, as before
    identified.push({ ...face, identity: dataUrl });
  }

  const blocks = mergeFontFaces(identified).map((face) =>
    `
@font-face {
  font-family: '${cssStringEscape(face.family)}';
  src: url('${face.identity}') format('${face.format}');
  font-weight: ${face.weight};
  font-style: ${face.style};
  font-display: swap;${face.unicodeRange ? `\n  unicode-range: ${face.unicodeRange};` : ''}
}`.trim(),
  );

  return blocks.join('\n');
}

export function stripFontFacesFromCss(cssText) {
  return stripFontFaceBlocks(cssText);
}

// Matches root-relative local font URLs inside url(...) — quoted or bare,
// woff or woff2. Group 1 is the (optional) opening quote, group 2 the path.
const LOCAL_FONT_URL_RE = /url\(\s*(['"]?)(\/[^'")]+\.woff2?)\1\s*\)/gi;

/**
 * Inline root-relative local font URLs (woff/woff2 served from the repo) in a
 * CSS string as base64 data URLs. Used by the standalone HTML export so the
 * downloaded file renders its fonts offline, without a server to resolve
 * `/assets/...` paths.
 *
 * Only URLs that actually appear in the CSS are embedded, never the whole
 * pinned font library (~2.7 MB across all curated families). Files that
 * resolve outside the repo, or can't be read, are left untouched.
 *
 * Theme fonts are embedded separately via {@link buildEmbeddedFontCss}. No
 * built-in stylesheet declares an @font-face any more, so in practice this is
 * the safety net for a *custom* theme that ships its own face in a stylesheet
 * the export bundle picks up — and the thing that guarantees no
 * `/assets/...woff2` reference survives into a downloaded file.
 *
 * @param {string} repoRoot - Repository root path
 * @param {string} cssText - CSS source text
 * @returns {Promise<string>} CSS with local font URLs replaced by data URLs
 */
export async function inlineLocalFontUrls(repoRoot, cssText) {
  const css = String(cssText || '');
  const paths = new Set();
  for (const m of css.matchAll(LOCAL_FONT_URL_RE)) paths.add(m[2]);
  if (!paths.size) return css;

  const rootAbs = path.resolve(repoRoot);
  const dataUrls = new Map();
  await Promise.all(
    [...paths].map(async (urlPath) => {
      try {
        const abs = path.resolve(rootAbs, urlPath.replace(/^\/+/, ''));
        // Stay inside the repo — the CSS is our own, but never read arbitrary
        // paths if a `..` ever slips into a bundled stylesheet.
        if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return;
        const buf = await fs.readFile(abs);
        const mime = urlPath.toLowerCase().endsWith('.woff')
          ? 'font/woff'
          : 'font/woff2';
        dataUrls.set(urlPath, `data:${mime};base64,${buf.toString('base64')}`);
      } catch {
        // Leave the original URL in place if the file can't be read
        // (e.g. a curated font whose postinstall download was skipped).
      }
    }),
  );

  return css.replace(LOCAL_FONT_URL_RE, (full, _q, urlPath) => {
    const dataUrl = dataUrls.get(urlPath);
    return dataUrl ? `url('${dataUrl}')` : full;
  });
}
