/**
 * Notion Integration (Compatibility Re-export)
 *
 * This file re-exports all Notion utilities from the modular structure.
 * Import from './notion/index.js' for new code.
 */

export {
  // Client
  notionEnabled,
  // Parser
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
  publishEmbedToNotionPage,
} from './notion/index.js';