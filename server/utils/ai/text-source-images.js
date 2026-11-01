/**
 * Image URLs in pasted source text, offered as source images (DY-791).
 *
 * The file and Notion imports hand the pipeline their pictures as candidates;
 * this does the same for text. A URL in the source becomes a marked candidate
 * and leaves the text, so the model chooses an image by number and a chosen
 * image is copied before the deck is stored. Nothing is fetched here.
 *
 * Copying makes the server fetch and store what a caller named, so a caller is
 * offered candidates only when it may upload and the installation accepts
 * uploads. Otherwise the text stays as it is: no candidates, nothing fetched.
 */

import { getFeatureFlags } from '../../config/flags-snapshot.js';
import { isMediaProviderInitialized } from '../../media/index.js';
import { rehostRemoteImage } from '../../media/rehost.js';
import { cryptoUuid } from '../../../shared/slide-types/helpers.js';
import { sourceImageMarker, uploadOnce } from './source-images.js';

/** Candidates per deck. A URL past this stays in the text as a plain URL. */
export const MAX_TEXT_SOURCE_IMAGES = 20;

const MAX_CAPTION_LENGTH = 200;

/** A markdown image, an `<img>` tag, or a bare URL. Bounded, so linear. */
const IMAGE_REFERENCE =
  /!\[([^\]\n]{0,500})\]\(\s{0,10}<?(https?:\/\/[^\s)>]{1,2048})>?(?:\s{1,10}"[^"\n]{0,500}")?\s{0,10}\)|<img\b[^>]{0,2048}>|https?:\/\/[^\s<>"'`)\]]{1,2048}/gi;
const IMG_SRC = /\bsrc\s{0,10}=\s{0,10}["'](https?:\/\/[^"'\s]{1,2048})["']/i;
const IMG_ALT = /\balt\s{0,10}=\s{0,10}["']([^"']{0,500})["']/i;
/** A bare URL names an image only by its path; any other link stays a link. */
const IMAGE_PATH = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function isImageUrl(url) {
  try {
    return IMAGE_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function cleanCaption(caption) {
  return String(caption || '')
    .replace(/[[\]\r\n]+/g, ' ')
    .trim()
    .slice(0, MAX_CAPTION_LENGTH);
}

/**
 * Read one match of {@link IMAGE_REFERENCE}.
 * @returns {{ url: string, caption: string, suffix: string }|null} null for a
 *   match that names no image
 */
function readReference(match, markdownAlt, markdownUrl) {
  if (markdownUrl) {
    return { url: markdownUrl, caption: markdownAlt, suffix: '' };
  }
  if (/^<img\b/i.test(match)) {
    const url = IMG_SRC.exec(match)?.[1];
    return url
      ? { url, caption: IMG_ALT.exec(match)?.[1] || '', suffix: '' }
      : null;
  }
  const suffix = TRAILING_PUNCTUATION.exec(match)?.[0] || '';
  const url = suffix ? match.slice(0, -suffix.length) : match;
  return isImageUrl(url) ? { url, caption: '', suffix } : null;
}

/**
 * Turn the image URLs in a source text into source-image candidates.
 *
 * @param {string} raw - the source text
 * @param {object} options
 * @param {boolean} options.mayUpload - the caller's right to have the server
 *   fetch and store an image; each route answers this for its own caller
 * @returns {{ text: string, sourceImages: import('./source-images.js').SourceImage[] }}
 *   the text with a marker where each candidate stood, and the candidates
 */
export function offerTextSourceImages(raw, { mayUpload }) {
  const text = String(raw ?? '');
  if (
    mayUpload !== true ||
    !getFeatureFlags().enableUploads ||
    !isMediaProviderInitialized()
  ) {
    return { text, sourceImages: [] };
  }

  const byUrl = new Map();
  const marked = text.replace(
    IMAGE_REFERENCE,
    (match, markdownAlt, markdownUrl) => {
      const reference = readReference(match, markdownAlt, markdownUrl);
      if (!reference) return match;
      const { url, caption, suffix } = reference;
      let image = byUrl.get(url);
      if (!image) {
        if (byUrl.size >= MAX_TEXT_SOURCE_IMAGES) return match;
        image = {
          n: byUrl.size + 1,
          caption: cleanCaption(caption),
          upload: uploadOnce(async () => {
            const { publicUrl } = await rehostRemoteImage({
              url,
              filename: `ai-source-${cryptoUuid()}`,
            });
            return publicUrl || '';
          }),
        };
        byUrl.set(url, image);
      }
      return `${sourceImageMarker(image)}${suffix}`;
    },
  );
  return { text: marked, sourceImages: [...byUrl.values()] };
}
