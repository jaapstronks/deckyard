import fs from 'node:fs/promises';
import path from 'node:path';
import { uploadsDir } from '../config/storage-paths.js';

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
async function fetchFontAsDataUrl(url, format = 'woff2') {
  const mime = format === 'woff' ? 'font/woff' : 'font/woff2';

  // Validate URL protocol and block internal addresses
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith('http')) throw new Error('Font URL must use HTTP(S)');
    const hostname = parsed.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
      throw new Error('Font URL must not point to internal addresses');
    }
  } catch (e) {
    if (e.message.includes('Font URL')) throw e;
    throw new Error('Invalid font URL');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
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

export async function buildEmbeddedFontCss(repoRoot, theme = null) {
  // These will be inlined into export HTML so opening the exported file via
  // `file://` still works (no network, no local-path fetches).
  // Themes declare which fonts to embed via embedFonts (theme-builder
  // generates this for managed fonts). Without it there's nothing to embed —
  // the export falls back to the CSS font stacks.
  const list = Array.isArray(theme?.embedFonts) ? theme.embedFonts : [];

  const blocks = [];
  for (const f of list) {
    const family = String(f?.family || '').trim();
    if (!family) continue;

    const weight = Number(f?.weight || 400) || 400;
    const style = String(f?.style || 'normal');
    const format = String(f?.format || 'woff2');

    let dataUrl;

    if (f.url && f.url.startsWith('/uploads/')) {
      // Locally-stored uploaded font — read directly from the uploads directory
      try {
        dataUrl = await readLocalUploadAsDataUrl(repoRoot, f.url, format);
      } catch {
        continue; // Skip if file not found
      }
    } else if (f.url) {
      // URL-based font (external CDN / media provider) — fetch and base64-encode
      dataUrl = await fetchFontAsDataUrl(f.url, format);
      if (!dataUrl) continue; // Skip if fetch fails
    } else if (f.path) {
      // Path-based font (local curated file)
      try {
        dataUrl = await readFontAsDataUrl(repoRoot, String(f.path).trim());
      } catch {
        continue; // Skip if file not found (e.g. postinstall download skipped)
      }
    } else {
      continue;
    }

    blocks.push(`
@font-face {
  font-family: '${family.replace(/'/g, "\\'")}';
  src: url('${dataUrl}') format('${format}');
  font-weight: ${weight};
  font-style: ${style};
  font-display: swap;
}`.trim());
  }
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
 * Only URLs that actually appear in the CSS are embedded — in practice a
 * couple of small woff2 files (a few KB each, e.g. the shared Bricolage
 * Grotesque UI weight), never the whole managed font library (~2.5 MB across
 * all themes). Files that resolve outside the repo, or can't be read, are left
 * untouched.
 *
 * Theme fonts are embedded separately via {@link buildEmbeddedFontCss}; this
 * covers shared/UI @font-face rules (`client/styles/shared/fonts.css`) that no
 * theme's `embedFonts` list owns.
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
