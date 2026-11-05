import fs from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from '../errors.js';
import { resolveServedAssetPath } from '../served-asset-path.js';

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

export async function resolveImageUrlForVisionInput(repoRoot, url) {
  const u = String(url || '').trim();
  if (!u) return { type: 'none', url: '' };

  // If it's already a public URL, pass it through (OpenAI can fetch it).
  if (u.startsWith('https://') || u.startsWith('http://'))
    return { type: 'remote', url: u };

  // The URL comes from a request body and its bytes go to the vendor, so a
  // local path reads only what this installation serves as an asset. Everything
  // else is refused before any file is touched.
  const served = u.startsWith('/') ? resolveServedAssetPath(repoRoot, u) : null;
  if (u.startsWith('/') && !served) {
    throw new ValidationError('Image path is not a served asset.');
  }

  // For local app URLs, embed as a data URL so the model can see the image.
  // This works for local dev and for private deployments.
  const mime = guessMimeFromUrl(u);
  if (!mime) {
    // For unsupported types (e.g. SVG), fall back to text-only prompting.
    return { type: 'unsupported', url: u };
  }

  if (!served) return { type: 'unknown', url: u };

  const buf = await fs.readFile(served.path);
  const maxBytes = 4 * 1024 * 1024;
  if (buf.length > maxBytes) {
    throw new ValidationError('Image too large for AI analysis (max 4MB).');
  }

  const b64 = buf.toString('base64');
  return { type: 'data', url: `data:${mime};base64,${b64}` };
}
