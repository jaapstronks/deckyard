/**
 * PostgreSQL storage adapter using Kysely.
 * Implements multi-tenant storage with organization isolation.
 *
 * This file re-exports the modular PostgresAdapter from ./postgres/
 * for backward compatibility. The implementation is now split into
 * focused modules for better maintainability:
 *
 * - postgres/presentations.js - Presentations and versions
 * - postgres/images.js - Image library
 * - postgres/slides.js - Slide library
 * - postgres/published.js - Published presentations
 * - postgres/settings.js - App and user settings
 * - postgres/follow-codes.js - Follow codes
 * - postgres/helpers.js - Shared utilities
 */

export { PostgresAdapter } from './postgres/index.js';