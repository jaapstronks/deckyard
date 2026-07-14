/**
 * Image Slide Processing
 * Handles extraction and upload of image-only slides.
 */

import { uploadImageKitBuffer, getImageKitConfigFromEnv } from '../../media/imagekit.js';

/**
 * Process image-only slides by uploading their images to ImageKit and creating image-slide data.
 * Separates slides into image-only (handled directly) and regular (for AI processing).
 *
 * IMPORTANT RULES:
 * 1. First slide with an image is ALWAYS treated as title slide (image is illustrative background)
 *    - The image is NOT considered a content candidate for import
 *    - This is true regardless of text length - LLM determines the proper title
 * 2. Subsequent image-only slides become content slides with the image as main content
 *
 * @param {Array} slides - Parsed slides from PPTX/PDF
 * @param {object} options - Options
 * @returns {Promise<{imageOnlySlides: Array<{originalIndex: number, slideData: object}>, regularSlides: Array, titleSlideCandidate: object|null}>}
 */
export async function processImageOnlySlides(slides, options = {}) {
  const { onStatusMessage } = options;
  const imageOnlySlides = [];
  const regularSlides = [];
  let titleSlideCandidate = null;

  // Check if ImageKit is configured
  const imagekitConfig = getImageKitConfigFromEnv();
  const canUploadImages = imagekitConfig.configured;

  if (!canUploadImages) {
    console.log('[File Convert] ImageKit not configured, skipping image extraction');
    // Return all slides as regular if we can't upload images
    return { imageOnlySlides: [], regularSlides: slides, titleSlideCandidate: null };
  }

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];

    if (slide.isImageOnly && slide.images?.length > 0) {
      // This is an image-only slide - upload the image and create slide data
      try {
        const image = slide.images[0]; // Use the first/main image

        if (typeof onStatusMessage === 'function') {
          onStatusMessage(`Afbeelding uploaden van slide ${slide.slideNumber}...`);
        }

        // Upload to ImageKit
        const uploadResult = await uploadImageKitBuffer({
          buffer: image.data,
          fileName: image.filename,
          mimeType: image.mimeType,
          folder: '/converted-slides',
          tags: ['pptx-import', 'auto-converted'],
        });

        console.log(`[File Convert] Uploaded image for slide ${slide.slideNumber}: ${uploadResult.url}`);

        const titleText = slide.textContent?.trim() || '';

        // RULE: First slide with an image is ALWAYS treated as the title slide.
        // The image is illustrative (for title slide background), not content.
        // This is true regardless of text length - the LLM will determine the proper title.
        if (i === 0) {
          console.log(`[File Convert] First slide with image detected - using as title slide background (illustrative)`);
          titleSlideCandidate = {
            title: titleText, // May be empty, contextual, or actual title - LLM will determine
            imageUrl: uploadResult.url,
          };
          // Don't add to imageOnlySlides - it will be handled specially as the title slide
          continue;
        }

        // Create the image-slide data
        // Default zoom behavior: no zoom steps for imported images
        // Most images in presentations are illustrative, not infographics.
        // Users can enable zoom manually for infographic images.
        // Future enhancement: Use vision AI to detect if image contains text/diagrams
        // and automatically enable zoom for those (infographics).
        imageOnlySlides.push({
          originalIndex: i, // Keep track of original position
          slideNumber: slide.slideNumber,
          slideData: {
            type: 'image-slide',
            content: {
              title: titleText, // Use any text as title (if short)
              subheading: '',
              image: uploadResult.url,
              alt: '',
              imageRole: 'content',
              caption: '',
              layout: 'full',
              zoomSteps: '', // Empty string = disabled (user can enable for infographics)
              zoomLevel: 2,
            },
            _aiReasoning: 'Image-only slide extracted directly from source file',
          },
        });
      } catch (err) {
        console.warn(`[File Convert] Failed to upload image for slide ${slide.slideNumber}:`, err.message);
        // Fall back to regular processing if upload fails
        regularSlides.push(slide);
      }
    } else {
      // Regular slide - send to AI for processing
      regularSlides.push({
        ...slide,
        _originalIndex: i, // Track original position for merging later
      });
    }
  }

  return { imageOnlySlides, regularSlides, titleSlideCandidate };
}