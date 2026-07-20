/**
 * Inline @-mention autocomplete for a comment composer.
 *
 * Typing `@` opens a popover under the field; the query is whatever follows
 * the `@` up to the caret. Selecting a user (mouse or ↑/↓ + Enter/Tab)
 * replaces `@query` with the mention.
 *
 * The caret layer is abstracted behind a small adapter so the same logic
 * drives both a plain `<textarea>` (which gets the raw
 * `@[Name](user:email)` markup spliced in) and the contenteditable rich
 * composer (which gets an atomic chip node). Everything else — the `@`
 * detection, search, ranking and keyboard nav — is shared.
 *
 * Search goes through /api/users/search (org-scoped); the deck's
 * collaborators (+ owner) rank first via the `priorityEmails` option.
 * Guests are not mentionable: they have no account, so they never appear
 * in the source.
 */

import { h, installDismissOnOutside } from './dom.js';
import { t } from './ui-i18n.js';
import { mentionMarkup } from '../../shared/comment-mentions.js';

const DEBOUNCE_MS = 200;

/**
 * Caret adapter for a plain textarea: the mention goes in as raw markup.
 * @param {HTMLTextAreaElement} textarea
 * @returns {{el: HTMLElement, getTextBeforeCaret: Function, replaceQueryWithMention: Function, focus: Function}}
 */
export function textareaCaretAdapter(textarea) {
  return {
    el: textarea,
    getTextBeforeCaret: () => textarea.value.slice(0, textarea.selectionStart),
    replaceQueryWithMention: (queryLength, user) => {
      const caret = textarea.selectionStart;
      const atStart = caret - queryLength - 1;
      if (atStart < 0 || textarea.value[atStart] !== '@') return false;
      const before = textarea.value.slice(0, atStart);
      const after = textarea.value.slice(caret);
      const markup = mentionMarkup({ name: user.name || user.email, email: user.email });
      textarea.value = `${before}${markup} ${after}`;
      const newCaret = before.length + markup.length + 1;
      textarea.setSelectionRange(newCaret, newCaret);
      return true;
    },
    focus: () => textarea.focus(),
  };
}

/**
 * Attach mention autocomplete to a composer.
 * @param {Object} options
 * @param {HTMLTextAreaElement} [options.textarea] - Target textarea (shorthand
 *   for passing the matching adapter)
 * @param {Object} [options.adapter] - Caret adapter (see
 *   `textareaCaretAdapter`; the rich input exposes the same shape)
 * @param {Function} options.api - API call function
 * @param {Function} [options.getPriorityEmails] - () => string[] emails
 *   ranked above other search results (deck collaborators + owner)
 * @param {Function} [options.onMention] - Called with the picked user after
 *   insertion
 * @returns {{el: HTMLElement, detach: Function, isOpen: Function}} the
 *   popover element (caller mounts it near the field) and a detach fn
 */
export function attachMentionAutocomplete({
  textarea,
  adapter,
  api,
  getPriorityEmails,
  onMention,
}) {
  const caret = adapter || textareaCaretAdapter(textarea);
  const target = caret.el;
  let isOpen = false;
  let results = [];
  let highlightIndex = 0;
  let debounceTimer = null;
  let lastQueryId = 0;

  const dropdown = h('div', { class: 'mention-autocomplete-dropdown' });

  const detachDismiss = installDismissOnOutside({
    rootEl: dropdown,
    isOpen: () => isOpen,
    close: () => close(),
  });

  function open() {
    if (isOpen) return;
    isOpen = true;
    dropdown.classList.add('is-open');
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    results = [];
    dropdown.classList.remove('is-open');
    dropdown.innerHTML = '';
  }

  function render() {
    dropdown.innerHTML = '';
    if (results.length === 0) {
      dropdown.append(h('div', {
        class: 'mention-autocomplete-empty',
        text: t('mentions.noResults', 'No matching users'),
      }));
      return;
    }
    results.forEach((user, i) => {
      const item = h('button', {
        type: 'button',
        class: `mention-autocomplete-item${i === highlightIndex ? ' is-highlighted' : ''}`,
        // mousedown so the textarea keeps focus (click fires after blur)
        onmousedown: (e) => {
          e.preventDefault();
          pick(user);
        },
      }, [
        h('span', { class: 'mention-autocomplete-name', text: user.name || user.email }),
        h('span', { class: 'mention-autocomplete-email', text: user.email }),
      ]);
      dropdown.append(item);
    });
  }

  /**
   * The mention query currently being typed, or null if the caret is not in
   * one. Recomputed from the text before the caret every time rather than
   * remembered, so a moved caret can never leave a stale anchor behind.
   *
   * Only `@` at start-of-text or after whitespace counts, so email addresses
   * keep working.
   * @returns {string|null}
   */
  function currentQuery() {
    const before = caret.getTextBeforeCaret();
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return null;
    if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) return null;
    const q = before.slice(atIdx + 1);
    // A space/newline ends the mention attempt.
    if (/[\s@]/.test(q)) return null;
    return q;
  }

  async function search(query) {
    const queryId = ++lastQueryId;
    const priority = (getPriorityEmails?.() || []).map((e) => String(e).toLowerCase());
    let found = [];
    try {
      const resp = await api(`/api/users/search?q=${encodeURIComponent(query)}&limit=8`);
      found = resp?.users || [];
    } catch {
      found = [];
    }
    if (queryId !== lastQueryId || !isOpen) return; // Stale response
    // Deck collaborators (+ owner) first, then the rest, stable within groups.
    const rank = (u) => (priority.includes(String(u.email).toLowerCase()) ? 0 : 1);
    results = [...found].sort((a, b) => rank(a) - rank(b));
    highlightIndex = 0;
    render();
  }

  function pick(user) {
    const query = currentQuery();
    if (query === null) {
      // The caret left the mention (arrow keys, click): replacing now would
      // corrupt the text.
      close();
      return;
    }
    const replaced = caret.replaceQueryWithMention(query.length, user);
    caret.focus();
    close();
    if (replaced) onMention?.(user);
  }

  function onKeydown(e) {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, results.length - 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      render();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (results[highlightIndex]) {
        e.preventDefault();
        e.stopPropagation();
        pick(results[highlightIndex]);
      } else {
        close();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      // Caret moves fire no input event, so the stored '@' anchor and the
      // results go stale — close instead of picking against a moved caret.
      close();
    }
  }

  function onInput() {
    const q = currentQuery();

    if (q === null) {
      close();
      return;
    }

    if (!isOpen) {
      open();
      render();
      search(q);
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(q), DEBOUNCE_MS);
  }

  // Capture phase so Enter-to-pick wins over the composer's own
  // Enter-to-submit handler.
  target.addEventListener('keydown', onKeydown, true);
  target.addEventListener('input', onInput);
  target.addEventListener('blur', () => {
    // Give a mousedown on the dropdown time to run first.
    setTimeout(() => {
      if (!dropdown.matches(':hover')) close();
    }, 150);
  });

  return {
    el: dropdown,
    isOpen: () => isOpen,
    detach: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      target.removeEventListener('keydown', onKeydown, true);
      target.removeEventListener('input', onInput);
      detachDismiss();
      dropdown.remove();
    },
  };
}
