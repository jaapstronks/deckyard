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
 * Replace every `source-image:N` in the slides' content by the uploaded URL.
 *
 * Only the images a slide references are uploaded, each once. A reference
 * to an image the source does not have, or one whose upload fails, leaves
 * the field empty and says so in the slide's `_aiWarnings`. Mutates the
 * slides.
 *
 * @param {Array<{ content?: object, _aiWarnings?: string[] }>} slides
 * @param {SourceImage[]} [sourceImages]
 * @param {object} [opts]
 * @param {AbortSignal|null} [opts.signal] - checked before every upload
 * @returns {Promise<{ used: number[] }>} the numbers of the images placed
 */
export async function resolveSourceImages(
  slides,
  sourceImages = [],
  { signal = null } = {},
) {
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

  async function walk(node, warnings) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string' && SOURCE_IMAGE_REF.test(node[i])) {
          node[i] = await resolve(node[i], warnings);
        } else if (node[i] && typeof node[i] === 'object') {
          await walk(node[i], warnings);
        }
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && SOURCE_IMAGE_REF.test(value)) {
        node[key] = await resolve(value, warnings);
      } else if (value && typeof value === 'object') {
        await walk(value, warnings);
      }
    }
  }

  for (const slide of slides) {
    if (!slide?.content || typeof slide.content !== 'object') continue;
    const warnings = [];
    await walk(slide.content, warnings);
    if (warnings.length) {
      slide._aiWarnings = [...(slide._aiWarnings || []), ...warnings];
    }
  }
  return { used: [...used].sort((a, b) => a - b) };
}
