/**
 * Uploaded font variants: where their bytes live and the one URL they are
 * served at.
 *
 * A managed (uploaded) font variant is always a *private* media object
 * (`private/fonts/<file>`), never a public bucket, CDN or `/uploads/` file:
 * fonts are licensed, and a public object URL is an open download for anyone
 * who finds it. The app serves the file itself at `/fonts/managed/<file>`
 * (`server/routes/static/managed-fonts.js`) and the export embedder reads it
 * through the provider (`server/utils/embed-fonts.js`). The URL is derived from the
 * storage key, never stored beside it. The boundary this draws, and what it
 * does not promise, is in docs/reference/font-management.md § Private font
 * variants.
 */

import { PRIVATE_KEY_PREFIX, privateKey } from './interface.js';

export const MANAGED_FONT_FOLDER = 'fonts';
export const MANAGED_FONT_URL_PREFIX = '/fonts/managed/';

const KEY_PREFIX = `${PRIVATE_KEY_PREFIX}${MANAGED_FONT_FOLDER}/`;
// What the providers' filename sanitizer can produce, plus the font extension.
const FILE_RE = /^[\w\- ]+\.woff2?$/;

/**
 * The served URL of a stored variant, or null when the key is not a private
 * font object (a variant without a file, e.g. an Adobe-hosted one).
 * @param {string|null|undefined} key
 * @returns {string|null}
 */
export function managedFontUrl(key) {
  if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) return null;
  const file = key.slice(KEY_PREFIX.length);
  if (!FILE_RE.test(file)) return null;
  return `${MANAGED_FONT_URL_PREFIX}${encodeURIComponent(file)}`;
}

/**
 * The storage key behind a served file name, or null when the name is not one
 * this route could have handed out.
 * @param {string} file - the decoded path segment after the URL prefix
 * @returns {string|null}
 */
export function managedFontKey(file) {
  if (typeof file !== 'string' || !FILE_RE.test(file)) return null;
  return privateKey(MANAGED_FONT_FOLDER, file);
}

/**
 * The key behind a `/fonts/managed/…` URL, or null for any other URL.
 * @param {string} url
 * @returns {string|null}
 */
export function managedFontKeyFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(MANAGED_FONT_URL_PREFIX)) {
    return null;
  }
  let file;
  try {
    file = decodeURIComponent(url.slice(MANAGED_FONT_URL_PREFIX.length));
  } catch {
    return null;
  }
  return managedFontKey(file);
}
