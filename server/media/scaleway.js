/**
 * ScalewayProvider - Media storage using Scaleway Object Storage (S3-compatible).
 * Supports presigned URLs for direct client uploads.
 */

import crypto from 'node:crypto';
import { MediaProvider } from './interface.js';
import { getScalewayConfig } from './config.js';

// AWS SDK v3 is loaded dynamically to make it an optional dependency
let s3Client = null;
let s3Commands = null;
let s3Presigner = null;

async function ensureS3() {
  if (s3Client) return;

  try {
    const [clientMod, commandsMod, presignerMod] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);

    s3Client = clientMod;
    s3Commands = commandsMod;
    s3Presigner = presignerMod;
  } catch (err) {
    throw new Error(
      'AWS SDK not installed. Run: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner'
    );
  }
}

const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'font/woff2',
  'font/woff',
]);

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

const PRESIGNED_URL_EXPIRY = 3600; // 1 hour
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB for presigned uploads

export class ScalewayProvider extends MediaProvider {
  constructor() {
    super();
    this.config = getScalewayConfig();
    this._client = null;
  }

  async _getClient() {
    if (this._client) return this._client;

    await ensureS3();

    this._client = new s3Client.S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: false, // Scaleway uses virtual-hosted style
    });

    return this._client;
  }

  getStatus() {
    return {
      name: 'scaleway',
      configured: !!(this.config.accessKeyId && this.config.secretAccessKey && this.config.bucket),
      supportsPresigned: true,
    };
  }

  async createPresignedUpload({ filename, contentType, size }) {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      const err = new Error(`Unsupported content type: ${contentType}`);
      err.statusCode = 400;
      throw err;
    }

    if (size && size > MAX_FILE_SIZE) {
      const err = new Error('File too large (max 20MB)');
      err.statusCode = 400;
      throw err;
    }

    const client = await this._getClient();
    const ext = MIME_TO_EXT[contentType] || 'bin';
    const safeBase = this._sanitizeFilename(filename);
    const key = `uploads/${this._datePrefix()}/${safeBase}-${crypto.randomUUID()}.${ext}`;

    const command = new s3Commands.PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: contentType,
      ...(size ? { ContentLength: size } : {}),
    });

    const uploadUrl = await s3Presigner.getSignedUrl(client, command, {
      expiresIn: PRESIGNED_URL_EXPIRY,
    });

    const publicUrl = this._getPublicUrl(key);
    const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRY * 1000).toISOString();

    return {
      uploadUrl,
      key,
      publicUrl,
      headers: {
        'Content-Type': contentType,
      },
      expiresAt,
    };
  }

  async uploadBuffer({ buffer, filename, contentType }) {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      const err = new Error(`Unsupported content type: ${contentType}`);
      err.statusCode = 400;
      throw err;
    }

    const client = await this._getClient();
    const ext = MIME_TO_EXT[contentType] || 'bin';
    const safeBase = this._sanitizeFilename(filename);
    const key = `uploads/${this._datePrefix()}/${safeBase}-${crypto.randomUUID()}.${ext}`;

    await client.send(
      new s3Commands.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentLength: buffer.length,
      })
    );

    return {
      key,
      publicUrl: this._getPublicUrl(key),
      size: buffer.length,
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
    const client = await this._getClient();

    try {
      const result = await client.send(
        new s3Commands.HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        })
      );

      return {
        exists: true,
        publicUrl: this._getPublicUrl(key),
        size: result.ContentLength,
      };
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return { exists: false, publicUrl: '' };
      }
      throw err;
    }
  }

  async deleteFile(key) {
    const client = await this._getClient();

    try {
      await client.send(
        new s3Commands.DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  ownsUrl(url) {
    if (!url || typeof url !== 'string') return false;

    // Check CDN URL
    if (this.config.cdnUrl && url.startsWith(this.config.cdnUrl)) {
      return true;
    }

    // Check direct Scaleway URL
    const bucket = this.config.bucket;
    const region = this.config.region;
    const patterns = [
      `https://${bucket}.s3.${region}.scw.cloud/`,
      `https://s3.${region}.scw.cloud/${bucket}/`,
    ];

    return patterns.some((p) => url.startsWith(p));
  }

  // Private helpers

  _getPublicUrl(key) {
    // Prefer CDN URL if configured
    if (this.config.cdnUrl) {
      const cdnBase = this.config.cdnUrl.replace(/\/$/, '');
      return `${cdnBase}/${key}`;
    }

    // Fall back to direct Scaleway URL (bucket must be public)
    return `https://${this.config.bucket}.s3.${this.config.region}.scw.cloud/${key}`;
  }

  _datePrefix() {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}/${m}`;
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
}