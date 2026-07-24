/**
 * Slide Library API Operations
 * Handles API calls for the slide library picker
 */

import { toast } from '../dom/toast.js';
import { t } from '../ui-i18n.js';
import { cleanStr } from '../../../shared/string-utils.js';

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

  const fetchScope = async (scope) => {
    const s = scope === 'team' ? 'team' : 'personal';
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

  const toggleFavorite = async (scope, item, { rerender } = {}) => {
    const s = scope === 'team' ? 'team' : 'personal';
    const id = cleanStr(item?.id);
    if (!id) return;
    const current = s === 'team' ? !!item?.isFavorite : !!item?.favorite;
    const optimistic = !current;

    // Optimistic UI: update immediately, then reconcile with server response.
    const snap = state.patchInCache(s, id, (prev) => {
      if (s === 'team') return { ...prev, isFavorite: optimistic };
      return { ...prev, favorite: optimistic };
    });
    rerender?.();

    try {
      const updated = await api(`/api/slide-library/${s}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ favorite: !current }),
      });
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
      toast.error(String(e?.message || e));
    }
  };

  const setTrashed = async (scope, item, trashed, { rerender } = {}) => {
    const s = scope === 'team' ? 'team' : 'personal';
    const id = cleanStr(item?.id);
    if (!id) return;

    const snap = state.patchInCache(s, id, (prev) => ({
      ...prev,
      trashedAt: trashed ? new Date().toISOString() : '',
      trashedBy: trashed ? 'you' : '',
      isTrashed: !!trashed,
    }));
    rerender?.();

    try {
      const updated = await api(`/api/slide-library/${s}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ trashed: !!trashed }),
      });
      const arr = state.getCache(s);
      const idx = arr.findIndex((x) => String(x?.id || '') === id);
      if (idx >= 0) arr[idx] = updated;
      rerender?.();
    } catch (e) {
      if (snap?.ok) {
        state.patchInCache(s, id, () => snap.prev);
        rerender?.();
      }
      toast.error(String(e?.message || e));
    }
  };

  const pushToTeam = async (item) => {
    const name = cleanStr(item?.name);
    const slideType = cleanStr(item?.slideType);
    if (!name || !slideType) return;

    try {
      await api('/api/slide-library/team', {
        method: 'POST',
        body: JSON.stringify({
          name,
          slideType,
          content: item?.content || {},
          themeId: cleanStr(item?.themeId || themeIdNorm),
        }),
      });
      toast.success(t('slideLibrary.addedToTeam', 'Added to team library.'));
      await fetchScope('team');
    } catch (e) {
      toast.error(String(e?.message || e));
    }
  };

  const saveDescription = async (scope, item, newDesc) => {
    const s = scope === 'team' ? 'team' : 'personal';
    try {
      await api(`/api/slide-library/${s}/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: newDesc }),
      });
      item.description = newDesc;
      return { ok: true };
    } catch (err) {
      console.error('Failed to save description:', err);
      return { ok: false, error: err };
    }
  };

  const saveTags = async (scope, item, newTags) => {
    const s = scope === 'team' ? 'team' : 'personal';
    try {
      const result = await api(`/api/slide-library/${s}/${encodeURIComponent(item.id)}/tags`, {
        method: 'PUT',
        body: JSON.stringify(newTags),
      });
      item.tags = result;
      return { ok: true, tags: result };
    } catch (err) {
      console.error('Failed to save tags:', err);
      return { ok: false, error: err };
    }
  };

  const saveSlide = async (scope, item, patch, { rerender } = {}) => {
    const s = scope === 'team' ? 'team' : 'personal';
    const id = cleanStr(item?.id);
    if (!id) return { ok: false, error: new Error('Missing item id') };

    try {
      const updated = await api(`/api/slide-library/${s}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
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

  const pushMultipleToTeam = async (items, { rerender } = {}) => {
    let successCount = 0;
    for (const item of items) {
      try {
        await api('/api/slide-library/team', {
          method: 'POST',
          body: JSON.stringify({
            name: cleanStr(item?.name),
            description: cleanStr(item?.description),
            slideType: cleanStr(item?.slideType),
            content: item?.content || {},
            themeId: cleanStr(item?.themeId || themeIdNorm),
          }),
        });
        successCount++;
      } catch (e) {
        console.error('Failed to push item to team:', e);
      }
    }
    if (successCount > 0) {
      toast.success(`Added ${successCount} slide(s) to team library.`);
      await fetchScope('team');
    }
    rerender?.();
    return successCount;
  };

  return {
    fetchScope,
    toggleFavorite,
    setTrashed,
    pushToTeam,
    pushMultipleToTeam,
    saveDescription,
    saveTags,
    saveSlide,
  };
}