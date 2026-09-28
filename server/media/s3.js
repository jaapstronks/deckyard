/**
 * S3Provider — media storage on any S3-compatible object store (AWS S3, MinIO,
 * Wasabi, Backblaze B2, Scaleway Object Storage, …). Supports presigned URLs
 * for direct client uploads.
 *
 * Nothing here is vendor-specific: the endpoint, region, bucket and public base
 * URL all come from configuration (`server/media/config.js`).
 */

import crypto from 'node:crypto';
import { MediaProvider, privateKey } from './interface.js';
import { ValidationError } from '../utils/errors.js';
import { getS3Config } from './config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('media');

// AWS SDK v3 is loaded dynamically to make it an optional dependency
let s3Client = null;
let s3Commands = null;
let s3Presigner = null;

async function ensureS3() {
  if (s3Client) return;

  try {
    const [clientMod, presignerMod] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);

    s3Client = clientMod;
    s3Commands = clientMod;
    s3Presigner = presignerMod;
  } catch (err) {
    throw new Error(
      'AWS SDK not installed. Run: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner',
      { cause: err },
    );
  }
}

const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'font/woff2',
  'font/woff',
]);

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
};

const PRESIGNED_URL_EXPIRY = 3600; // 1 hour
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB for presigned uploads

export class S3Provider extends MediaProvider {
  constructor() {
    super();
    this.config = getS3Config();
    this._client = null;
    // The anonymous reachability probe in uploadPrivateBuffer; a seam so tests
    // can answer it without a bucket.
    this._fetch = (url, init) => globalThis.fetch(url, init);
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
      forcePathStyle: false, // virtual-hosted style, as _getPublicUrl assumes
    });

    return this._client;
  }

  getStatus() {
    return {
      name: 's3',
      configured: !!(
        this.config.accessKeyId &&
        this.config.secretAccessKey &&
        this.config.bucket
      ),
      supportsPresigned: true,
    };
  }

  async createPresignedUpload({ filename, contentType, size }) {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new ValidationError(`Unsupported content type: ${contentType}`);
    }

    if (size && size > MAX_FILE_SIZE) {
      throw new ValidationError('File too large (max 20MB)');
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
    const expiresAt = new Date(
      Date.now() + PRESIGNED_URL_EXPIRY * 1000,
    ).toISOString();

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

  async uploadBuffer({
    buffer,
    filename,
    contentType,
    maxBytes = MAX_FILE_SIZE,
  }) {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new ValidationError(`Unsupported content type: ${contentType}`);
    }

    // Enforce the byte ceiling the caller asked for, exactly as LocalProvider
    // does. This provider silently ignored it before, so a caller's maxBytes
    // bound (e.g. the Notion re-host) held only on local storage.
    if (buffer.length > maxBytes) {
      const mb = Math.round(maxBytes / (1024 * 1024));
      throw new ValidationError(`File too large (max ${mb}MB)`);
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
      }),
    );

    return {
      key,
      publicUrl: this._getPublicUrl(key),
      size: buffer.length,
      contentType,
    };
  }

  /**
   * Store a private object and prove it is private.
   *
   * No ACL is sent: an object without one is private on every S3-compatible
   * store, and buckets with ACLs disabled refuse the header. What makes an
   * object public here is the *bucket policy* (or a CDN in front of it), which
   * this code cannot see — so after the write it asks, anonymously, at every
   * public address the object could have. Any 2xx means the bucket serves
   * `private/` to the world: the object is deleted again and the upload is
   * refused with an error that names the fix, never kept "for now". A probe
   * that gets no answer at all (DNS, offline) proves nothing either way and
   * does not block the upload.
   */
  async uploadPrivateBuffer({ buffer, filename, contentType, folder }) {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new ValidationError(`Unsupported content type: ${contentType}`);
    }
    if (buffer.length > MAX_FILE_SIZE) {
      throw new ValidationError('File too large (max 20MB)');
    }

    const client = await this._getClient();
    const ext = MIME_TO_EXT[contentType] || 'bin';
    const key = privateKey(
      folder,
      `${this._sanitizeFilename(filename)}-${crypto.randomUUID()}.${ext}`,
    );

    await client.send(
      new s3Commands.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentLength: buffer.length,
      }),
    );

    const exposedAt = await this._publiclyReadableAt(key);
    if (exposedAt) {
      await this.deleteFile(key);
      const err = new Error(
        `The bucket serves private objects publicly (${exposedAt} answered an ` +
          'anonymous request). Limit the public-read bucket policy to ' +
          '`uploads/*` so `private/*` stays private, then upload again.',
      );
      err.code = 'PRIVATE_OBJECT_PUBLIC';
      throw err;
    }

    return { key, size: buffer.length, contentType };
  }

  async readFile(key) {
    const client = await this._getClient();
    try {
      const result = await client.send(
        new s3Commands.GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (err) {
      if (
        err.name === 'NoSuchKey' ||
        err.name === 'NotFound' ||
        err.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
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
        }),
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
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  ownsUrl(url) {
    if (!url || typeof url !== 'string') return false;

    const { bucket, endpoint, publicUrl } = this.config;
    if (publicUrl && url.startsWith(`${publicUrl}/`)) return true;
    if (!endpoint || !bucket) return false;

    // Both addressing styles for the configured endpoint: virtual-hosted
    // (https://<bucket>.<host>/) and path style (https://<host>/<bucket>/).
    let host;
    try {
      const u = new URL(endpoint);
      host = `${u.protocol}//${u.host}`;
    } catch {
      return false;
    }
    return (
      url.startsWith(`${host.replace('//', `//${bucket}.`)}/`) ||
      url.startsWith(`${host}/${bucket}/`)
    );
  }

  // Private helpers

  /**
   * The public addresses an object with this key could be reached at: the
   * configured public base (CDN or custom domain) and the bucket's own
   * virtual-hosted URL, when those differ.
   * @param {string} key
   * @returns {string[]}
   */
  _publicAddresses(key) {
    const urls = new Set([this._getPublicUrl(key)]);
    // No parsable endpoint: the public base is the only address.
    if (URL.canParse(this.config.endpoint)) {
      const u = new URL(this.config.endpoint);
      urls.add(`${u.protocol}//${this.config.bucket}.${u.host}/${key}`);
    }
    return [...urls];
  }

  /**
   * @param {string} key
   * @returns {Promise<string|null>} the first address that served the object
   *   to an anonymous request, or null when none did
   */
  async _publiclyReadableAt(key) {
    for (const url of this._publicAddresses(key)) {
      try {
        const resp = await this._fetch(url, {
          method: 'HEAD',
          redirect: 'manual',
        });
        if (resp.ok) return url;
      } catch (err) {
        // No answer is not a yes: note it and try the next address.
        log.warn(
          `Private-object probe got no answer from ${url}`,
          err?.message,
        );
      }
    }
    return null;
  }

  _getPublicUrl(key) {
    // `publicUrl` is either S3_PUBLIC_URL (a CDN or custom domain) or the
    // virtual-hosted base derived from the endpoint — in which case the bucket
    // must be publicly readable.
    return `${this.config.publicUrl}/${key}`;
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
      throw new ValidationError(
        'Invalid data URL (expected data:<mime>;base64,...)',
      );
    }
    return { mime: m[1], base64: m[2] };
  }
}
