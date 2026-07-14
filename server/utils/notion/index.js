/**
 * Notion Integration
 * Re-exports all Notion-related utilities from split modules.
 */

// Client exports
export { notionEnabled, notionFetchJson, fetchAllBlockChildren } from './client.js';

// Parser exports
export {
  richTextToPlain,
  pageTitleFromProperties,
  blockTextLine,
  extractImageFromBlock,
  extractPageId,
} from './parser.js';

// Pages exports
export {
  searchRecentPages,
  searchPages,
  extractRichContentFromPage,
  formatNotionContentForAi,
  getPlainTextFromPage,
  getPlainTextPreviewFromPage,
  fetchNotionPage,
} from './pages.js';

// Block exports
export {
  appendBlocksToPage,
  createDividerBlock,
  createHeadingBlock,
  createParagraphBlock,
  createEmbedBlock,
  createCalloutBlock,
  publishEmbedToNotionPage,
} from './blocks.js';