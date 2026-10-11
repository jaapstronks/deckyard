/**
 * Image Library Picker
 *
 * This file has been refactored into modular components:
 * - image-library/picker.js - Main orchestrator
 * - image-library/grid.js - Grid display and filtering
 * - image-library/detail.js - Detail view for editing
 * - image-library/upload.js - Upload form
 * - image-library/utils.js - Shared utilities
 *
 * This file re-exports for backward compatibility.
 */
export { openImageLibraryPicker } from './image-library/picker.js';
