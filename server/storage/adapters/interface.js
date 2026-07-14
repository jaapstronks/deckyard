/**
 * Storage Adapter Interface
 *
 * Defines the contract for storage backends.
 * All methods are async and tenant-aware (organizationId parameter where applicable).
 *
 * @typedef {Object} StorageContext
 * @property {string} [organizationId] - Organization ID for multi-tenancy
 * @property {string} [actorEmail] - Email of the user performing the action
 *
 * @typedef {Object} PresentationSummary
 * @property {string} id
 * @property {string} title
 * @property {string} modified
 * @property {string} created
 * @property {string} theme
 * @property {string|null} ownerEmail
 * @property {string|null} createdBy
 * @property {string|null} updatedBy
 * @property {string} scope
 * @property {number} revision
 * @property {Object|null} i18n
 * @property {Object|null} firstSlide
 *
 * @typedef {Object} Presentation
 * @property {string} id
 * @property {string} title
 * @property {string} created
 * @property {string} modified
 * @property {string} theme
 * @property {string} lang
 * @property {string} scope
 * @property {number} revision
 * @property {string|null} ownerEmail
 * @property {string|null} createdBy
 * @property {string|null} updatedBy
 * @property {Object} settings
 * @property {Object} i18n
 * @property {Array} slides
 *
 * @typedef {Object} PresentationVersion
 * @property {string} id
 * @property {string} presentationId
 * @property {string} created
 * @property {string|null} createdBy
 * @property {string} reason
 * @property {string|null} label
 * @property {number} revision
 * @property {string} title
 * @property {Object} presentation
 *
 * @typedef {Object} ImageLibraryItem
 * @property {string} id
 * @property {string} url
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [photographer]
 * @property {string[]} [tags]
 * @property {Object} [alts]
 * @property {string[]} [sources]
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} SlideLibraryItem
 * @property {string} id
 * @property {string} scope
 * @property {string|null} ownerEmail
 * @property {string} name
 * @property {string} slideType
 * @property {string|null} themeId
 * @property {Object} content
 * @property {string[]} favorites
 * @property {string|null} trashedAt
 * @property {string|null} trashedBy
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @interface StorageAdapter
 */
