/**
 * PostgreSQL storage adapter using Kysely.
 * Implements multi-tenant storage with organization isolation.
 *
 * This module composes several focused adapters:
 * - presentations.js - Presentations and versions
 * - images.js - Image library
 * - slides.js - Slide library
 * - published.js - Published presentations
 * - settings.js - App and user settings
 * - follow-codes.js - Follow codes
 */

import { StorageAdapter } from '../interface.js';
import { initializeDatabase, closeDatabase } from '../../../db/client.js';

import { withPresentations } from './presentations.js';
import { withImages } from './images.js';
import { withImageFavorites } from './image-favorites.js';
import { withSlides } from './slides.js';
import { withPublished } from './published.js';
import { withSettings } from './settings.js';
import { withFollowCodes } from './follow-codes.js';
import { withTags } from './tags.js';
import { withSlideLibraryTags } from './slide-library-tags.js';
import { withCollections } from './collections.js';
import { withSlideLibraryUsage } from './slide-library-usage.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('postgres');

/**
 * Base adapter with connection management.
 */
class BasePostgresAdapter extends StorageAdapter {
  async initialize() {
    await initializeDatabase();
    log.info('[PostgresAdapter] Connected to PostgreSQL');
  }

  async close() {
    await closeDatabase();
  }
}

/**
 * Full PostgreSQL adapter composed from all mixins.
 */
export const PostgresAdapter = withSlideLibraryUsage(
  withCollections(
    withSlideLibraryTags(
      withTags(
        withFollowCodes(
          withSettings(
            withPublished(
              withSlides(
                withImageFavorites(
                  withImages(
                    withPresentations(BasePostgresAdapter)
                  )
                )
              )
            )
          )
        )
      )
    )
  )
);

// Re-export helpers for external use
export { jsonb, now, normalizePagination, applyPagination } from './helpers.js';