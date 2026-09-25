import { h, installDismissOnOutside } from '../../lib/dom.js';
import { createInlineError } from '../../lib/dom/inline-error.js';
import { t } from '../../lib/ui-i18n.js';
import { checkTagName, TAG_NAME_MESSAGES } from '../../../shared/tag-name.js';
import { icon } from '../../lib/dom/icons.js';

/**
 * The editor's voice for a refused tag name. The rule is `shared/tag-name.js`;
 * this is only the translated sentence for each of its codes, with the shared
 * English as the fallback — so the editor and the server refuse the same names
 * and say the same thing. Keys are full literals, so the i18n audit can see
 * every reference by exact match.
 * @type {Readonly<Record<'blank'|'too_long'|'control_character', () => string>>}
 */
const TAG_NAME_REFUSALS = Object.freeze({
  blank: () => t('tags.editor.refused.blank', TAG_NAME_MESSAGES.blank),
  too_long: () => t('tags.editor.refused.tooLong', TAG_NAME_MESSAGES.too_long),
  control_character: () =>
    t(
      'tags.editor.refused.controlCharacter',
      TAG_NAME_MESSAGES.control_character,
    ),
});

/**
 * Create a tag editor component with autocomplete.
 *
 * @param {object} opts
 * @param {Function} opts.api - API client function
 * @param {string[]} opts.initialTags - Initial tag names
 * @param {Function} opts.onChange - Callback when tags change
 * @param {string} [opts.placeholder] - Input placeholder
 * @param {boolean} [opts.readOnly] - Show the tags without offering an edit
 * @returns {object} - { el, getTags, setTags, detach }
 */
