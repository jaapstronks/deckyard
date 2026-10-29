/**
 * Mirror a structural edit of one collection from the active language version
 * into every other one, so each item keeps its own translation (DY-773).
 *
 * Language versions of a slide are matched item by item on position: the
 * save-time sync (`syncStructureInto` in views/editor/save-manager.js) keeps
 * every version's texts at the index they sit on and lets the active version
 * decide the count. That is right for an edit and for an item added at the
 * end, and wrong for anything that shifts items: removing item 4 of 8 left
 * the other version with items 1-7, so every text after the gap belonged to
 * the next item, and a reorder never reached the other version at all.
 *
 * So a remove or a move is applied to every other version at the moment it
 * happens, on the same path, before the edit is saved. Afterwards the
 * positions agree again and the positional sync is correct. An index the
 * other version does not have yet (an item added since the last save) is
 * left to that sync, which pads the version to the active count.
 *
 * Nothing in here reads the DOM; the callers own the active-version edit,
 * `markDirty` and the refresh. Undo snapshots the whole presentation, the
 * other versions included, so a mirrored edit undoes with the edit itself.
 */

import { valueAtPath } from '../../../shared/slide-types/text-fields.js';

/**
 * @typedef {{kind: 'remove', index: number}
 *   | {kind: 'move', from: number, to: number}
 *   | {kind: 'swap', a: number, b: number}} CollectionOp
 */

/**
 * Apply one structural collection edit to a copy of `arr`.
 * @param {Array} arr - The collection in one non-active version
 * @param {CollectionOp} op
 * @returns {Array|null} The edited copy, or null when nothing changes
 */
function applyOp(arr, op) {
  const next = arr.slice();
  const len = next.length;
  if (op.kind === 'remove') {
    if (op.index < 0 || op.index >= len) return null;
    next.splice(op.index, 1);
    return next;
  }
  if (op.kind === 'move') {
    const { from, to } = op;
    if (from === to || from < 0 || to < 0) return null;
    if (from < len) {
      const [item] = next.splice(from, 1);
      next.splice(Math.min(to, next.length), 0, item);
      return next;
    }
    // The moved item is new since the last save: this version has no text
    // for it yet. Give it an empty slot at its new place, so the items after
    // it shift exactly as they did in the active version.
    if (to >= len) return null;
    next.splice(to, 0, {});
    return next;
  }
  if (op.kind === 'swap') {
    const { a, b } = op;
    if (a === b || a < 0 || b < 0 || a >= len || b >= len) return null;
    [next[a], next[b]] = [next[b], next[a]];
    return next;
  }
  return null;
}

/**
 * Apply a remove, move or swap of the collection at `path` on slide
 * `slideId` to every language version except the active one.
 *
 * Call it once per structural edit, next to the edit of the active version;
 * which of the two runs first does not matter. A deck with one version, a
 * version without that slide and a version without that collection are
 * left alone.
 *
 * @param {Object} pres - The presentation being edited (`pres.i18n.versions`)
 * @param {string} slideId - The slide holding the collection
 * @param {Array<string|number>} path - The collection's path in slide content,
 *   e.g. `['items']` or `['rows', 0, 'blocks']`
 * @param {CollectionOp} op
 */
export function mirrorCollectionOp(pres, slideId, path, op) {
  const versions = pres?.i18n?.versions;
  if (!versions || typeof versions !== 'object' || !slideId) return;
  if (!Array.isArray(path) || !path.length || !op) return;
  const active = pres.i18n.active;
  for (const [lang, version] of Object.entries(versions)) {
    if (lang === active || !Array.isArray(version?.slides)) continue;
    // The active buffer itself: already edited by the caller.
    if (version.slides === pres.slides) continue;
    const slide = version.slides.find((s) => s?.id === slideId);
    const parent = valueAtPath(slide?.content, path.slice(0, -1));
    const key = path.at(-1);
    if (!parent || typeof parent !== 'object' || !Array.isArray(parent[key]))
      continue;
    const next = applyOp(parent[key], op);
    if (next) parent[key] = next;
  }
}
