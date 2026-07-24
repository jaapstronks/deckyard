import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { uploadsDir as uploadsBaseDir } from '../config/storage-paths.js';

function uploadsDir(repoRoot) {
  return uploadsBaseDir(repoRoot);
}

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

export async function saveUploadFromDataUrl(repoRoot, dataUrl, originalName) {
  const { mime, base64 } = parseDataUrl(dataUrl);
  const ext = MIME_TO_EXT[mime];
  if (!ext) {
    const err = new Error(`Unsupported image type: ${mime}`);
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

  // Optimize + downscale uploads to keep disk use predictable.
  // - no cropping
  // - no distortion
  // - never upscale
  // Note: best-effort; if the optimizer isn't available, we keep the original.
  if (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/webp'
  ) {
    buf = await optimizeRasterUpload(buf, mime);
  }

  const dir = uploadsDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });

  const safeBase =
    (typeof originalName === 'string' ? originalName : '')
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .slice(0, 40) || 'image';

  const filename = `${safeBase}-${crypto.randomUUID()}.${ext}`;
  const absolutePath = path.join(dir, filename);
  await fs.writeFile(absolutePath, buf);

  return {
    filename,
    url: `/uploads/${filename}`,
    mime,
    bytes: buf.length,
  };
}

/**
 * Save a buffer directly as an uploaded file.
 * Used for downloading external media (e.g., Unsplash, Giphy).
 * @param {string} repoRoot - Repository root path
 * @param {Buffer} buffer - File contents
 * @param {string} filename - Suggested filename (will be sanitized)
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} Local URL path
 */
export async function saveUploadedFile(repoRoot, buffer, filename, contentType) {
  const ext = MIME_TO_EXT[contentType];
  if (!ext) {
    const err = new Error(`Unsupported image type: ${contentType}`);
    err.statusCode = 400;
    throw err;
  }

  let buf = buffer;
  const maxBytes = 20 * 1024 * 1024; // 20MB for stock media (GIFs can be large)
  if (buf.length > maxBytes) {
    const err = new Error('Image too large (max 20MB)');
    err.statusCode = 400;
    throw err;
  }

  // Optimize raster images (but not GIFs to preserve animation)
  if (
    contentType === 'image/png' ||
    contentType === 'image/jpeg' ||
    contentType === 'image/jpg' ||
    contentType === 'image/webp'
  ) {
    buf = await optimizeRasterUpload(buf, contentType);
  }

  const dir = uploadsDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });

  const safeBase =
    (typeof filename === 'string' ? filename : '')
      .split('/')
      .pop()
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .slice(0, 40) || 'image';

  const finalFilename = `${safeBase}-${crypto.randomUUID()}.${ext}`;
  const absolutePath = path.join(dir, finalFilename);
  await fs.writeFile(absolutePath, buf);

  return `/uploads/${finalFilename}`;
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
    buf = await optimizeRasterUpload(buf, mime);
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

async function optimizeRasterUpload(buf, mime) {
  try {
    let img = sharp(buf);
    const meta = await img.metadata();
    const w = Number(meta?.width || 0) || 0;
    const h = Number(meta?.height || 0) || 0;
    const maxW = 3840;
    const maxH = 2160;

    if (w > maxW || h > maxH) {
      img = img.resize({
        width: maxW,
        height: maxH,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      img = img.jpeg({ quality: 82, mozjpeg: true });
    } else if (mime === 'image/webp') {
      img = img.webp({ quality: 80 });
    } else if (mime === 'image/png') {
      img = img.png({ compressionLevel: 9, adaptiveFiltering: true });
    }

    return await img.toBuffer();
  } catch {
    // If anything goes wrong, fall back to the original buffer.
    return buf;
  }
}

function parseDataUrl(dataUrl) {
  // data:<mime>;base64,<...>
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/);
  if (!m) {
    const err = new Error('Invalid data URL (expected data:<mime>;base64,...)');
    err.statusCode = 400;
    throw err;
  }
  return { mime: m[1], base64: m[2] };
}
