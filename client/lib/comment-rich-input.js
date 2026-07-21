/**
 * Rich comment composer: a contenteditable that shows @mentions as atomic
 * chips *while typing*, instead of the raw `@[Name](user:email)` markup.
 *
 * The canonical storage format does not change. `getValue()` serialises the
 * DOM back to exactly the same markup string the old textarea produced, so the
 * server (`parseMentions`) and every read surface (`comment-body.js`) stay
 * untouched. `setValue()` is the inverse, so an existing body re-hydrates into
 * chips.
 *
 * Chips are `contenteditable="false"` and carry the mention on data
 * attributes. They are treated as single characters: backspace right after a
 * chip removes the whole chip, and the caret steps over it rather than into it.
 *
 * Paste is forced to plain text — pasted HTML would otherwise land in the
 * composer and end up in the serialised body.
 */

import { h } from './dom.js';
import {
  splitCommentSegments,
  mentionMarkup,
  linkMarkup,
  safeLinkUrl,
} from '../../shared/comment-mentions.js';

/** Marks a node as a mention chip. */
const CHIP_SELECTOR = '[data-mention-email]';

/** Marks a node as a link. Its text stays editable; the URL is metadata. */
const LINK_SELECTOR = '[data-link-url]';

/**
 * Build one mention chip node.
 * @param {{name: string, email: string}} mention
 * @returns {HTMLElement}
 */
export function createMentionChip({ name, email }) {
  const displayName = String(name || email || '');
  return h('span', {
    class: 'comment-mention-chip comment-mention-chip-input',
    contenteditable: 'false',
    'data-mention-email': String(email || ''),
    'data-mention-name': displayName,
    title: String(email || ''),
    text: `@${displayName}`,
  });
}

/** @returns {boolean} true if the node is a mention chip element. */
function isChip(node) {
  return node?.nodeType === 1 && node.matches?.(CHIP_SELECTOR);
}

/** @returns {boolean} true if the node is a link element. */
function isLink(node) {
  return node?.nodeType === 1 && node.matches?.(LINK_SELECTOR);
}

/**
 * Build one link node for the composer.
 *
 * Unlike a mention chip this is **not** atomic: the label stays editable, so
 * you can retype the words without reopening a dialog. The URL rides along on
 * a data attribute and is what serialisation reads back.
 *
 * No `href` on purpose: this anchor lives inside a contenteditable, and a real
 * `href` lets a stray Cmd/Ctrl+click navigate away mid-compose. The URL lives
 * on `data-link-url` (what serialisation reads) and `title` (what the user
 * sees on hover); the `.comment-body-link` styling does not depend on `href`.
 *
 * @param {{label: string, url: string}} link
 * @returns {HTMLElement}
 */
export function createLinkNode({ label, url }) {
  return h('a', {
    class: 'comment-body-link comment-link-input',
    'data-link-url': url,
    title: url,
    text: String(label || ''),
  });
}

/**
 * Serialise composer DOM back to canonical markup.
 *
 * Contenteditable produces `<br>` for line breaks and, depending on the
 * browser and on pasted content, wraps lines in block elements. Both become a
 * single `\n`.
 *
 * @param {Node} root - The contenteditable element.
 * @returns {string} Body with `@[Name](user:email)` markup.
 */
export function serializeRichInput(root) {
  const parts = [];

  /** Append a newline unless we are at the very start or already ended one. */
  const pushBreak = () => {
    if (parts.length === 0) return;
    if (parts[parts.length - 1].endsWith('\n')) return;
    parts.push('\n');
  };

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        parts.push(child.data);
        continue;
      }
      if (child.nodeType !== 1) continue;

      if (isChip(child)) {
        parts.push(
          mentionMarkup({
            name: child.getAttribute('data-mention-name') || '',
            email: child.getAttribute('data-mention-email') || '',
          })
        );
        continue;
      }

      if (isLink(child)) {
        // The label is whatever the user left in the node; an emptied link
        // carries no text to click, so it collapses to nothing.
        const label = child.textContent || '';
        if (label.trim()) {
          parts.push(linkMarkup({ label, url: child.getAttribute('data-link-url') || '' }));
        }
        continue;
      }

      const tag = child.tagName;
      if (tag === 'BR') {
        // A *trailing* <br> is the browser's filler that makes an empty last
        // line visible and caret-addressable. It carries no content of its
        // own, so it must not produce a newline — `deserializeRichInput`
        // emits the same filler, which keeps the round-trip exact.
        if (child.nextSibling) parts.push('\n');
        continue;
      }

      // Block-level wrappers (DIV/P from Enter or paste) open a new line.
      // Only ever *before* the block: closing one at the end of the input
      // would append a newline the user never typed.
      if (tag === 'DIV' || tag === 'P') pushBreak();
      walk(child);
    }
  };

  walk(root);
  return parts.join('');
}

