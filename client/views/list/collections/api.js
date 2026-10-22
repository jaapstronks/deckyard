/**
 * Slide Collections API client.
 *
 * Thin wrapper over the /api/slide-collections routes (Slice 3a). A collection
 * is a named, ordered set of slide-library item ids; membership is
 * replaced wholesale via PATCH { slideIds }. The shelves are read page by
 * page (D358, B822); a collection's slides come from its own endpoint.
 */

/**
 * @param {object} opts
 * @param {Function} opts.api - API client (path, init) => Promise<json>
 * @returns {object} collection operations
 */
export function createCollectionsApi({ api }) {
  if (!api) throw new Error('Missing api');

  const base = (shelf) =>
    `/api/slide-collections/${shelf === 'organization' ? 'organization' : 'personal'}`;

  /**
   * One page of a shelf's collections (D358, B822).
   * @param {'personal'|'organization'} shelf
   * @param {string|null} [cursor]
   * @returns {Promise<{items: object[], nextCursor: string|null}>}
   */
  const listShelfPage = async (shelf, cursor = null) => {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const r = await api(`${base(shelf)}${qs}`);
    return {
      items: Array.isArray(r?.items) ? r.items : [],
      nextCursor: r?.nextCursor || null,
    };
  };

  /**
   * One page of both shelves for a list pager (`lib/dom/list-pager.js`): the
   * personal shelf's next collections, then the organization's. The cursor
   * is the pair of shelf cursors; it is `null` once both shelves are done.
   * @param {string|null} cursor
   * @returns {Promise<{items: object[], nextCursor: string|null}>}
   */
  const listPage = async (cursor) => {
    const at = cursor ? JSON.parse(cursor) : { personal: '', organization: '' };
    const next = { personal: null, organization: null };
    const items = [];
    for (const shelf of ['personal', 'organization']) {
      if (at[shelf] === null) continue;
      const page = await listShelfPage(shelf, at[shelf] || null);
      items.push(...page.items);
      next[shelf] = page.nextCursor;
    }
    const more = next.personal !== null || next.organization !== null;
    return { items, nextCursor: more ? JSON.stringify(next) : null };
  };

  /**
   * The first page of both shelves. @returns {Promise<{personal: object[], organization: object[]}>}
   */
  const listFirstPages = async () => {
    const [personal, organization] = await Promise.all([
      listShelfPage('personal'),
      listShelfPage('organization'),
    ]);
    return { personal: personal.items, organization: organization.items };
  };

  /**
   * The library items of one collection, in its order, that the reader may
   * see (`GET …/:id/slides`); trashed ones carry `trashedAt`.
   * @param {object} collection
   * @returns {Promise<object[]>}
   */
  const listSlides = async (collection) => {
    const r = await api(
      `${base(collection?.shelf)}/${encodeURIComponent(collection?.id)}/slides`,
    );
    return Array.isArray(r?.items) ? r.items : [];
  };

  const create = (shelf, data) =>
    api(base(shelf), { method: 'POST', body: data || {} });

  const update = (shelf, id, patch) =>
    api(`${base(shelf)}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch || {},
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
    const ids = Array.isArray(collection?.slideIds)
      ? collection.slideIds.slice()
      : [];
    if (ids.includes(slideId)) return { collection, added: false };
    ids.push(slideId);
    const updated = await update(collection.shelf, collection.id, {
      slideIds: ids,
    });
    return { collection: updated, added: true };
  };

  return {
    listPage,
    listFirstPages,
    listSlides,
    create,
    update,
    remove,
    addSlide,
  };
}
