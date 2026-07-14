/**
 * File Converter Helpers
 * Utility functions for file conversion.
 */

/**
 * Detect file type from filename and/or MIME type
 */
export function detectFileType(filename, mimeType) {
  const ext = String(filename || '')
    .toLowerCase()
    .split('.')
    .pop();

  if (
    ext === 'pptx' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return 'pptx';
  }

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    return 'pdf';
  }

  // Word documents (.docx)
  if (
    ext === 'docx' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }

  // RTF documents
  if (ext === 'rtf' || mimeType === 'application/rtf' || mimeType === 'text/rtf') {
    return 'rtf';
  }

  // OpenDocument Text (.odt)
  if (ext === 'odt' || mimeType === 'application/vnd.oasis.opendocument.text') {
    return 'odt';
  }

  // Markdown (.md)
  if (ext === 'md' || ext === 'markdown' || mimeType === 'text/markdown' || mimeType === 'text/x-markdown') {
    return 'md';
  }

  // Zip bundle (.zip) — markdown + images
  if (ext === 'zip' || mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') {
    return 'zip';
  }

  // Legacy formats not supported
  if (ext === 'ppt' || mimeType === 'application/vnd.ms-powerpoint') {
    return null; // Not supported
  }
  if (ext === 'doc' || mimeType === 'application/msword') {
    return null; // Not supported (use .docx)
  }

  return null;
}

/**
 * Format extracted slides into a structured text format for the AI
 */
export function formatSlidesForAi(slides, metadata) {
  const parts = [];

  if (metadata?.title) {
    parts.push(`PRESENTATION TITLE: ${metadata.title}`);
  }
  if (metadata?.author) {
    parts.push(`AUTHOR: ${metadata.author}`);
  }
  if (parts.length > 0) {
    parts.push('');
  }

  parts.push('=== SLIDES ===');
  parts.push('');

  for (const slide of slides) {
    parts.push(`--- SLIDE ${slide.slideNumber} ---`);
    if (slide.textContent) {
      parts.push(slide.textContent);
    } else {
      parts.push('[No text content - possibly image-only slide]');
    }
    if (slide.notes) {
      parts.push('');
      parts.push('SPEAKER NOTES:');
      parts.push(slide.notes);
    }
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Check if the first slide from the source file already looks like a title slide.
 * If so, we don't want to add a duplicate title slide.
 */
export function firstSlideIsTitle(firstSlideContent, outline) {
  if (!firstSlideContent) return false;

  const text = String(firstSlideContent).trim().toLowerCase();
  const outlineTitle = String(outline.title || '').toLowerCase();
  const outlineSubtitle = String(outline.subtitle || '').toLowerCase();

  // Check 1: Very short content (just a title, maybe subtitle)
  const lines = text.split('\n').filter(l => l.trim()).length;
  if (lines <= 3) {
    // Few lines = likely a title slide
    console.log('[File Convert] First slide looks like a title (few lines)');
    return true;
  }

  // Check 2: First slide contains the detected presentation title
  if (outlineTitle && text.includes(outlineTitle)) {
    console.log('[File Convert] First slide contains presentation title');
    return true;
  }

  // Check 3: First slide content matches subtitle pattern (author name, date, etc.)
  if (outlineSubtitle && text.includes(outlineSubtitle)) {
    return true;
  }

  // Check 4: Check if first AI slide is a title-slide type
  const firstAiSlide = outline.slides?.[0];
  if (firstAiSlide?.intent === 'opening') {
    console.log('[File Convert] First AI slide has opening intent');
    return true;
  }

  return false;
}

/**
 * Check if a slide might need manual review
 */
export function slideNeedsReview(slide) {
  if (!slide?.content) return true;

  const title = String(slide.content?.title || '').toLowerCase();
  const body = String(slide.content?.body || '').toLowerCase();

  // Check for TODO markers
  if (title.includes('todo') || body.includes('todo')) return true;
  if (title.includes('needs review') || body.includes('needs review')) return true;

  // Check for placeholder content
  if (title.includes('[image slide') || title.includes('[visual')) return true;

  // Check for very short content that might be incomplete
  if (
    slide.type === 'content-slide' &&
    body.length < 20 &&
    !['title-slide', 'chapter-title-slide', 'payoff-slide'].includes(slide.type)
  ) {
    return true;
  }

  return false;
}

/**
 * Get the reason why a slide needs review
 */
export function getReviewReason(slide) {
  const title = String(slide.content?.title || '').toLowerCase();
  const body = String(slide.content?.body || '').toLowerCase();

  if (title.includes('[image slide') || title.includes('[visual')) {
    return 'Image-only slide needs manual content';
  }
  if (title.includes('todo') || body.includes('todo')) {
    return 'Contains TODO marker';
  }
  if (body.length < 20) {
    return 'Very short content - may be incomplete';
  }
  return 'May need review';
}

/**
 * Supported file extensions
 */
export const SUPPORTED_EXTENSIONS = ['pptx', 'pdf', 'docx', 'rtf', 'odt', 'md', 'zip'];

/**
 * Supported MIME types
 */
export const SUPPORTED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'text/markdown',
  'text/x-markdown',
  'application/zip',
  'application/x-zip-compressed',
];