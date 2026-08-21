/**
 * The one XML escaper.
 *
 * Distinct from `escapeHtml` (`shared/slide-types/helpers.js`) only in the
 * apostrophe entity: XML defines `&apos;`, HTML 4 does not, so HTML sinks use
 * the numeric `&#039;`. Two sinks need the XML spelling — PPTX note parts
 * (`server/export/notes.js`) and the author-overlay SVG
 * (`server/utils/author-overlay.js`) — and they used to carry a byte-identical
 * private copy each.
 *
 * @param {unknown} s - Value to escape
 * @returns {string} The value with XML metacharacters replaced by entities
 */
export function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
