import path from 'node:path';
import { serveFile } from '../../utils/http.js';
import { renderSandboxOgImagePng } from '../../utils/sandbox-og-image.js';

/**
 * Sandbox OG image (generated server-side, no binary assets committed).
 * Falls back to the generic preview image on render failure.
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>} true if handled.
 */
export async function handleSandboxOg({ repoRoot, req, res, url }) {
  if (url.pathname !== '/og/sandbox.png' || req.method !== 'GET') return false;

  try {
    const buf = await renderSandboxOgImagePng();
    res.writeHead(200, {
      'Content-Type': 'image/png',
      // Cache for a day; safe because the image is not user-specific.
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(buf);
    return true;
  } catch (e) {
    // Fall back to the existing generic preview image.
    const fsPath = path.join(repoRoot, 'assets', 'images', 'slides-previewimage.png');
    serveFile(res, fsPath);
    return true;
  }
}
