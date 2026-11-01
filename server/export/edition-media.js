/** Public S3 uploads an edition may copy, never arbitrary URLs or private keys. */
import { getS3Config } from '../media/config.js';
import {
  getMediaProvider,
  isMediaProviderInitialized,
} from '../media/index.js';
import { getSlideType } from '../../shared/slide-types/registry.js';

/** The installation's active S3 provider, or null for local/uninitialized media. */
export function editionMediaProvider() {
  if (!isMediaProviderInitialized()) return null;
  const provider = getMediaProvider();
  return provider.getStatus().name === 's3' ? provider : null;
}

/**
 * Resolve only public uploads of the configured bucket/CDN to storage keys.
 * No network request is made to the supplied URL. The provider reads the key
 * from its configured bucket, even when its public URL points at a CDN.
 * Root-relative /uploads/ refs use that same provider on S3 installations.
 * @param {string} ref
 * @param {string} [publicBase] - Operator-configured S3 public URL
 * @returns {string|null}
 */
export function editionUploadKey(ref, publicBase = getS3Config().publicUrl) {
  if (typeof ref !== 'string' || /[\\\s?#]/.test(ref)) return null;
  let rawPath = ref;
  if (!ref.startsWith('/uploads/')) {
    try {
      const url = new URL(ref);
      const base = new URL(publicBase);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        url.origin !== base.origin ||
        url.username ||
        url.password ||
        base.username ||
        base.password ||
        base.search ||
        base.hash
      )
        return null;
      const prefix = base.pathname.replace(/\/$/, '') + '/';
      // Check the raw path too: URL normalizes literal and encoded dot segments.
      rawPath = ref.slice(ref.indexOf('://') + 3);
      rawPath = rawPath.slice(rawPath.indexOf('/'));
      if (!url.pathname.startsWith(prefix) || !rawPath.startsWith(prefix))
        return null;
      rawPath = '/' + rawPath.slice(prefix.length);
    } catch {
      return null;
    }
  }
  let key;
  try {
    key = decodeURIComponent(rawPath.slice(1));
  } catch {
    return null;
  }
  // One decoding only; refuse encoded separators, double encodings, controls,
  // traversal and empty segments. private/fonts can never reach readFile().
  if (!key.startsWith('uploads/') || /[%\\\x00-\x1f\x7f]/.test(key))
    return null;
  if (/%(?:2f|5c)/i.test(rawPath)) return null;
  if (key.split('/').some((part) => !part || part === '.' || part === '..'))
    return null;
  return key;
}

/**
 * Map declared image fields, including nested items and global background/logo
 * fields. A remote URL in prose, alt text or a hyperlink is never an image ref.
 * The caller owns this already-cloned slide.
 * @param {object} slide
 * @param {(ref: string) => string|null} mapFn
 */
export function mapEditionImageRefs(slide, mapFn) {
  function visit(content, fields) {
    if (!content || typeof content !== 'object') return;
    for (const field of fields) {
      const value = content[field.key];
      if (field.type === 'image' && typeof value === 'string') {
        content[field.key] = mapFn(value) || value;
      } else if (field.type === 'items' && Array.isArray(value)) {
        for (const item of value) visit(item, field.itemFields || []);
      }
    }
  }
  visit(slide.content, getSlideType(slide.type)?.fields || []);
}
