/**
 * Slide Library API Operations
 * Handles API calls for the slide library picker
 */

import { toast } from '../dom/toast.js';
import { t } from '../ui-i18n.js';
import { cleanStr } from '../../../shared/string-utils.js';

/**
 * The `If-Match` header for an edit of `item` (D170): the revision it was
 * loaded at. A name, description or content PATCH without it is a 428.
 * @param {{revision?: number}} item
 * @returns {{'If-Match': string}}
 */
function ifMatch(item) {
  return { 'If-Match': String(item?.revision ?? '') };
}

/**
 * The tag names of a library item. The list routes attach tags as
 * `{id, name}` objects; a bare string is read the same way, as everywhere
 * else the client reads tags.
 * @param {{tags?: Array<{name?: string}|string>}} item
 * @returns {string[]}
 */
function tagNamesOf(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  return tags.map((tag) => cleanStr(tag?.name ?? tag)).filter(Boolean);
}

/**
 * The body of a copy (D183). One shape for "copy this item to a shelf":
 * everything that describes the item travels — name, description, type,
 * content, language versions and theme — and the destination shelf is the
 * only difference between the copy actions. Tags are deliberately absent:
 * they are a relation in `slide_library_tags`, not a create field, so they
 * follow in the PUT that `copyItemTo` makes.
 * @param {object} item - The item being copied
 * @param {string} themeIdNorm - The picker's normalized theme, when the item has none
 * @returns {object}
 */
function copyPayload(item, themeIdNorm) {
  return {
    name: cleanStr(item?.name),
    description: cleanStr(item?.description),
    slideType: cleanStr(item?.slideType),
    content: item?.content || {},
    i18n: item?.i18n || {},
    themeId: cleanStr(item?.themeId || themeIdNorm),
  };
}

/**
 * Create API operations for the slide library
 * @param {object} options
 * @param {Function} options.api - API client function
 * @param {object} options.state - State management object from createSlideLibraryState
 * @param {string} options.themeIdNorm - Normalized theme ID
 * @returns {object} API operations
 */