export class StorageAdapter {
  /**
   * Initialize the adapter (connect to database, etc.)
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('Not implemented');
  }

  /**
   * Close connections and cleanup
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('Not implemented');
  }

  // ============================================================
  // PRESENTATIONS
  // ============================================================

  /**
   * List all presentations accessible by the context.
   * @param {StorageContext} ctx
   * @returns {Promise<PresentationSummary[]>}
   */
  async listPresentations(ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Get a single presentation by ID.
   * @param {string} id
   * @param {StorageContext} ctx
   * @returns {Promise<Presentation|null>}
   */
  async getPresentation(id, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Create a new presentation.
   * @param {Object} data - Presentation data
   * @param {StorageContext} ctx
   * @returns {Promise<Presentation>}
   */
  async createPresentation(data, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Update an existing presentation.
   * @param {string} id
   * @param {Object} data - Updated presentation data
   * @param {StorageContext} ctx
   * @param {Object} [opts]
   * @param {number} [opts.expectedRevision] - For optimistic locking
   * @returns {Promise<Presentation|null>}
   */
  async updatePresentation(id, data, ctx, opts) {
    throw new Error('Not implemented');
  }

  /**
   * Delete a presentation.
   * @param {string} id
   * @param {StorageContext} ctx
   * @returns {Promise<boolean>}
   */
  async deletePresentation(id, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Duplicate a presentation.
   * @param {string} id
   * @param {StorageContext} ctx
   * @returns {Promise<Presentation|null>}
   */
  async duplicatePresentation(id, ctx) {
    throw new Error('Not implemented');
  }

  // ============================================================
  // PRESENTATION VERSIONS
  // ============================================================

  /**
   * List versions of a presentation.
   * @param {string} presentationId
   * @param {StorageContext} ctx
   * @returns {Promise<PresentationVersion[]>}
   */
  async listPresentationVersions(presentationId, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Get a specific version.
   * @param {string} presentationId
   * @param {string} versionId
   * @param {StorageContext} ctx
   * @returns {Promise<PresentationVersion|null>}
   */
  async getPresentationVersion(presentationId, versionId, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Create a new version snapshot.
   * @param {string} presentationId
   * @param {Object} snapshot - Full presentation data
   * @param {StorageContext} ctx
   * @param {Object} [opts]
   * @param {string} [opts.reason]
   * @param {string} [opts.label]
   * @returns {Promise<PresentationVersion>}
   */
  async createPresentationVersion(presentationId, snapshot, ctx, opts) {
    throw new Error('Not implemented');
  }

  /**
   * Prune old versions, keeping only the most recent N.
   * @param {string} presentationId
   * @param {StorageContext} ctx
   * @param {Object} [opts]
   * @param {number} [opts.keep]
   * @returns {Promise<number>} - Number of versions deleted
   */
  async prunePresentationVersions(presentationId, ctx, opts) {
    throw new Error('Not implemented');
  }

  // ============================================================
  // IMAGE LIBRARY
  // ============================================================

  /**
   * List images in the library.
   * @param {StorageContext} ctx
   * @returns {Promise<ImageLibraryItem[]>}
   */
  async listImages(ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Get a single image by ID.
   * @param {string} id
   * @param {StorageContext} ctx
   * @returns {Promise<ImageLibraryItem|null>}
   */
  async getImage(id, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Add an image to the library.
   * @param {Object} data
   * @param {StorageContext} ctx
   * @returns {Promise<ImageLibraryItem>}
   */
  async createImage(data, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Update an image entry.
   * @param {string} id
   * @param {Object} data
   * @param {StorageContext} ctx
   * @returns {Promise<ImageLibraryItem|null>}
   */
  async updateImage(id, data, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Delete an image from the library.
   * @param {string} id
   * @param {StorageContext} ctx
   * @returns {Promise<boolean>}
   */
  async deleteImage(id, ctx) {
    throw new Error('Not implemented');
  }

  // ============================================================
  // SLIDE LIBRARY
  // ============================================================

  /**
   * List slide library items.
   * @param {StorageContext} ctx
   * @param {Object} [opts]
   * @param {string} [opts.scope] - 'personal' or 'team'
   * @param {string} [opts.ownerEmail]
   * @param {string} [opts.themeId]
   * @returns {Promise<SlideLibraryItem[]>}
   */
  async listSlideLibrary(ctx, opts) {
    throw new Error('Not implemented');
  }

  /**
   * Get a single slide library item.
   * @param {string} id
   * @param {StorageContext} ctx
   * @returns {Promise<SlideLibraryItem|null>}
   */
  async getSlideLibraryItem(id, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Create a slide library item.
   * @param {Object} data
   * @param {StorageContext} ctx
   * @returns {Promise<SlideLibraryItem>}
   */
  async createSlideLibraryItem(data, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Update a slide library item.
   * @param {string} id
   * @param {Object} data
   * @param {StorageContext} ctx
   * @returns {Promise<SlideLibraryItem|null>}
   */
  async updateSlideLibraryItem(id, data, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Delete a slide library item.
   * @param {string} id
   * @param {StorageContext} ctx
   * @returns {Promise<boolean>}
   */
  async deleteSlideLibraryItem(id, ctx) {
    throw new Error('Not implemented');
  }

  // ============================================================
  // PUBLISHED PRESENTATIONS
  // ============================================================

  /**
   * List all published presentations.
   * @param {StorageContext} ctx
   * @returns {Promise<Object[]>}
   */
  async listPublished(ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Get a published presentation by publish ID.
   * @param {string} publishId
   * @param {StorageContext} ctx
   * @returns {Promise<Object|null>}
   */
  async getPublished(publishId, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Create or update a published entry.
   * @param {Object} data
   * @param {StorageContext} ctx
   * @returns {Promise<Object>}
   */
  async upsertPublished(data, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Delete a published entry.
   * @param {string} publishId
   * @param {StorageContext} ctx
   * @returns {Promise<boolean>}
   */
  async deletePublished(publishId, ctx) {
    throw new Error('Not implemented');
  }

  // ============================================================
  // SETTINGS
  // ============================================================

  /**
   * Get app-level settings.
   * @param {StorageContext} ctx
   * @returns {Promise<Object>}
   */
  async getAppSettings(ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Update app-level settings.
   * @param {Object} data
   * @param {StorageContext} ctx
   * @returns {Promise<Object>}
   */
  async setAppSettings(data, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Get user-level settings.
   * @param {string} email
   * @param {StorageContext} ctx
   * @returns {Promise<Object>}
   */
  async getUserSettings(email, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Update user-level settings.
   * @param {string} email
   * @param {Object} data
   * @param {StorageContext} ctx
   * @returns {Promise<Object>}
   */
  async setUserSettings(email, data, ctx) {
    throw new Error('Not implemented');
  }

  // ============================================================
  // FOLLOW CODES
  // ============================================================

  /**
   * Create a follow code.
   * @param {string} code
   * @param {string} followUrl
   * @param {StorageContext} ctx
   * @param {Object} [opts]
   * @param {string} [opts.expiresAt]
   * @returns {Promise<Object>}
   */
  async createFollowCode(code, followUrl, ctx, opts) {
    throw new Error('Not implemented');
  }

  /**
   * Resolve a follow code to its URL.
   * @param {string} code
   * @param {StorageContext} ctx
   * @returns {Promise<string|null>}
   */
  async resolveFollowCode(code, ctx) {
    throw new Error('Not implemented');
  }

  /**
   * Delete expired follow codes.
   * @param {StorageContext} ctx
   * @returns {Promise<number>}
   */
  async cleanupExpiredFollowCodes(ctx) {
    throw new Error('Not implemented');
  }
}