/**
 * Build composer DOM from canonical markup (inverse of serialize).
 * @param {string} body
 * @returns {Array<Node|string>} Nodes ready for `el.append(...)`.
 */
export function deserializeRichInput(body) {
  const nodes = [];
  for (const seg of splitCommentSegments(body)) {
    if (seg.type === 'mention') {
      nodes.push(createMentionChip(seg));
      continue;
    }
    if (seg.type === 'link') {
      nodes.push(createLinkNode(seg));
      continue;
    }
    // Text keeps its newlines, which become <br> in the composer.
    const lines = String(seg.text).split('\n');
    lines.forEach((line, i) => {
      if (i > 0) nodes.push(h('br'));
      if (line) nodes.push(document.createTextNode(line));
    });
  }
  // A body ending in a newline leaves a trailing <br>, which on its own is
  // invisible and un-clickable. Browsers solve this with a filler <br>; the
  // serialiser ignores trailing <br>s, so emitting one here is symmetric.
  if (nodes[nodes.length - 1]?.tagName === 'BR') nodes.push(h('br'));
  return nodes;
}

/**
 * Create a rich comment composer.
 *
 * @param {Object} options
 * @param {string} [options.placeholder] - Shown while empty (CSS ::before).
 * @param {string} [options.ariaLabel] - Accessible name; defaults to placeholder.
 * @param {string} [options.className] - Extra class on the editable element.
 * @param {Function} [options.onSubmit] - Called on Enter (without Shift).
 * @param {Function} [options.isSubmitBlocked] - () => boolean; when true, Enter
 *   is left alone (the mention popover uses this to claim Enter for picking).
 * @returns {{el: HTMLElement, getValue: Function, setValue: Function,
 *   clear: Function, focus: Function, isEmpty: Function,
 *   insertMention: Function, getTextBeforeCaret: Function,
 *   replaceQueryWithMention: Function}}
 */
