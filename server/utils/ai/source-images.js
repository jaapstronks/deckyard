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
 * Replace `source-image:N` in declared image fields by the uploaded URL.
 *
 * Only the images a slide references are uploaded, each once. A reference
 * to an image the source does not have, or one whose upload fails, leaves
 * the field empty and says so in the slide's `_aiWarnings`. Mutates the
 * slides.
 *
 * @param {Array<{ type?: string, content?: object, _aiWarnings?: string[] }>} slides
 * @param {SourceImage[]} [sourceImages]
 * @param {object} [opts]
 * @param {AbortSignal|null} [opts.signal] - checked before every upload
 * @param {Record<string, object>} opts.slideTypes - the merged slide-type map
 * @returns {Promise<{ used: number[] }>} the numbers of the images placed
 */
export async function resolveSourceImages(
  slides,
  sourceImages = [],
  { signal = null, slideTypes } = {},
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

  async function resolveFields(content, fields, warnings) {
    for (const field of fields) {
      const value = content[field.key];
      if (field.type === 'image' && typeof value === 'string') {
        if (SOURCE_IMAGE_REF.test(value)) {
          content[field.key] = await resolve(value, warnings);
        }
      } else if (field.type === 'items' && Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object') {
            await resolveFields(item, field.itemFields || [], warnings);
          }
        }
      }
    }
  }

  for (const slide of slides) {
    if (!slide?.content || typeof slide.content !== 'object') continue;
    const fields = slideTypes[slide.type]?.fields || [];
    const warnings = [];
    await resolveFields(slide.content, fields, warnings);
    if (warnings.length) {
      slide._aiWarnings = [...(slide._aiWarnings || []), ...warnings];
    }
  }
  return { used: [...used].sort((a, b) => a - b) };
}
