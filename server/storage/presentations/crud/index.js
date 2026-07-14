/**
 * Presentation CRUD module.
 *
 * Exports all CRUD operations for presentations.
 */

// Read operations
export { getPresentation, getFirstSlidesForIds } from './read.js';

// Write operations
export { createPresentation, updatePresentation } from './write.js';

// Delete operations
export { deletePresentation, restorePresentation, permanentlyDeletePresentation } from './delete.js';

// Duplicate
export { duplicatePresentation } from './duplicate.js';

// Ownership
export { claimPresentationOwnership } from './ownership.js';

// Factory
export { prepareNewPresentation } from './factory.js';

// Helpers (for internal use)
export { normalizeMeta } from './helpers.js';
