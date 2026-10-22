/**
 * A small XML tree reader for the parts of a PowerPoint package (B828).
 *
 * The page model needs more than the text runs `pptx-text.js` reads: shapes
 * nest in groups, a paragraph's style comes from four levels of list styles,
 * a table's cells sit in rows. A tree is the honest shape for that, and the
 * parts are machine-written OOXML: no DTD, no external entities, namespaces
 * only as prefixes. So this reader keeps qualified names as they are
 * (`p:sp`, `a:t`), collects character data per element, and decodes entities
 * through the one decoder the PPTX readers share. It throws on nothing:
 * a malformed part gives a shorter tree, never an exception.
 */

import { decodeXmlEntities } from '../convert-file/index.js';

/**
 * @typedef {object} XmlElement
 * @property {string} name - the qualified name, e.g. `a:p`
 * @property {Record<string, string>} attrs - decoded attribute values
 * @property {XmlElement[]} children
 * @property {string} text - the element's own character data, decoded
 */

// A start tag's attributes are read quote-aware: a `>` may stand unescaped
// in an attribute value (a picture's description, say).
const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Parse an XML document into its root element.
 *
 * @param {string} xml
 * @returns {XmlElement} the root; an empty `#document` element for no input
 */
export function parseXml(xml) {
  const doc = element('#document', {});
  const stack = [doc];
  for (const m of String(xml || '').matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      const at = stack.findLastIndex((el) => el.name === m[2]);
      if (at > 0) stack.length = at;
    } else if (m[3] !== undefined) {
      const el = element(m[3], readAttrs(m[4]));
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.text += decodeXmlEntities(m[6]);
  }
  return doc.children[0] || doc;
}

function element(name, attrs) {
  return { name, attrs, children: [], text: '' };
}

function readAttrs(source) {
  const attrs = {};
  for (const m of source.matchAll(ATTR)) {
    attrs[m[1]] = decodeXmlEntities(m[2] ?? m[3]);
  }
  return attrs;
}

/**
 * The first child element with this name.
 *
 * @param {XmlElement | null | undefined} el
 * @param {string} name
 * @returns {XmlElement | null}
 */
export function child(el, name) {
  return el?.children.find((c) => c.name === name) || null;
}

/**
 * Every child element with this name.
 *
 * @param {XmlElement | null | undefined} el
 * @param {string} name
 * @returns {XmlElement[]}
 */
export function childrenNamed(el, name) {
  return el ? el.children.filter((c) => c.name === name) : [];
}

/**
 * Follow a path of child names: `path(sp, 'p:spPr', 'a:xfrm', 'a:off')`.
 *
 * @param {XmlElement | null | undefined} el
 * @param {...string} names
 * @returns {XmlElement | null}
 */
export function path(el, ...names) {
  let at = el || null;
  for (const name of names) at = child(at, name);
  return at;
}

/**
 * A numeric attribute, or `fallback` when it is missing or not a number.
 *
 * @param {XmlElement | null | undefined} el
 * @param {string} name
 * @param {number} [fallback]
 * @returns {number | undefined}
 */
export function numAttr(el, name, fallback) {
  const value = Number(el?.attrs[name]);
  return el && el.attrs[name] !== undefined && Number.isFinite(value)
    ? value
    : fallback;
}

/**
 * An OOXML boolean attribute (`1`/`true`, `0`/`false`), or undefined.
 *
 * @param {XmlElement | null | undefined} el
 * @param {string} name
 * @returns {boolean | undefined}
 */
export function boolAttr(el, name) {
  const value = el?.attrs[name];
  if (value === undefined) return undefined;
  return value === '1' || value === 'true';
}
