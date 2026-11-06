/**
 * Images from a source document, offered to the model as candidates (B775).
 *
 * A file or Notion page brings its own pictures. The model gets them as a
 * numbered list in the source text, each marked where it stands
 * (`[IMAGE 3: caption, page 2, 1200×800]`); the outline ties an image to a
 * slide, and phase 2 puts `source-image:3` in that slide's image field.
 * Nothing is uploaded before the model chose: {@link resolveSourceImages}
 * turns each reference into an upload once the slides are written, so a
 * picture no slide shows never reaches the media library.
 *
 * The service knows no source: each candidate carries its own `upload()`,
 * written by the adapter that read it (a PDF's pixels, a Word document's
 * embedded file, a Notion URL to re-host).
 */

import { dropForeignMedia, mediaFields } from './model-media.js';

/**
 * @typedef {object} SourceImage
 * @property {number} n - the number the source text marks it with (1-based)
 * @property {string} [caption] - alt text or caption, as the source gives it
 * @property {number} [page] - the page it stands on, for a paged source
 * @property {{ width: number, height: number }} [pixels]
 * @property {() => Promise<string>} upload - stores the image, resolves to
 *   its URL; called at most once per image by {@link resolveSourceImages}
 */

/** What phase 2 writes in an image field to use a source image. */
const SOURCE_IMAGE_REF = /^\s*source-image:(\d+)\s*$/;

/**
 * The description of an image as the model reads it: caption, page, size.
 * @param {Omit<SourceImage, 'upload'>} img
 * @returns {string}
 */
export function describeSourceImage({ caption, page, pixels }) {
  return [
    String(caption || '').trim() || 'no caption',
    page ? `page ${page}` : '',
    pixels?.width && pixels?.height ? `${pixels.width}×${pixels.height}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * The marker an image leaves in the source text, where it stands.
 * @param {Omit<SourceImage, 'upload'>} img
 * @returns {string}
 */
export function sourceImageMarker(img) {
  return `[IMAGE ${img.n}: ${describeSourceImage(img)}]`;
}

/**
 * Wrap an upload so it runs once, however many slides use the image.
 * @param {() => Promise<string>} upload
 * @returns {() => Promise<string>}
 */
export function uploadOnce(upload) {
  let pending = null;
  return () => (pending ||= upload());
}

/**
 * Replace `source-image:N` in declared image fields by the uploaded URL, then
 * hold the answer to the rule for every media field ({@link dropForeignMedia}).
 *
 * Only the images a slide references are uploaded, each once. A reference
 * to an image the source does not have, or one whose upload fails, leaves
 * the field empty and says so in the slide's `_aiWarnings`. So does a remote
 * URL the model wrote itself, and an embed or video it named: what comes out
 * of here loads nothing that was not copied or already there. Mutates the
 * slides.
 *
 * @param {Array<{ type?: string, content?: object, _aiWarnings?: string[] }>} slides
 * @param {SourceImage[]} [sourceImages]
 * @param {object} [opts]
 * @param {AbortSignal|null} [opts.signal] - checked before every upload
 * @param {Record<string, object>} opts.slideTypes - the merged slide-type map
 * @param {{ media: Set<string>, fields: Set<string> }} [opts.keep] - what
 *   stays, from `heldInSlides`
 * @returns {Promise<{ used: number[], unusable: Set<object> }>} the numbers
 *   of the images placed, and the slides the caller leaves out (`leaveOut`)
 */
export async function resolveSourceImages(
  slides,
  sourceImages = [],
  { signal = null, slideTypes, keep } = {},
) {
  if (!slideTypes || typeof slideTypes !== 'object') {
    throw new TypeError('resolveSourceImages: pass the slide-type map');
  }
  const byNumber = new Map(sourceImages.map((img) => [img.n, img]));
  const used = new Set();

  async function resolve(value, warnings) {
    const n = Number(SOURCE_IMAGE_REF.exec(value)[1]);
    const img = byNumber.get(n);
    if (!img) {
      warnings.push(
        `The model chose source image ${n}, which the source does not have; the image field was left empty.`,
      );
      return '';
    }
    signal?.throwIfAborted();
    try {
      const url = await img.upload();
      signal?.throwIfAborted();
      if (url) {
        used.add(n);
        return url;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    warnings.push(
      `Source image ${n} could not be uploaded; the image field was left empty.`,
    );
    return '';
  }

  for (const slide of slides) {
    if (!slide?.content || typeof slide.content !== 'object') continue;
    const fields = slideTypes[slide.type]?.fields || [];
    const warnings = [];
    for (const { holder, key, value, field } of mediaFields(
      slide.content,
      fields,
    )) {
      if (field.type === 'image' && SOURCE_IMAGE_REF.test(value)) {
        holder[key] = await resolve(value, warnings);
      }
    }
    if (warnings.length) {
      slide._aiWarnings = [...(slide._aiWarnings || []), ...warnings];
    }
  }
  const unusable = dropForeignMedia(slides, { slideTypes, keep });
  return { used: [...used].sort((a, b) => a - b), unusable };
}
