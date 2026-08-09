import fs from 'node:fs/promises';
import path from 'node:path';
import { serveJson } from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';

async function listAssetDir(repoRoot, subdir, allowedExts) {
  // Core assets ship with the OSS repo; forks add their own under
  // custom/assets/images/<subdir> (see docs/reference/fork-setup.md).
  const roots = [
    { dir: path.join(repoRoot, 'assets', 'images', subdir), prefix: `/assets/images/${subdir}` },
    { dir: path.join(repoRoot, 'custom', 'assets', 'images', subdir), prefix: `/custom/assets/images/${subdir}` },
  ];
  const allowed = new Set(allowedExts);
  const urls = [];
  for (const { dir, prefix } of roots) {
    let files = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      files = [];
    }
    urls.push(
      ...files
        .filter((f) => allowed.has(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => `${prefix}/${f}`)
    );
  }
  return urls;
}

// List partner logos stored in /assets/images/partnerlogos (for editor checkbox UI)
async function handlePartnerLogos({ repoRoot, res }) {
  const urls = await listAssetDir(repoRoot, 'partnerlogos', [
    '.svg',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',
  ]);
  serveJson(res, 200, { logos: urls });
  return true;
}

// List background images stored in /assets/images/backgrounds (for title slide presets)
async function handleBackgrounds({ repoRoot, res }) {
  const urls = await listAssetDir(repoRoot, 'backgrounds', [
    '.svg',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',
    '.avif',
  ]);
  serveJson(res, 200, { backgrounds: urls });
  return true;
}

/**
 * Declarative route table for `/api/assets/*` (A7.19 C8). Both routes are
 * GET-only; a method mismatch falls through (the original chain had no 405).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/assets/partnerlogos', handler: handlePartnerLogos },
  { method: 'GET', pattern: '/api/assets/backgrounds', handler: handleBackgrounds },
];

/**
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleAssets(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
