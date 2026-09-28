import fs from 'node:fs/promises';
import path from 'node:path';
import { cssStringEscape, mergeFontFaces } from '../../shared/theme-fonts.js';
import { getMediaProvider } from '../media/index.js';
import { managedFontKeyFromUrl } from '../media/managed-fonts.js';
import { createLogger } from './logger.js';

const log = createLogger('embed-fonts');

function stripFontFaceBlocks(cssText) {
  return String(cssText || '').replace(/@font-face\s*\{[\s\S]*?\}\s*/g, '');
}

async function readFontAsDataUrl(repoRoot, relPath, mime = 'font/woff2') {
  const abs = path.join(repoRoot, relPath);
  const buf = await fs.readFile(abs);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Resolve one embedFonts entry to its bytes, as a base64 data URL.
 * @returns {Promise<string|null>} data URL, or null when the source is unusable
 */
async function resolveEmbedSource(repoRoot, { url, path: relPath, format }) {
  if (url) {
    // An uploaded font variant: a private object, read through the media
    // provider. It has no public URL, by design, and no other URL
    // form is embedded (D244). A missing object costs this one font, not the
    // export: the family's token already carries its fallback stack.
    const managedKey = managedFontKeyFromUrl(url);
    if (!managedKey) {
      log.warn(`Skipping font ${url}: not a managed font URL`);
      return null;
    }
    const buf = await getMediaProvider().readFile(managedKey);
    if (!buf) {
      log.warn(`Skipping font ${url}: stored object not found`);
      return null;
    }
    const mime = format === 'woff' ? 'font/woff' : 'font/woff2';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }
  if (relPath) {
    // A curated family: a pinned file in the repo.
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
  // `file://` still works (no network, no local-path requests).
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
    if (!dataUrl) continue; // unreadable — skip, the token keeps its fallback
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