export function createSlideLibraryApi({ api, state, themeIdNorm = '' }) {
  if (!api) throw new Error('Missing api');

  const fetchShelf = async (shelf) => {
    const s = shelf === 'organization' ? 'organization' : 'personal';
    if (state.isLoading(s)) return;
    state.setLoading(s, true);
    try {
      const qs = themeIdNorm ? `?theme=${encodeURIComponent(themeIdNorm)}` : '';
      const r = await api(`/api/slide-library/${s}${qs}`);
      state.setCache(s, Array.isArray(r?.items) ? r.items : []);
    } finally {
      state.setLoading(s, false);
    }
  };

  const toggleFavorite = async (shelf, item, { rerender } = {}) => {
    const s = shelf === 'organization' ? 'organization' : 'personal';
    const id = cleanStr(item?.id);
    if (!id) return;
    // `favorite` is the caller's own flag on both shelves (B334).
    const current = !!item?.favorite;
    const optimistic = !current;

    // Optimistic UI: update immediately, then reconcile with server response.
    const snap = state.patchInCache(s, id, (prev) => ({
      ...prev,
      favorite: optimistic,
    }));
    rerender?.();

    try {
      const updated = await api(
        `/api/slide-library/${s}/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: { favorite: !current },
        },
      );
      const arr = state.getCache(s);
      const idx = arr.findIndex((x) => String(x?.id || '') === id);
      if (idx >= 0) arr[idx] = updated;
      else state.setCache(s, [updated, ...arr]);
      rerender?.();
    } catch (e) {
      // Revert optimistic update
      if (snap?.ok) {
        state.patchInCache(s, id, () => snap.prev);
        rerender?.();
      }
      toast.error(e);
    }
  };

  const setTrashed = async (shelf, item, trashed, { rerender } = {}) => {
    const s = shelf === 'organization' ? 'organization' : 'personal';
    const id = cleanStr(item?.id);
    if (!id) return;

    const snap = state.patchInCache(s, id, (prev) => ({
      ...prev,
      trashedAt: trashed ? new Date().toISOString() : '',
      // Same shape the server sends back: a display pair, not a name
      // (D22). Optimistic only — the response replaces it.
      trashedBy: trashed ? { id: null, displayName: 'you' } : null,
      isTrashed: !!trashed,
    }));
    rerender?.();

    try {
      const updated = await api(
        `/api/slide-library/${s}/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: { trashed: !!trashed },
        },
      );
      const arr = state.getCache(s);
      const idx = arr.findIndex((x) => String(x?.id || '') === id);
      if (idx >= 0) arr[idx] = updated;
      rerender?.();
    } catch (e) {
      if (snap?.ok) {
        state.patchInCache(s, id, () => snap.prev);
        rerender?.();
      }
      toast.error(e);
    }
  };

  const saveDescription = async (shelf, item, newDesc) => {
    const s = shelf === 'organization' ? 'organization' : 'personal';
    try {
      const updated = await api(
        `/api/slide-library/${s}/${encodeURIComponent(item.id)}`,
        {
          method: 'PATCH',
          headers: ifMatch(item),
          body: { description: newDesc },
        },
      );
      item.description = newDesc;
      // The write raised the revision; the next edit must match the new one.
      item.revision = updated?.revision;
      return { ok: true };
    } catch (err) {
      console.error('Failed to save description:', err);
      return { ok: false, error: err };
    }
  };

  const saveTags = async (shelf, item, newTags) => {
    const s = shelf === 'organization' ? 'organization' : 'personal';
    try {
      const result = await api(
        `/api/slide-library/${s}/${encodeURIComponent(item.id)}/tags`,
        {
          method: 'PUT',
          body: { tags: newTags },
        },
      );
      item.tags = result;
      return { ok: true, tags: result };
    } catch (err) {
      console.error('Failed to save tags:', err);
      return { ok: false, error: err };
    }
  };

  const saveSlide = async (shelf, item, patch, { rerender } = {}) => {
    const s = shelf === 'organization' ? 'organization' : 'personal';
    const id = cleanStr(item?.id);
    if (!id) return { ok: false, error: new Error('Missing item id') };

    try {
      const updated = await api(
        `/api/slide-library/${s}/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: ifMatch(item),
          body: patch,
        },
      );
      // Update cache
      const arr = state.getCache(s);
      const idx = arr.findIndex((x) => String(x?.id || '') === id);
      if (idx >= 0) arr[idx] = updated;
      rerender?.();
      return { ok: true, item: updated };
    } catch (err) {
      console.error('Failed to save slide:', err);
      return { ok: false, error: err };
    }
  };

  /**
   * Copy `item` to `shelf` — the one copy action (D183). The create carries
   * the whole record (`copyPayload`); the tags follow in a second write,
   * because they are a relation rather than a create field. A copy that lands
   * without its tags says so: the item exists, so it is a passing failure of a
   * side of the action, not a refusal of it.
   * @param {'personal'|'organization'} shelf - The destination shelf
   * @param {object} item - The item being copied
   * @returns {Promise<{ok: true, item: object} | {ok: false, error: any}>}
   */
  const copyItemTo = async (shelf, item) => {
    const s = shelf === 'organization' ? 'organization' : 'personal';
    const body = copyPayload(item, themeIdNorm);
    if (!body.name || !body.slideType) {
      return { ok: false, error: new Error('Missing name or slide type') };
    }

    let created;
    try {
      created = await api(`/api/slide-library/${s}`, {
        method: 'POST',
        body,
      });
    } catch (err) {
      return { ok: false, error: err };
    }

    const tagNames = tagNamesOf(item);
    if (tagNames.length > 0) {
      const tagged = await saveTags(s, created, tagNames);
      if (!tagged.ok) {
        toast.error(
          t(
            'slideLibrary.copy.tagsFailed',
            'The slide was copied, but its tags were not.',
          ),
        );
      }
    }
    return { ok: true, item: created };
  };

  const pushToTeam = async (item) => {
    const r = await copyItemTo('organization', item);
    if (!r.ok) return toast.error(r.error);
    toast.success(t('slideLibrary.addedToTeam', 'Added to team library.'));
    await fetchShelf('organization');
  };

  /**
   * Copy an item to the caller's personal shelf. The way to work on a shared
   * slide you may not change (D170).
   * @returns {Promise<{ok: true, item: object} | {ok: false, error: any}>}
   */
  const duplicateToPersonal = async (item, { rerender } = {}) => {
    const r = await copyItemTo('personal', item);
    if (!r.ok) return r;
    state.setCache('personal', [r.item, ...state.getCache('personal')]);
    rerender?.();
    return r;
  };

  const pushMultipleToTeam = async (items, { rerender } = {}) => {
    let successCount = 0;
    for (const item of items) {
      const r = await copyItemTo('organization', item);
      if (r.ok) successCount++;
      else console.error('Failed to push item to team:', r.error);
    }
    if (successCount > 0) {
      toast.success(
        t(
          'slideLibrary.addedToTeamCount',
          'Added {count} slides to team library.',
          {
            count: successCount,
          },
        ),
      );
      await fetchShelf('organization');
    }
    rerender?.();
    return successCount;
  };

  return {
    fetchShelf,
    toggleFavorite,
    setTrashed,
    pushToTeam,
    pushMultipleToTeam,
    saveDescription,
    saveTags,
    saveSlide,
    duplicateToPersonal,
  };
}
