/**
 * Storage adapter data shapes.
 *
 * PostgreSQL is the only storage backend, so the contract is the adapter
 * itself (`adapters/postgres/`) rather than a base class to implement. What
 * survives here are the shapes that travel between the storage facades and the
 * adapter: the context every method takes, and the records they return.
 *
 * Every adapter method is async and tenant-aware — the organization comes from
 * the {@link StorageContext} the facade built, never from a default.
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
 * @property {boolean} hasSlides
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
 * The constructor a storage mixin extends.
 *
 * The PostgreSQL adapter is composed from `with*()` mixins over a base class
 * that owns connect/close (`adapters/postgres/index.js`); each mixin takes that
 * base and returns it widened with one domain.
 *
 * @typedef {new (...args: any[]) => object} AdapterBase
 */
