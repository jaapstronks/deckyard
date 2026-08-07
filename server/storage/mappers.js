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
    i18n: row.i18n || {},
    favorites: row.favorites || [],
    trashedAt: row.trashed_at,
    // Identity travels as a pair (T10 PR F2): the stable `users.id`
    // (migration 070) beside the display/fallback e-mail. The team-library
    // trash/delete guard matches on `createdById`; see shared/identity-match.js.
    trashedBy: row.trashed_by,
    createdById: row.created_by_user_id || null,
    createdBy: row.created_by,
    updatedById: row.updated_by_user_id || null,
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
    // Identity pair (T10 PR F2): the team-collection mutate guard matches on
    // `createdById`, with the e-mail as the fallback. See shared/identity-match.js.
    createdById: row.created_by_user_id || null,
    createdBy: row.created_by,
    updatedById: row.updated_by_user_id || null,
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
    // Identity travels as a pair (T10 PR F1): the stable `users.id`
    // (migration 069) beside the display/fallback e-mail. See
    // shared/identity-match.js and mapPresentationRow below.
    createdById: row.created_by_user_id || null,
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
    // The owning organization travels with the presentation so the
    // authorization layer can check it without a second query; see
    // isSameOrganization() in utils/presentation-authz/presentations.js.
    organizationId: row.organization_id,
    title: row.title,
    description: row.description,
    created: row.created_at,
    modified: row.modified_at,
    theme: row.theme,
    lang: row.lang,
    visibility: row.visibility,
    isViewOnly: !!row.is_view_only,
    revision: row.revision,
    // Identity travels as a pair per role: the stable `users.id` (migration 063)
    // is the key every authorization decision compares, the email beside it is
    // display/contact plus the fallback identifier for rows whose email never
    // matched a user (external/legacy — a defined NULL). See
    // shared/identity-match.js.
    ownerId: row.owner_user_id || null,
    ownerEmail: row.owner_email,
    createdById: row.created_by_user_id || null,
    createdBy: row.created_by,
    updatedById: row.updated_by_user_id || null,
    updatedBy: row.updated_by,
    settings: row.settings || {},
    i18n: row.i18n || {},
    slides: row.slides || [],
    notionSourcePageId: row.notion_source_page_id,
    sandbox: row.sandbox,
    published: row.published,
    trashedAt: row.trashed_at,
    trashedById: row.trashed_by_user_id || null,
    trashedBy: row.trashed_by,
  };
}

