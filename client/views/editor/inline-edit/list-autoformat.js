/**
 * List autoformat for the rich (markdown) inline edit: Enter at the end of a
 * line typed as `1. text` or `- text` turns that line into a list item and
 * opens the next one, the way word processors do. Without it each typed line
 * stays a loose paragraph until the commit, so `1. a` / `2. b` only became a
 * list after blur (and, before the renderer joined loose lists, as two lists
 * both numbered 1).
 *
 * Once the caret is inside an <li>, Enter is the browser's own list
 * behaviour (next item; on an empty item, leave the list), so this only acts
 * on a line that isn't in a list yet.
 */

import { h } from '../../../lib/dom.js';

// The same two marker kinds the dialect parses (shared/markdown.js
// LIST_ITEM_RE), unindented: a typed line has no nesting to express.
const ORDERED_RE = /^(\d+)\.\s+(?=\S)/;
const UNORDERED_RE = /^[-*+]\s+(?=\S)/;

const LINE_BLOCKS = new Set(['P', 'DIV']);
// Elements that end a run of loose inline content typed into the field.
const INLINE_BOUNDARY = new Set([
  'BR',
  'P',
  'DIV',
  'UL',
  'OL',
  'H3',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
]);

/**
 * The line holding `node`, as the nodes that make it up: its <p>/<div> child
 * of `root`, or, for text typed straight into `root` (a freshly spawned,
 * empty field), the run of inline siblings around it.
 * @returns {{block: HTMLElement|null, nodes: Node[]}|null} null when the
 *   caret is in a list or another block kind.
 */
function lineOf(root, node) {
  let top = node;
  while (top && top.parentNode !== root) {
    if (top.nodeType === 1 && top.tagName === 'LI') return null;
    top = top.parentNode;
  }
  if (!top) return null;
  if (top.nodeType === 1 && LINE_BLOCKS.has(top.tagName)) {
    return top.querySelector('li') ? null : { block: top, nodes: [top] };
  }
  const isBoundary = (n) => n?.nodeType === 1 && INLINE_BOUNDARY.has(n.tagName);
  if (isBoundary(top)) return null;
  let first = top;
  while (first.previousSibling && !isBoundary(first.previousSibling)) {
    first = first.previousSibling;
  }
  const nodes = [];
  for (let n = first; n && !isBoundary(n); n = n.nextSibling) nodes.push(n);
  return { block: null, nodes };
}

/** True when no text follows the caret inside the line. */
function caretAtEnd(nodes, range) {
  const tail = range.cloneRange();
  tail.setEndAfter(nodes[nodes.length - 1]);
  return tail.toString().trim() === '';
}

/** Delete the first `count` characters of `el`'s text, across text nodes. */
function dropLeadingChars(el, count) {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* SHOW_TEXT */);
  let left = count;
  while (left > 0 && walker.nextNode()) {
    const n = walker.currentNode;
    const take = Math.min(left, n.nodeValue.length);
    n.nodeValue = n.nodeValue.slice(take);
    left -= take;
  }
}

/**
 * Handle Enter in a rich inline edit. Returns true when it turned the
 * caret's line into a list item and opened the next item (the caller then
 * prevents the browser default); false leaves Enter to the browser.
 * @param {HTMLElement} root - the contenteditable field
 * @param {Selection} selection
 * @returns {boolean}
 */
export function autoformatListOnEnter(root, selection) {
  if (!selection || selection.rangeCount !== 1) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !root.contains(range.startContainer)) return false;

  const line = lineOf(root, range.startContainer);
  if (!line || !line.nodes.length) return false;
  const text = line.nodes.map((n) => n.textContent).join('');
  const ordered = text.match(ORDERED_RE);
  const unordered = !ordered && text.match(UNORDERED_RE);
  if (!ordered && !unordered) return false;
  if (!caretAtEnd(line.nodes, range)) return false;

  const item = h('li');
  const anchor = line.nodes[0];
  // Rendered blocks are separated by newline text nodes; look past them.
  let prev = anchor.previousSibling;
  while (prev?.nodeType === 3 && !prev.nodeValue.trim()) {
    prev = prev.previousSibling;
  }
  if (line.block) {
    while (line.block.firstChild) item.appendChild(line.block.firstChild);
  } else {
    root.insertBefore(item, anchor);
    for (const n of line.nodes) item.appendChild(n);
  }
  dropLeadingChars(item, (ordered || unordered)[0].length);

  // Continue the list right above when it is the same kind (a `2.` typed
  // under an existing list joins it); otherwise start a new one.
  const tag = ordered ? 'OL' : 'UL';
  let list;
  if (prev?.nodeType === 1 && prev.tagName === tag) {
    list = prev;
  } else {
    list = h(tag.toLowerCase());
    const number = ordered ? parseInt(ordered[1], 10) : 1;
    if (number !== 1) list.setAttribute('start', String(number));
    root.insertBefore(list, line.block || item);
  }
  line.block?.remove();
  list.appendChild(item);

  const next = h('li', {}, [h('br')]);
  list.appendChild(next);
  const caret = root.ownerDocument.createRange();
  caret.setStart(next, 0);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  return true;
}
