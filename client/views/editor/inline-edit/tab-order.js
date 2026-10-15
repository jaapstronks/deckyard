/**
 * Tab order on the canvas (B704): Tab/Shift-Tab during an inline edit walks
 * every editable field and every ghost of the slide in schema order.
 *
 * Pure: the inline editor collects the stops (the rendered
 * `data-inline-field` elements and the ghost chips it would place) and asks
 * this module where Tab goes. Schema order, not DOM order, because ghosts
 * live on the overlay and have no place in the slide's DOM; and because the
 * schema is the one order every surface already shares (the inspector and the
 * bulk text form list fields the same way).
 */

/**
 * The position of a field path in its slide type's schema, as a sortable
 * tuple: `title` → `[0]`, `items.2.text` → `[4, 2, 1]`, nested
 * `rows.0.blocks.1.body` walks the nested `itemFields`. A segment the schema
 * does not know sorts last (`Infinity`), so an undeclared field keeps its DOM
 * place among the other unknowns rather than jumping ahead.
 * @param {Object} def - the slide type definition (`fields`)
 * @param {string} path - a field path as emitted in `data-inline-field`
 * @returns {number[]}
 */
export function schemaOrderKey(def, path) {
  const parts = String(path || '').split('.');
  const key = [];
  let fields = def?.fields || [];
  for (let i = 0; i < parts.length; i += 2) {
    const idx = fields.findIndex((f) => f?.key === parts[i]);
    if (idx < 0) {
      key.push(Infinity);
      break;
    }
    key.push(idx);
    if (i + 1 >= parts.length) break;
    key.push(/^\d+$/.test(parts[i + 1]) ? Number(parts[i + 1]) : Infinity);
    fields = fields[idx]?.itemFields || [];
  }
  return key;
}

function compareKeys(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * Order tab stops by schema position, one stop per path. When a path occurs
 * twice (a rendered field and a ghost for the same empty field), the first
 * one given wins, so callers list rendered fields before ghosts.
 * @template {{path:string}} T
 * @param {Object} def - the slide type definition
 * @param {T[]} stops
 * @returns {T[]}
 */
export function orderTabStops(def, stops) {
  const seen = new Set();
  const unique = [];
  for (const s of stops || []) {
    if (!s?.path || seen.has(s.path)) continue;
    seen.add(s.path);
    unique.push({ stop: s, key: schemaOrderKey(def, s.path) });
  }
  // Array.prototype.sort is stable: equal keys keep the order given.
  unique.sort((a, b) => compareKeys(a.key, b.key));
  return unique.map((u) => u.stop);
}

/**
 * The stop Tab (or Shift-Tab) moves to from `fromPath`. It wraps at both ends,
 * like Tab between placeholders in a presentation editor; Enter and Escape
 * are the ways out of the edit. A path that is not among the stops starts
 * from the edge: Tab goes to the first stop, Shift-Tab to the last.
 * @template {{path:string}} T
 * @param {T[]} ordered - from `orderTabStops`
 * @param {string} fromPath
 * @param {boolean} [backwards]
 * @returns {T | null}
 */
export function nextTabStop(ordered, fromPath, backwards = false) {
  const list = ordered || [];
  if (!list.length) return null;
  const at = list.findIndex((s) => s.path === fromPath);
  if (at < 0) return backwards ? list[list.length - 1] : list[0];
  const step = backwards ? -1 : 1;
  const next = list[(at + step + list.length) % list.length];
  return next.path === fromPath ? null : next;
}
