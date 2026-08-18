/**
 * PostgreSQL storage adapter using Kysely.
 * Implements multi-tenant storage with organization isolation.
 *
 * This module composes several focused adapters:
 * - presentations.js - Presentations and versions
 * - images.js - Image library
 * - slides.js - Slide library
 * - published.js - Published presentations
 */

import { initializeDatabase, closeDatabase } from '../../../db/client.js';

import { withPresentations } from './presentations.js';
import { withImages } from './images.js';
import { withImageFavorites } from './image-favorites.js';
import { withSlides } from './slides.js';
import { withSlideLibraryTags } from './slide-library-tags.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('postgres');

/**
 * Base adapter with connection management. The domain methods are layered on
 * by the `with*()` mixins below; the data shapes they exchange with the
 * storage facades are documented in `../types.js`.
 */
class BasePostgresAdapter {
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
export const PostgresAdapter = withSlideLibraryTags(
  withSlides(
    withImageFavorites(
      withImages(
        withPresentations(BasePostgresAdapter)
      )
    )
  )
);