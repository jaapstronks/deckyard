/**
 * Inline @-mention autocomplete for a textarea.
 *
 * Typing `@` opens a popover under the textarea; the query is whatever
 * follows the `@` up to the caret. Selecting a user (mouse or ↑/↓ + Enter/
 * Tab) replaces `@query` with mention markup (`@[Name](user:email)`).
 *
 * Search goes through /api/users/search (org-scoped); the deck's
 * collaborators (+ owner) rank first via the `priorityEmails` option.
 * Guests are not mentionable: they have no account, so they never appear
 * in the source.
 *
 * Same dropdown conventions as user-autocomplete.js, but inline in an
 * existing textarea instead of an input-with-chips.
 */

import { h, installDismissOnOutside } from './dom.js';
import { t } from './ui-i18n.js';
import { mentionMarkup } from '../../shared/comment-mentions.js';

const DEBOUNCE_MS = 200;

/**
 * Attach mention autocomplete to a textarea.
 * @param {Object} options
 * @param {HTMLTextAreaElement} options.textarea - Target textarea
 * @param {Function} options.api - API call function
 * @param {Function} [options.getPriorityEmails] - () => string[] emails
 *   ranked above other search results (deck collaborators + owner)
 * @param {Function} [options.onMention] - Called with the picked user after
 *   insertion
 * @returns {{el: HTMLElement, detach: Function, isOpen: Function}} the
 *   popover element (caller mounts it near the textarea) and a detach fn
 */
export function attachMentionAutocomplete({
  textarea,
  api,
  getPriorityEmails,
  onMention,
}) {
  let isOpen = false;
  let results = [];
  let highlightIndex = 0;
  let debounceTimer = null;
  let atStart = -1; // index of the '@' that opened the popover
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
    atStart = -1;
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

  /** Current query between the opening '@' and the caret, or null. */
  function currentQuery() {
    if (atStart < 0) return null;
    const caret = textarea.selectionStart;
    if (caret <= atStart) return null;
    const q = textarea.value.slice(atStart + 1, caret);
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
    const caret = textarea.selectionStart;
    const before = textarea.value.slice(0, atStart);
    const after = textarea.value.slice(caret);
    const markup = mentionMarkup({ name: user.name || user.email, email: user.email });
    textarea.value = `${before}${markup} ${after}`;
    const newCaret = before.length + markup.length + 1;
    textarea.setSelectionRange(newCaret, newCaret);
    textarea.focus();
    close();
    onMention?.(user);
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
    }
  }

  function onInput() {
    const caret = textarea.selectionStart;
    const value = textarea.value;

    if (!isOpen) {
      // Did the user just produce an '@' that starts a mention? Only open
      // at start-of-text or after whitespace, so emails keep working.
      const before = value.slice(0, caret);
      const atIdx = before.lastIndexOf('@');
      if (atIdx < 0) return;
      if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) return;
      const partial = before.slice(atIdx + 1);
      if (/[\s@]/.test(partial)) return;
      atStart = atIdx;
      open();
      render();
      search(partial);
      return;
    }

    const q = currentQuery();
    if (q === null) {
      close();
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(q), DEBOUNCE_MS);
  }

  // Capture phase so Enter-to-pick wins over the textarea's own
  // Enter-to-submit handler.
  textarea.addEventListener('keydown', onKeydown, true);
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('blur', () => {
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
      textarea.removeEventListener('keydown', onKeydown, true);
      textarea.removeEventListener('input', onInput);
      detachDismiss();
      dropdown.remove();
    },
  };
}
