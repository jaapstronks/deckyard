/**
 * LocalProvider - Media storage using local filesystem.
 * Wraps existing /uploads functionality with MediaProvider interface.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { MediaProvider } from './interface.js';
import { uploadsDir } from '../config/storage-paths.js';

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export class LocalProvider extends MediaProvider {
  constructor(repoRoot) {
    super();
    this.repoRoot = repoRoot;
    this.uploadsDir = uploadsDir(repoRoot);
    this.urlPrefix = '/uploads';
  }

  getStatus() {
    return {
      name: 'local',
      configured: true, // Always available
      supportsPresigned: false, // Local doesn't support presigned uploads
    };
  }

  async createPresignedUpload(_opts) {
    // Local provider doesn't support presigned uploads
    throw new Error('LocalProvider does not support presigned uploads');
  }

  async uploadBuffer({ buffer, filename, contentType }) {
    const ext = MIME_TO_EXT[contentType];
    if (!ext) {
      const err = new Error(`Unsupported content type: ${contentType}`);
      err.statusCode = 400;
      throw err;
    }

    if (buffer.length > MAX_FILE_SIZE) {
      const err = new Error('File too large (max 10MB)');
      err.statusCode = 400;
      throw err;
    }

    // Optimize raster images
    let finalBuffer = buffer;
    if (['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(contentType)) {
      finalBuffer = await this._optimizeImage(buffer, contentType);
    }

    await fs.mkdir(this.uploadsDir, { recursive: true });

    const safeBase = this._sanitizeFilename(filename);
    const key = `${safeBase}-${crypto.randomUUID()}.${ext}`;
    const absolutePath = path.join(this.uploadsDir, key);

    await fs.writeFile(absolutePath, finalBuffer);

    return {
      key,
      publicUrl: `${this.urlPrefix}/${key}`,
      size: finalBuffer.length,
      contentType,
    };
  }

  async uploadDataUrl({ dataUrl, filename }) {
    const { mime, base64 } = this._parseDataUrl(dataUrl);
    const buffer = Buffer.from(base64, 'base64');
    return this.uploadBuffer({
      buffer,
      filename: filename || 'image',
      contentType: mime,
    });
  }

  async confirmUpload(key) {
    // Resolve + confine the key under uploadsDir so a traversal key like
    // '../auth/auth.js' can't be used as an existence/size oracle for
    // arbitrary files. See docs/plans/security-hardening.md item 5b.
    const absolutePath = this._resolveKeyPath(key);
    if (!absolutePath) return { exists: false, publicUrl: '' };
    try {
      const stat = await fs.stat(absolutePath);
      return {
        exists: true,
        publicUrl: `${this.urlPrefix}/${key}`,
        size: stat.size,
      };
    } catch {
      return { exists: false, publicUrl: '' };
    }
  }

  async deleteFile(key) {
    const absolutePath = this._resolveKeyPath(key);
    if (!absolutePath) return false;
    try {
      await fs.unlink(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  ownsUrl(url) {
    return typeof url === 'string' && url.startsWith(this.urlPrefix + '/');
  }

  // Private helpers

  /**
   * Resolve a storage key to an absolute path, confined to uploadsDir.
   * Rejects traversal / absolute / NUL-byte keys by returning null, so callers
   * can never fs.stat / fs.unlink a path outside the uploads directory.
   * @param {string} key
   * @returns {string|null} absolute path under uploadsDir, or null if invalid
   */
  _resolveKeyPath(key) {
    if (typeof key !== 'string' || key === '' || key.includes('\0')) {
      return null;
    }
    const base = path.resolve(this.uploadsDir);
    const abs = path.resolve(base, key);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      return null;
    }
    // A key that resolves to the uploads dir itself is not a file.
    if (abs === base) return null;
    return abs;
  }

  _sanitizeFilename(filename) {
    const s = typeof filename === 'string' ? filename : '';
    return (
      s
        .split('/')
        .pop()
        .replace(/\.[^.]+$/, '')
        .replace(/[^\w\- ]+/g, '')
        .trim()
        .slice(0, 40) || 'image'
    );
  }

  _parseDataUrl(dataUrl) {
    const m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/);
    if (!m) {
      const err = new Error('Invalid data URL (expected data:<mime>;base64,...)');
      err.statusCode = 400;
      throw err;
    }
    return { mime: m[1], base64: m[2] };
  }

  async _optimizeImage(buffer, mime) {
    // Optional dependency: skip if sharp isn't installed
    let sharp = null;
    try {
      const mod = await import('sharp');
      sharp = mod?.default || mod;
    } catch {
      return buffer;
    }

    try {
      let img = sharp(buffer);
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
      return buffer;
    }
  }
}