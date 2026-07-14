/**
 * Preview Image Generation Utility
 *
 * Generates preview/thumbnail images for slide decks and slide library items.
 * Used for OG images (social sharing) and Slack unfurling.
 */

import sharp from 'sharp';
import { renderSlideToPngBuffer } from './png.js';
import { getMediaProvider, isMediaProviderInitialized } from '../media/index.js';
import {
  generateAuthorOverlay,
  fetchImageAsBuffer,
  AUTHOR_OVERLAY_MARGIN,
} from '../utils/author-overlay.js';

// OG image dimensions (optimal for social platforms)
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Slide render dimensions (16:9 aspect ratio)
const SLIDE_WIDTH = 1600;
const SLIDE_HEIGHT = 900;

// Max dimensions for the slide within the OG canvas (with padding)
const MAX_SLIDE_WIDTH = 1120; // 40px padding on each side
const MAX_SLIDE_HEIGHT = 630; // Full height

/**
 * Generate a preview image for a slide at native 16:9 resolution.
 *
 * @param {string} repoRoot - Repository root path
 * @param {object} slide - Slide object with type and content
 * @param {object} theme - Theme object
 * @returns {Promise<Buffer>} PNG buffer at 1600x900
 */
export async function generateSlidePreview(repoRoot, slide, theme, { slideTypes = null } = {}) {
  const buffer = await renderSlideToPngBuffer(repoRoot, slide, {
    scale: 1, // 1x scale = 1600x900
    theme,
    slideTypes,
  });
  return buffer;
}

/**
 * Generate an OG-optimized preview image (1200x630) with the slide
 * letterboxed and centered on a dark canvas.
 *
 * @param {string} repoRoot - Repository root path
 * @param {object} slide - Slide object with type and content
 * @param {object} theme - Theme object
 * @param {object} [options] - Optional settings
 * @param {boolean} [options.showAuthor] - Whether to show author overlay
 * @param {object} [options.authorInfo] - Author info { name, imageUrl }
 * @returns {Promise<Buffer>} PNG buffer at 1200x630
 */
export async function generateOgPreview(repoRoot, slide, theme, options = {}) {
  const { showAuthor = false, authorInfo, slideTypes = null } = options;

  // Render the slide at native resolution
  const slideBuffer = await renderSlideToPngBuffer(repoRoot, slide, {
    scale: 1,
    theme,
    slideTypes,
  });

  // Calculate the size to fit 16:9 slide within OG dimensions
  // Slide aspect ratio: 1600/900 = 1.778
  // OG aspect ratio: 1200/630 = 1.905 (wider than slide)
  // So we'll fit by height (slide height = OG height) and center horizontally
  const slideAspect = SLIDE_WIDTH / SLIDE_HEIGHT;
  let fitWidth = MAX_SLIDE_HEIGHT * slideAspect;
  let fitHeight = MAX_SLIDE_HEIGHT;

  // If fitted width exceeds max, fit by width instead
  if (fitWidth > MAX_SLIDE_WIDTH) {
    fitWidth = MAX_SLIDE_WIDTH;
    fitHeight = MAX_SLIDE_WIDTH / slideAspect;
  }

  // Round to whole pixels
  fitWidth = Math.round(fitWidth);
  fitHeight = Math.round(fitHeight);

  // Resize the slide
  const resizedSlide = await sharp(slideBuffer)
    .resize(fitWidth, fitHeight, { fit: 'fill' })
    .png()
    .toBuffer();

  // Calculate position to center the slide on the canvas
  const left = Math.round((OG_WIDTH - fitWidth) / 2);
  const top = Math.round((OG_HEIGHT - fitHeight) / 2);

  // Build composite layers
  const composites = [
    {
      input: resizedSlide,
      left,
      top,
    },
  ];

  // Add author overlay if requested (positioned at top-right corner)
  if (showAuthor && authorInfo?.name) {
    try {
      // Fetch author's profile image if available
      let imageBuffer = null;
      if (authorInfo.imageUrl) {
        imageBuffer = await fetchImageAsBuffer(authorInfo.imageUrl);
      }

      const overlay = await generateAuthorOverlay({
        name: authorInfo.name,
        imageBuffer,
      });

      if (overlay) {
        composites.push({
          input: overlay.buffer,
          left: OG_WIDTH - overlay.width - AUTHOR_OVERLAY_MARGIN,
          top: AUTHOR_OVERLAY_MARGIN,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[preview-image] Author overlay generation failed:', err.message);
      // Continue without author overlay
    }
  }

  // Create dark canvas and composite the slide onto it
  const ogBuffer = await sharp({
    create: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      channels: 3,
      background: { r: 18, g: 18, b: 18 }, // Dark gray (#121212)
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return ogBuffer;
}

/**
 * Save a preview buffer to the media provider.
 *
 * @param {string} repoRoot - Repository root path (unused if using Scaleway)
 * @param {Buffer} buffer - PNG buffer to save
 * @param {string} prefix - Filename prefix (e.g., 'og-abc123' or 'lib-xyz456')
 * @returns {Promise<string>} Public URL of the saved image
 */
export async function savePreviewToMedia(repoRoot, buffer, prefix) {
  if (!isMediaProviderInitialized()) {
    throw new Error('Media provider not initialized');
  }

  const provider = getMediaProvider();
  const filename = `${prefix}.png`;

  const result = await provider.uploadBuffer({
    buffer,
    filename,
    contentType: 'image/png',
  });

  return result.publicUrl;
}

/**
 * Generate an OG preview and save it to media storage.
 * Convenience function that combines generation and saving.
 *
 * @param {string} repoRoot - Repository root path
 * @param {object} slide - Slide object with type and content
 * @param {object} theme - Theme object
 * @param {string} prefix - Filename prefix
 * @param {object} [options] - Optional settings for preview generation
 * @param {boolean} [options.showAuthor] - Whether to show author overlay
 * @param {object} [options.authorInfo] - Author info { name, imageUrl }
 * @returns {Promise<string>} Public URL of the saved image
 */
export async function generateAndSaveOgPreview(repoRoot, slide, theme, prefix, options = {}) {
  const buffer = await generateOgPreview(repoRoot, slide, theme, options);
  const url = await savePreviewToMedia(repoRoot, buffer, prefix);
  return url;
}