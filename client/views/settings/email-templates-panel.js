/**
 * Admin Email Templates Panel
 *
 * This module has been refactored into separate files for better maintainability:
 * - email-templates-panel/labels.js - i18n label helpers
 * - email-templates-panel/state.js - State management
 * - email-templates-panel/builders.js - UI building functions
 * - email-templates-panel/actions.js - Event handlers and async operations
 * - email-templates-panel/index.js - Main composition
 *
 * This file re-exports the main function for backward compatibility.
 */

export { createEmailTemplatesPanel } from './email-templates-panel/index.js';