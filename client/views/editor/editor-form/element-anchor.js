/**
 * The selected canvas element ({kind, idx, fieldKey}) held on its item, not
 * on its index (B894).
 *
 * A collaborator who moves rows changes the list under the selection: the
 * index then names whatever item took the place, and the inspector's "This
 * card" and the canvas highlight follow that one. The anchor remembers the
 * list as it stood and, after a doc-driven change, finds the item again by
 * the collection editor's identity rule (`locateItem`, DY-781); an item that
 * cannot be found clears the selection. A card selected through one of its
 * text fields carries that field's path (`rows.0.title`); its index moves
 * along.
 *
 * Only an element whose type declares the list it indexes (`elementTab.<kind>
 * .list`) is anchored. A text selection or a fixed slot range has no item to
 * follow and passes through unchanged.
 */
import { locateItem } from './collection-editor.js';
import { slideTypeElementTab } from '../../../../shared/slide-types/inline-edit-companions.js';

/**
 * @param {Object} o
 * @param {Function} o.getSlide - () => the selected slide, or null
 * @param {Object} [o.slideTypes] - the editor's slide-type metadata, so a
 *   fork type's own declaration is heard
 * @returns {{get: Function, set: Function, refresh: Function, follow: Function}}
 */
export function createElementAnchor({ getSlide, slideTypes = null }) {
  let selected = null;
  // Per item of the list as it last stood: its index and its value.
  let rows = null;

  // The content key of the list the selection indexes, or null.
  const listKey = (sel) => {
    const slide = getSlide();
    if (!slide || !sel) return null;
    const key = slideTypeElementTab(
      slide.type,
      slideTypes?.[slide.type] || null,
    )?.[sel.kind]?.list;
    return typeof key === 'string' ? key : null;
  };

  const listOf = (sel) => {
    const key = listKey(sel);
    const list = key ? getSlide().content?.[key] : null;
    return Array.isArray(list) ? list : null;
  };

  // `rows.<from>.title` → `rows.<to>.title`; any other path stays.
  const movePath = (path, key, from, to) => {
    if (typeof path !== 'string') return path;
    const head = `${key}.${from}`;
    return path === head || path.startsWith(`${head}.`)
      ? `${key}.${to}${path.slice(head.length)}`
      : path;
  };

  const snapshot = () => {
    const list = listOf(selected);
    const idx = selected?.idx;
    rows =
      list && Number.isInteger(idx) && idx >= 0 && idx < list.length
        ? list.map((it, at) => ({ at, shown: structuredClone(it) }))
        : null;
  };

  return {
    /** @returns {Object|null} the selection */
    get: () => selected,

    /** Select an element (or clear with null), anchored to the list as it is. */
    set(sel) {
      selected = sel || null;
      snapshot();
    },

    /**
     * A local edit: the selection stays where the user put it, and the list
     * as it now stands is what the next doc-driven change is measured from.
     */
    refresh() {
      if (selected) snapshot();
    },

    /**
     * A doc-driven change (a peer, undo/redo): find the item again.
     *
     * @returns {boolean} whether the selection moved or was cleared
     */
    follow() {
      if (!selected || !rows) return false;
      const list = listOf(selected);
      const at = list ? locateItem(list, rows, selected.idx) : -1;
      if (at < 0) {
        selected = null;
        rows = null;
        return true;
      }
      const moved = at !== selected.idx;
      if (moved) {
        const next = { ...selected, idx: at };
        if ('fieldKey' in selected) {
          next.fieldKey = movePath(
            selected.fieldKey,
            listKey(selected),
            selected.idx,
            at,
          );
        }
        selected = next;
      }
      snapshot();
      return moved;
    },
  };
}
