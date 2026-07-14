/**
 * Notion API route handlers.
 *
 * This module provides the main entry point for Notion-related API endpoints.
 * The handlers are split into logical groups:
 * - status.js - Status/capability detection
 * - fetch.js - Fetch and publish endpoints
 * - import.js - Import and stream-import endpoints
 * - subjects.js - Subjects and compose endpoints (feature-gated)
 * - suggest.js - Suggest endpoint (feature-gated)
 * - utils.js - Shared utility functions
 */

// Status handler
export { handleNotionStatus } from './status.js';

// Fetch and publish handlers
export { handleNotionFetch, handleNotionPublish } from './fetch.js';

// Import handlers
export { handleNotionImport, handleNotionImportStream } from './import.js';

// Subject and compose handlers (feature-gated)
export { handleNotionSubjects, handleNotionCompose } from './subjects.js';

// Suggest handler (feature-gated)
export { handleNotionSuggest } from './suggest.js';

// Utility functions
export {
  normName,
  extractKeywordsFromTitle,
  pickKeywordForPage,
  looksLikeUsableDoc,
  handleNotionError,
} from './utils.js';