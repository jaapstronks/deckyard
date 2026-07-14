/**
 * Image Resolution for Markdown Import
 *
 * - Absolute HTTPS URLs: kept as-is
 * - Data URIs: uploaded via media provider
 * - Relative paths: resolved from imageMap (zip bundles) or warned
 * - Missing/broken: empty string + warning
 */

import { getMediaProvider } from '../../media/index.js';

/**
 * Resolve images across all slides.
 * Mutates slide content in place to replace image references with final URLs.
 *
 * @param {object[]} slides - Array of slide objects (type + content)
 * @param {{ warnings?: string[], imageMap?: Map<string, string> }} opts
 * @returns {Promise<object[]>} Same slides array, mutated
 */
export async function resolveSlideImages(slides, opts = {}) {
  const warnings = opts.warnings || [];
  const imageMap = opts.imageMap || null;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const content = slide.content;
    if (!content) continue;

    // Resolve known image fields
    for (const key of IMAGE_FIELDS) {
      if (typeof content[key] === 'string' && content[key].trim()) {
        content[key] = await resolveImageRef(content[key], i + 1, key, warnings, imageMap);
      }
    }

    // Resolve image arrays (gallery-slide)
    if (Array.isArray(content.images)) {
      for (let j = 0; j < content.images.length; j++) {
        const img = content.images[j];
        if (typeof img?.src === 'string' && img.src.trim()) {
          img.src = await resolveImageRef(img.src, i + 1, `images[${j}]`, warnings, imageMap);
        }
      }
    }
  }

  return slides;
}

/**
 * Image field keys that may contain image URLs across all slide types.
 */
const IMAGE_FIELDS = ['image', 'bgImage'];

/**
 * Resolve a single image reference.
 * @param {string} ref - The raw image reference (URL, data URI, path)
 * @param {number} slideNum - 1-based slide number for warnings
 * @param {string} fieldName - Field name for warnings
 * @param {string[]} warnings - Array to push warnings into
 * @param {Map<string, string>|null} imageMap - Optional map of relative path → uploaded URL (from zip bundles)
 * @returns {Promise<string>} Resolved URL or empty string
 */
async function resolveImageRef(ref, slideNum, fieldName, warnings, imageMap) {
  const trimmed = ref.trim();

  // 1. Absolute URL (http/https) - keep as-is
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // 2. Data URI - upload via media provider
  if (trimmed.startsWith('data:')) {
    try {
      const provider = getMediaProvider();
      const result = await provider.uploadDataUrl({
        dataUrl: trimmed,
        filename: `md-import-s${slideNum}-${fieldName}`,
      });
      return result.publicUrl || '';
    } catch (err) {
      warnings.push(`Slide ${slideNum}: Failed to upload data URI for ${fieldName}: ${err.message}`);
      return '';
    }
  }

  // 3. Relative path - look up in imageMap (from zip bundles)
  if (trimmed && !trimmed.startsWith('#')) {
    if (imageMap) {
      // Try exact match, then normalized (no leading ./)
      const normalized = trimmed.replace(/^\.\//, '');
      const url = imageMap.get(trimmed) || imageMap.get(normalized);
      if (url) return url;

      // Try case-insensitive match
      for (const [key, val] of imageMap) {
        if (key.toLowerCase() === normalized.toLowerCase()) return val;
      }

      warnings.push(
        `Slide ${slideNum}: Image "${trimmed}" in ${fieldName} not found in zip bundle.`
      );
      return '';
    }

    warnings.push(
      `Slide ${slideNum}: Relative image path "${trimmed}" in ${fieldName} cannot be resolved. ` +
      `Use an absolute URL (https://...) or upload a zip bundle with images.`
    );
    return '';
  }

  return '';
}
