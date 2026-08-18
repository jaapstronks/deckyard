/**
 * Slide Collections API client.
 *
 * Thin wrapper over the /api/slide-collections routes (Slice 3a). A collection
 * is a named, ordered set of slide-library item ids; membership is
 * replaced wholesale via PATCH { slideIds }.
 */

/**
 * @param {object} opts
 * @param {Function} opts.api - API client (path, init) => Promise<json>
 * @returns {object} collection operations
 */
export function createCollectionsApi({ api }) {
  if (!api) throw new Error('Missing api');

  const base = (shelf) => `/api/slide-collections/${shelf === 'organization' ? 'organization' : 'personal'}`;

  const list = async (shelf) => {
    const r = await api(base(shelf));
    return Array.isArray(r?.items) ? r.items : [];
  };

  /** Fetch both shelves at once. @returns {Promise<{personal: object[], team: object[]}>} */
  const listAll = async () => {
    const [personal, team] = await Promise.all([list('personal'), list('organization')]);
    return { personal, team };
  };

  const create = (shelf, data) =>
    api(base(shelf), { method: 'POST', body: JSON.stringify(data || {}) });

  const update = (shelf, id, patch) =>
    api(`${base(shelf)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch || {}),
    });

  const remove = (shelf, id) =>
    api(`${base(shelf)}/${encodeURIComponent(id)}`, { method: 'DELETE' });

  /**
   * Append a slide id to a collection (no-op if already a member).
   * @param {object} collection - the current collection object (with slideIds)
   * @param {string} slideId
   * @returns {Promise<{collection: object, added: boolean}>}
   */
  const addSlide = async (collection, slideId) => {
    const ids = Array.isArray(collection?.slideIds) ? collection.slideIds.slice() : [];
    if (ids.includes(slideId)) return { collection, added: false };
    ids.push(slideId);
    const updated = await update(collection.shelf, collection.id, { slideIds: ids });
    return { collection: updated, added: true };
  };

  return { list, listAll, create, update, remove, addSlide };
}