export function createRichCommentInput({
  placeholder = '',
  ariaLabel = '',
  className = '',
  onSubmit,
  isSubmitBlocked,
} = {}) {
  const el = h('div', {
    class: `comment-rich-input${className ? ` ${className}` : ''}`,
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': ariaLabel || placeholder || '',
    'data-placeholder': placeholder,
  });

  /**
   * A selection snapshot taken before focus leaves the composer.
   *
   * Anything that opens a dialog (the link button) collapses the live
   * selection the moment focus moves, so the caller takes a snapshot first —
   * see `rememberSelection`. Kept explicit rather than tracked continuously:
   * a `selectionchange` listener lives on `document`, and reply composers are
   * created and thrown away on every Reply toggle, so that would leak one
   * listener per toggle.
   */
  let rememberedRange = null;

  /** Live selection, but only when it lives inside this composer. */
  function liveRange() {
    const sel = document.getSelection?.();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;
    return range;
  }

  /** The snapshot, if one was taken and is still valid. */
  function snapshotRange() {
    // Only usable while its nodes are still in the DOM.
    if (rememberedRange && el.contains(rememberedRange.startContainer)) {
      return rememberedRange;
    }
    return null;
  }

  /**
   * A snapshot wins over the live selection when one was deliberately taken.
   *
   * Closing a modal restores focus to whatever had it before, and focusing a
   * contenteditable puts a fresh caret at its start — a perfectly live
   * selection that is not the one the user made. Preferring the snapshot is
   * what keeps "select a word, click Link" from inserting at position 0.
   */
  function currentRange() {
    return snapshotRange() || liveRange();
  }

  /**
   * Snapshot the current selection so it survives losing focus. Call this
   * before opening anything that takes focus away from the composer.
   */
  function rememberSelection() {
    const live = liveRange();
    rememberedRange = live ? live.cloneRange() : null;
    return !!rememberedRange;
  }

  /**
   * Drop the snapshot. It is meant to bridge one focus excursion, so anything
   * that proves the user is back in the composer invalidates it — otherwise a
   * stale range would hijack the next mention insert or backspace.
   */
  function forgetSelection() {
    rememberedRange = null;
  }

  el.addEventListener('keydown', forgetSelection);
  el.addEventListener('mousedown', forgetSelection);

  function placeCaretAfter(node) {
    const sel = document.getSelection?.();
    if (!sel) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }


  /**
   * Text from the start of the composer up to the caret, with chips counted
   * as their rendered `@Name` text. Used by the mention autocomplete to find
   * the `@query` being typed.
   * @returns {string}
   */
  function getTextBeforeCaret() {
    const range = currentRange();
    if (!range) return '';
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString();
  }

  /**
   * Replace the `@query` immediately before the caret with a mention chip.
   * @param {number} queryLength - Length of the query after the '@'.
   * @param {{name: string, email: string}} user
   * @returns {boolean} false when the caret moved and nothing was replaced.
   */
  function replaceQueryWithMention(queryLength, user) {
    const range = currentRange();
    if (!range || !range.collapsed) return false;

    const node = range.startContainer;
    const offset = range.startOffset;
    // The '@' plus the query must sit in the text node before the caret.
    const consume = queryLength + 1;
    if (node.nodeType !== 3 || offset < consume) return false;
    if (node.data.slice(offset - consume, offset - queryLength) !== '@') return false;

    const del = document.createRange();
    del.setStart(node, offset - consume);
    del.setEnd(node, offset);
    del.deleteContents();

    const chip = createMentionChip(user);
    // A trailing space keeps typing natural and stops the caret from being
    // trapped against the chip's right edge.
    const space = document.createTextNode(' ');
    del.insertNode(space);
    del.insertNode(chip);
    placeCaretAfter(space);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    return true;
  }

  /**
   * The plain text currently selected inside the composer, or '' when the
   * selection is empty or lives elsewhere. Used to seed the link label.
   * @returns {string}
   */
  function getSelectedText() {
    const range = currentRange();
    if (!range || range.collapsed) return '';
    return range.toString();
  }

  /**
   * Turn the current selection into a link, or insert a new one at the caret.
   *
   * @param {{label?: string, url: string}} link
   * @returns {boolean} false when the URL is not usable
   */
  function applyLink({ label, url }) {
    const safe = safeLinkUrl(url);
    if (!safe) return false;

    const range = currentRange();
    const selected = range && !range.collapsed ? range.toString() : '';
    const text = String(label || selected || safe).trim();
    const node = createLinkNode({ label: text, url: safe });

    if (range) {
      // Replacing a selection drops the link where words already are, so it
      // needs no padding; inserting at a bare caret does, otherwise the caret
      // is stuck inside the link and further typing extends the label.
      const wasCollapsed = range.collapsed;
      range.deleteContents();
      const tail = wasCollapsed ? document.createTextNode(' ') : null;
      if (tail) range.insertNode(tail);
      range.insertNode(node);
      placeCaretAfter(tail || node);
    } else {
      el.append(node, document.createTextNode(' '));
    }
    forgetSelection();
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    return true;
  }

  /** Insert a mention chip at the caret (no query to replace). */
  function insertMention(user) {
    const range = currentRange();
    const chip = createMentionChip(user);
    const space = document.createTextNode(' ');
    if (range) {
      range.deleteContents();
      range.insertNode(space);
      range.insertNode(chip);
    } else {
      el.append(chip, space);
    }
    placeCaretAfter(space);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  /**
   * Backspace directly after a chip removes the chip as a unit. Without this
   * the browser may step into the chip's text and shred it character by
   * character.
   */
  function handleBackspace(e) {
    const range = currentRange();
    if (!range || !range.collapsed) return;
    const node = range.startContainer;
    const offset = range.startOffset;

    let target = null;
    if (node.nodeType === 3 && offset === 0) {
      target = node.previousSibling;
    } else if (node.nodeType === 1) {
      target = node.childNodes[offset - 1] || null;
    }
    // Skip the cosmetic space we insert after a chip.
    if (target?.nodeType === 3 && target.data === ' ') {
      const prev = target.previousSibling;
      if (isChip(prev)) {
        e.preventDefault();
        target.remove();
        prev.remove();
        el.dispatchEvent(new window.Event('input', { bubbles: true }));
        return;
      }
    }
    if (isChip(target)) {
      e.preventDefault();
      target.remove();
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
  }

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // The mention popover claims Enter to pick a user.
      if (isSubmitBlocked?.()) return;
      e.preventDefault();
      onSubmit?.();
      return;
    }
    // Shift+Enter is left to the browser on purpose. In a contenteditable it
    // already inserts a plain <br> (blocks only come from *plain* Enter, which
    // we intercept above) and it gets the caret placement right. Hand-rolling
    // it does not: a caret anchored between children — or inside an empty text
    // node — is normalised back into the preceding text, so the next keystroke
    // lands on the wrong side of the break and the newline silently vanishes.
    if (e.key === 'Backspace') handleBackspace(e);
  });

  // Never let HTML into the composer.
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    const range = currentRange();
    if (!range) return;
    range.deleteContents();
    const frag = document.createDocumentFragment();
    frag.append(...deserializeRichInput(text));
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) placeCaretAfter(last);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });

  return {
    el,
    getValue: () => serializeRichInput(el),
    setValue: (body) => {
      el.replaceChildren(...deserializeRichInput(body || ''));
    },
    clear: () => {
      el.replaceChildren();
    },
    focus: () => el.focus(),
    isEmpty: () => serializeRichInput(el).trim() === '',
    insertMention,
    getTextBeforeCaret,
    replaceQueryWithMention,
    getSelectedText,
    rememberSelection,
    applyLink,
  };
}
