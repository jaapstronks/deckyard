/**
 * Custom-HTML capability gate for the collab doc (security backstop).
 *
 * The REST/MCP write path gates raw HTML/CSS edits on `custom-html-slide`s
 * behind the narrow `canEditCustomHtml` capability (route-middleware
 * `customHtmlEditViolation`). A shared CRDT doc has no single actor at store
 * time, so that store-level check can't attribute an edit to a user — a
 * write-capable-but-not-custom-html-capable collaborator could otherwise
 * author arbitrary HTML/CSS straight into the doc (stored XSS against every
 * viewer/presenter, exactly what the capability exists to freeze).
 *
 * This closes the gap at ingress instead: Hocuspocus' `onChange` fires per
 * update with the originating connection's `context` (hence the editing
 * user). We keep a per-document snapshot of every custom-html slide's raw
 * `html`/`css`, and when a change from a non-capable user touches those
 * fields we revert them to the snapshot in a server transaction (which
 * re-syncs the revert to all clients). Capable users' edits (and
 * server-origin writes, already gated by the REST route) update the snapshot
 * instead. `html`/`css` are plain LWW fields in the codec (slide-type field
 * `type: 'code'`), so this is a plain-value compare/restore.
 *
 * Baseline for a field with no prior value is the empty string: creating raw
 * HTML on a fresh custom-html slide is gated too (parity with
 * `customHtmlEditViolation`, which treats absent as '').
 */

/** Transaction origin for guard-driven reverts (not a connection/local). */
export const CUSTOM_HTML_GUARD_ORIGIN = { source: 'custom-html-guard' };

/** Read a plain/Y.Text field as a string; null for an unexpected shape. */
function readStringField(value, Y) {
  if (typeof value === 'string') return value;
  if (value instanceof Y.Text) return value.toString();
  if (value === undefined) return '';
  // A Y.Map/Y.Array here would mean a non-plain encoding this codebase never
  // produces for html/css — don't touch it.
  return null;
}

/**
 * Snapshot every custom-html slide's raw html/css from a doc.
 * @param {Object} document - Y.Doc
 * @param {Object} Y - yjs namespace
 * @returns {Map<string, {html: string, css: string}>} keyed by slide id
 */
export function extractCustomHtml(document, Y) {
  const map = new Map();
  for (const ys of document.getArray('slides').toArray()) {
    if (!(ys instanceof Y.Map) || ys.get('type') !== 'custom-html-slide') continue;
    const id = ys.get('id');
    if (typeof id !== 'string' || !id) continue;
    const yc = ys.get('content');
    const html = yc instanceof Y.Map ? readStringField(yc.get('html'), Y) : '';
    const css = yc instanceof Y.Map ? readStringField(yc.get('css'), Y) : '';
    map.set(id, { html: html ?? '', css: css ?? '' });
  }
  return map;
}

/**
 * Enforce the custom-html gate for one observed change.
 *
 * @param {Object} document - Y.Doc that just changed
 * @param {Map<string,{html,css}>|undefined} prevSnapshot - last good state
 * @param {Object} opts
 * @param {boolean} opts.allowed - editor may author raw HTML/CSS
 * @param {Object} opts.Y - yjs namespace
 * @returns {{snapshot: Map<string,{html,css}>, reverted: boolean}}
 */
export function guardCustomHtml(document, prevSnapshot, { allowed, Y }) {
  const current = extractCustomHtml(document, Y);
  // Capable editor, server-origin write, or no baseline to compare against:
  // accept and (re)snapshot. Reverting without a baseline could destroy a
  // legitimately-loaded value.
  if (allowed || !prevSnapshot) return { snapshot: current, reverted: false };

  let reverted = false;
  document.transact(() => {
    for (const ys of document.getArray('slides').toArray()) {
      if (!(ys instanceof Y.Map) || ys.get('type') !== 'custom-html-slide') continue;
      const id = ys.get('id');
      if (typeof id !== 'string' || !id) continue;
      const yc = ys.get('content');
      if (!(yc instanceof Y.Map)) continue;
      const good = prevSnapshot.get(id);
      for (const key of ['html', 'css']) {
        const cur = readStringField(yc.get(key), Y);
        if (cur === null) continue; // unexpected shape — leave alone
        const goodVal = good ? good[key] : '';
        if (cur === goodVal) continue;
        if (goodVal === '') {
          if (yc.has(key)) yc.delete(key);
        } else {
          yc.set(key, goodVal);
        }
        reverted = true;
      }
    }
  }, CUSTOM_HTML_GUARD_ORIGIN);

  // The doc now matches prevSnapshot again: keep it as the good baseline.
  return { snapshot: prevSnapshot, reverted };
}
