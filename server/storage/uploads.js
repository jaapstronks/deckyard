import fs from 'node:fs/promises';
import path from 'node:path';
import { uploadsDir as uploadsBaseDir } from '../config/storage-paths.js';
import {
  LocalProvider,
  parseDataUrl,
  optimizeRasterImage,
} from '../media/local.js';

function uploadsDir(repoRoot) {
  return uploadsBaseDir(repoRoot);
}

// Image types accepted by these disk-upload helpers. This is a policy allowlist
// (image-only — fonts and other provider-supported types are intentionally
// rejected here), kept separate from the LocalProvider's wider MIME table.
const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const EXT_TO_MIMES = {
  png: ['image/png'],
  jpg: ['image/jpeg', 'image/jpg'],
  jpeg: ['image/jpeg', 'image/jpg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  svg: ['image/svg+xml'],
};

const STOCK_MAX_BYTES = 20 * 1024 * 1024; // 20MB for stock media (GIFs can be large)

/**
 * Save a buffer directly as an uploaded file.
 * Used for downloading external media (e.g., Unsplash, Giphy) and re-hydrating
 * deck-bundle assets. Routes the write through the LocalProvider so the actual
 * byte handling (sharp optimization, filename sanitization, UUID keying) has a
 * single implementation shared with the rest of the media pipeline. Stays on
 * local disk by design — object storage is a separate track — hence the explicit
 * LocalProvider rather than the configured media provider.
 * @param {string} repoRoot - Repository root path
 * @param {Buffer} buffer - File contents
 * @param {string} filename - Suggested filename (will be sanitized)
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} Local URL path
 */
export async function writeUploadedFile(repoRoot, buffer, filename, contentType) {
  if (!MIME_TO_EXT[contentType]) {
    const err = new Error(`Unsupported image type: ${contentType}`);
    err.statusCode = 400;
    throw err;
  }

  if (buffer.length > STOCK_MAX_BYTES) {
    const err = new Error('Image too large (max 20MB)');
    err.statusCode = 400;
    throw err;
  }

  const provider = new LocalProvider(repoRoot);
  const { publicUrl } = await provider.uploadBuffer({
    buffer,
    filename,
    contentType,
    maxBytes: STOCK_MAX_BYTES,
  });
  return publicUrl;
}

export async function replaceUploadFromDataUrl(repoRoot, targetUrl, dataUrl) {
  const url = String(targetUrl || '').trim();
  if (!url.startsWith('/uploads/')) {
    const err = new Error('replace target must be a local /uploads/ URL');
    err.statusCode = 400;
    throw err;
  }
  const filename = url.slice('/uploads/'.length);
  if (
    !filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('..')
  ) {
    const err = new Error('Invalid upload filename');
    err.statusCode = 400;
    throw err;
  }

  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  const allowedMimes = EXT_TO_MIMES[ext] || null;
  if (!allowedMimes) {
    const err = new Error(`Unsupported upload extension: ${ext || '(none)'}`);
    err.statusCode = 400;
    throw err;
  }

  const { mime, base64 } = parseDataUrl(dataUrl);
  if (!allowedMimes.includes(mime)) {
    const err = new Error(
      `Replacement type mismatch: ${mime} does not match .${ext}`
    );
    err.statusCode = 400;
    throw err;
  }

  let buf = Buffer.from(base64, 'base64');
  const maxBytes = 10 * 1024 * 1024;
  if (buf.length > maxBytes) {
    const err = new Error('Image too large (max 10MB)');
    err.statusCode = 400;
    throw err;
  }

  if (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/webp'
  ) {
    buf = await optimizeRasterImage(buf, mime);
  }

  const dir = uploadsDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, filename);

  try {
    await fs.stat(absolutePath);
  } catch {
    const err = new Error('Target upload does not exist');
    err.statusCode = 404;
    throw err;
  }

  await fs.writeFile(absolutePath, buf);
  return {
    filename,
    url,
    mime,
    bytes: buf.length,
  };
}
