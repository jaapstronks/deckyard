/**
 * Notion Integration (Compatibility Re-export)
 *
 * This file re-exports all Notion utilities from the modular structure.
 * Import from './notion/index.js' for new code.
 */

export {
  // Client
  notionEnabled,
  notionFetchJson,
  fetchAllBlockChildren,
  // Parser
  richTextToPlain,
  pageTitleFromProperties,
  blockTextLine,
  extractImageFromBlock,
  extractPageId,
  // Pages
  searchRecentPages,
  searchPages,
  extractRichContentFromPage,
  formatNotionContentForAi,
  getPlainTextFromPage,
  getPlainTextPreviewFromPage,
  fetchNotionPage,
  // Blocks
  appendBlocksToPage,
  createDividerBlock,
  createHeadingBlock,
  createParagraphBlock,
  createEmbedBlock,
  createCalloutBlock,
  publishEmbedToNotionPage,
} from './notion/index.js';