export function createTagEditor({
  api,
  initialTags = [],
  onChange,
  placeholder,
  readOnly = false,
}) {
  let tags = [...initialTags];
  let suggestions = [];
  let highlightedIndex = -1;
  let isOpen = false;

  // Main container
  const el = h('div', { class: 'tag-editor' });

  // Tags container (shows selected tags)
  const tagsContainer = h('div', { class: 'tag-editor-tags' });

  // Input wrapper (for input + suggestions)
  const inputWrapper = h('div', { class: 'tag-editor-input-wrapper' });

  // Text input
  const input = h('input', {
    type: 'text',
    class: 'tag-editor-input',
    placeholder: placeholder || t('tags.editor.placeholder', 'Add a tag…'),
  });

  // Suggestions dropdown
  const suggestionsEl = h('div', { class: 'tag-editor-suggestions' });

  // A refused name is a state of this field, not a passing message
  // (docs/reference/feedback-surfaces.md).
  const nameError = createInlineError();

  inputWrapper.append(input, suggestionsEl);
  el.append(tagsContainer);
  if (!readOnly) el.append(inputWrapper, nameError.el);

  // Render the tags
  function renderTags() {
    tagsContainer.innerHTML = '';
    for (const tag of tags) {
      const text = h('span', { class: 'tag-editor-tag-text', text: tag });
      if (readOnly) {
        tagsContainer.append(h('span', { class: 'tag-editor-tag' }, [text]));
        continue;
      }
      const tagEl = h('span', { class: 'tag-editor-tag' }, [
        text,
        h(
          'button',
          {
            class: 'tag-editor-tag-remove',
            type: 'button',
            'aria-label': t('tags.editor.remove', 'Remove tag'),
            onclick: () => removeTag(tag),
          },
          [icon('x', { size: 12 })],
        ),
      ]);
      tagsContainer.append(tagEl);
    }
  }

  // Render suggestions
  function renderSuggestions() {
    suggestionsEl.innerHTML = '';
    if (suggestions.length === 0 || !isOpen) {
      suggestionsEl.classList.remove('is-open');
      return;
    }

    suggestionsEl.classList.add('is-open');
    suggestions.forEach((suggestion, index) => {
      const item = h('div', {
        class: `tag-editor-suggestion${index === highlightedIndex ? ' is-highlighted' : ''}`,
        text: suggestion.name,
        onclick: () => selectSuggestion(suggestion.name),
        onmouseenter: () => {
          highlightedIndex = index;
          renderSuggestions();
        },
      });
      suggestionsEl.append(item);
    });
  }

  /**
   * Add a tag, refusing a name the server would refuse — the same rule, from
   * `shared/tag-name.js`, so a name that cannot be stored is said here instead
   * of being dropped on the way to the database (B370).
   *
   * @param {string} name
   * @returns {boolean} Whether the input may be cleared; false leaves the
   *   refused text in place for the user to fix.
   */
  function addTag(name) {
    nameError.clear();
    const checked = checkTagName(name);
    if (!checked.ok) {
      nameError.show(TAG_NAME_REFUSALS[checked.code](), { control: input });
      return false;
    }
    // Already on the chip row: nothing to add and nothing to refuse.
    const lowerName = checked.name.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lowerName)) return true;
    tags.push(checked.name);
    renderTags();
    onChange?.(tags);
    return true;
  }

  // Remove a tag
  function removeTag(name) {
    const lowerName = name.toLowerCase();
    tags = tags.filter((t) => t.toLowerCase() !== lowerName);
    renderTags();
    onChange?.(tags);
  }

  // Select a suggestion
  function selectSuggestion(name) {
    if (!addTag(name)) return;
    input.value = '';
    suggestions = [];
    highlightedIndex = -1;
    isOpen = false;
    renderSuggestions();
    input.focus();
  }

  // Fetch suggestions from API
  let fetchTimeout = null;
  async function fetchSuggestions(query) {
    clearTimeout(fetchTimeout);
    if (!query.trim()) {
      suggestions = [];
      isOpen = false;
      renderSuggestions();
      return;
    }

    fetchTimeout = setTimeout(async () => {
      try {
        const results = await api(
          `/api/tags/search?q=${encodeURIComponent(query)}&limit=10`,
        );
        // Filter out already-selected tags
        suggestions = results.filter(
          (s) => !tags.some((t) => t.toLowerCase() === s.name.toLowerCase()),
        );
        highlightedIndex = suggestions.length > 0 ? 0 : -1;
        isOpen = suggestions.length > 0;
        renderSuggestions();
      } catch (err) {
        console.error('Failed to fetch tag suggestions:', err);
        suggestions = [];
        isOpen = false;
        renderSuggestions();
      }
    }, 150);
  }

  // Input event handlers
  input.addEventListener('input', () => {
    fetchSuggestions(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length > 0) {
        highlightedIndex = Math.min(
          highlightedIndex + 1,
          suggestions.length - 1,
        );
        renderSuggestions();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length > 0) {
        highlightedIndex = Math.max(highlightedIndex - 1, 0);
        renderSuggestions();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        selectSuggestion(suggestions[highlightedIndex].name);
      } else if (input.value.trim()) {
        if (!addTag(input.value)) return;
        input.value = '';
        suggestions = [];
        isOpen = false;
        renderSuggestions();
      }
    } else if (e.key === 'Escape') {
      suggestions = [];
      highlightedIndex = -1;
      isOpen = false;
      renderSuggestions();
    } else if (e.key === 'Backspace' && !input.value && tags.length > 0) {
      // Remove last tag when backspace on empty input
      removeTag(tags[tags.length - 1]);
    } else if (e.key === ',' || e.key === 'Tab') {
      // Allow comma or tab to add tag
      if (input.value.trim()) {
        e.preventDefault();
        if (!addTag(input.value.replace(',', ''))) return;
        input.value = '';
        suggestions = [];
        isOpen = false;
        renderSuggestions();
      }
    }
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) {
      fetchSuggestions(input.value);
    }
  });

  // Install dismiss handler for suggestions
  const detachDismiss = installDismissOnOutside({
    rootEl: inputWrapper,
    isOpen: () => isOpen,
    close: () => {
      isOpen = false;
      renderSuggestions();
    },
  });

  // Get current tags
  function getTags() {
    return [...tags];
  }

  // Set tags programmatically
  function setTags(newTags) {
    tags = [...(newTags || [])];
    renderTags();
  }

  // Initial render
  renderTags();

  return {
    el,
    getTags,
    setTags,
    detach: () => {
      clearTimeout(fetchTimeout);
      detachDismiss?.();
    },
  };
}
