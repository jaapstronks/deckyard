import fs from 'node:fs/promises';
import path from 'node:path';
import { uploadsDir } from '../../config/storage-paths.js';

const EXT_TO_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function extForUrl(url) {
  const u = String(url || '').trim();
  const clean = u.split('?')[0].split('#')[0];
  const ext = path.extname(clean).toLowerCase();
  return ext || '';
}

function guessMimeFromUrl(url) {
  const ext = extForUrl(url);
  return EXT_TO_MIME[ext] || null;
}

function uploadsPath(repoRoot, url) {
  const filename = String(url).slice('/uploads/'.length);
  return path.join(uploadsDir(repoRoot), filename);
}

function assetsPath(repoRoot, url) {
  const rel = String(url).slice('/assets/'.length);
  return path.join(repoRoot, 'assets', rel);
}

export async function resolveImageUrlForVisionInput(repoRoot, url) {
  const u = String(url || '').trim();
  if (!u) return { type: 'none', url: '' };

  // If it's already a public URL, pass it through (OpenAI can fetch it).
  if (u.startsWith('https://') || u.startsWith('http://'))
    return { type: 'remote', url: u };

  // For local app URLs, embed as a data URL so the model can see the image.
  // This works for local dev and for private deployments.
  const mime = guessMimeFromUrl(u);
  if (!mime) {
    // For unsupported types (e.g. SVG), fall back to text-only prompting.
    return { type: 'unsupported', url: u };
  }

  let abs = null;
  if (u.startsWith('/uploads/')) abs = uploadsPath(repoRoot, u);
  else if (u.startsWith('/assets/')) abs = assetsPath(repoRoot, u);
  else return { type: 'unknown', url: u };

  const buf = await fs.readFile(abs);
  const maxBytes = 4 * 1024 * 1024;
  if (buf.length > maxBytes) {
    const err = new Error('Image too large for AI analysis (max 4MB).');
    err.statusCode = 400;
    throw err;
  }

  const b64 = buf.toString('base64');
  return { type: 'data', url: `data:${mime};base64,${b64}` };
}
