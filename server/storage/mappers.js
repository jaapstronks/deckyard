/**
 * Database row to API object mappers.
 * Centralizes snake_case to camelCase conversion and default value handling.
 */

/**
 * Map an image library database row to an API object.
 * @param {object} row - Database row
 * @returns {object}
 */
export function mapImageRow(row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    photographer: row.photographer,
    tags: row.tags || [],
    alts: row.alts || {},
    sources: row.sources || [],
    uploadedBy: row.uploaded_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a slide library database row to an API object.
 * @param {object} row - Database row
 * @returns {object}
 */
export function mapSlideLibraryRow(row) {
  return {
    id: row.id,
    scope: row.scope,
    ownerEmail: row.owner_email,
    name: row.name,
    description: row.description || '',
    slideType: row.slide_type,
    themeId: row.theme_id,
    content: row.content || {},
    favorites: row.favorites || [],
    trashedAt: row.trashed_at,
    trashedBy: row.trashed_by,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a slide collection database row to an API object.
 * @param {object} row - Database row from slide_collections
 * @param {string[]} [slideIds] - Ordered member slide-library ids
 * @returns {object}
 */
export function mapSlideCollectionRow(row, slideIds = []) {
  return {
    id: row.id,
    scope: row.scope,
    ownerEmail: row.owner_email,
    name: row.name,
    description: row.description || '',
    slideIds: Array.isArray(slideIds) ? slideIds : [],
    slideCount: Array.isArray(slideIds) ? slideIds.length : 0,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Map a published presentation database row to an API object.
 * @param {object} row - Database row
 * @returns {object}
 */
export function mapPublishedRow(row) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    title: row.title,
    slug: row.slug,
    ogImageUrl: row.og_image_url,
    created: row.created_at,
    modified: row.modified_at,
  };
}

/**
 * Map a presentation version database row to an API object (list view).
 * @param {object} row - Database row
 * @returns {object}
 */
export function mapVersionRowSummary(row) {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    created: row.created_at,
    createdBy: row.created_by,
    reason: row.reason,
    label: row.label,
    revision: row.revision,
    title: row.title,
  };
}

/**
 * Map a presentation version database row to an API object (full view).
 * @param {object} row - Database row
 * @returns {object}
 */
export function mapVersionRowFull(row) {
  return {
    ...mapVersionRowSummary(row),
    presentation: row.presentation_data,
  };
}

/**
 * Map a presentation database row to an API object.
 * @param {object} row - Database row
 * @returns {object}
 */
export function mapPresentationRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    created: row.created_at,
    modified: row.modified_at,
    theme: row.theme,
    lang: row.lang,
    scope: row.scope,
    revision: row.revision,
    ownerEmail: row.owner_email,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    settings: row.settings || {},
    i18n: row.i18n || {},
    slides: row.slides || [],
    notionSourcePageId: row.notion_source_page_id,
    sandbox: row.sandbox,
    published: row.published,
    trashedAt: row.trashed_at,
    trashedBy: row.trashed_by,
  };
}

/**
 * Map a follow code database row to an API object.
 * @param {object} row - Database row
 * @returns {object}
 */
export function mapFollowCodeRow(row) {
  return {
    id: row.id,
    code: row.code,
    presentationId: row.presentation_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxFollowers: row.max_followers,
    activeFollowers: row.active_followers,
    disabled: row.disabled,
  };
}