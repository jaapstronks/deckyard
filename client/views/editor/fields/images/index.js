/**
 * Image field renderers - main entry point
 * Re-exports modular components for backward compatibility
 */
import { createFieldImage } from './single-image.js';
import { createFieldTitleBgImage } from './title-bg-image.js';
import { createFieldImages } from './multiple-images.js';

export { createFieldImage } from './single-image.js';
export { createFieldTitleBgImage } from './title-bg-image.js';
export { createFieldImages } from './multiple-images.js';
export * from './alt-utils.js';

/**
 * Create all image field renderers with shared context
 * @param {Object} ctx - Context with all dependencies
 * @returns {Object} Object containing fieldImage, fieldTitleBgImage, fieldImages
 */
export function createImageFields(ctx) {
  return {
    fieldImage: createFieldImage(ctx),
    fieldTitleBgImage: createFieldTitleBgImage(ctx),
    fieldImages: createFieldImages(ctx),
  };
}