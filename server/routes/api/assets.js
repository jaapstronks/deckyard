import fs from 'node:fs/promises';
import path from 'node:path';
import { serveJson } from '../../utils/http.js';

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

export async function handleAssets({ repoRoot, req, res, url }) {
  // List partner logos stored in /assets/images/partnerlogos (for editor checkbox UI)
  if (url.pathname === '/api/assets/partnerlogos' && req.method === 'GET') {
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
  if (url.pathname === '/api/assets/backgrounds' && req.method === 'GET') {
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

  return false;
}
