import { h, installDismissOnOutside } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Create a tag editor component with autocomplete.
 *
 * @param {object} opts
 * @param {Function} opts.api - API client function
 * @param {string[]} opts.initialTags - Initial tag names
 * @param {Function} opts.onChange - Callback when tags change
 * @param {string} [opts.placeholder] - Input placeholder
 * @returns {object} - { el, getTags, setTags, detach }
 */
export function createTagEditor({ api, initialTags = [], onChange, placeholder }) {
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

  inputWrapper.append(input, suggestionsEl);
  el.append(tagsContainer, inputWrapper);

  // Render the tags
  function renderTags() {
    tagsContainer.innerHTML = '';
    for (const tag of tags) {
      const tagEl = h('span', { class: 'tag-editor-tag' }, [
        h('span', { class: 'tag-editor-tag-text', text: tag }),
        h('button', {
          class: 'tag-editor-tag-remove',
          type: 'button',
          'aria-label': t('tags.editor.remove', 'Remove tag'),
          text: '×',
          onclick: () => removeTag(tag),
        }),
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

  // Add a tag
  function addTag(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Check for duplicates (case-insensitive)
    const lowerName = trimmed.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lowerName)) return;
    tags.push(trimmed);
    renderTags();
    onChange?.(tags);
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
    addTag(name);
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
        const results = await api(`/api/tags/search?q=${encodeURIComponent(query)}&limit=10`);
        // Filter out already-selected tags
        suggestions = results.filter(
          (s) => !tags.some((t) => t.toLowerCase() === s.name.toLowerCase())
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
        highlightedIndex = Math.min(highlightedIndex + 1, suggestions.length - 1);
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
        addTag(input.value);
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
        addTag(input.value.replace(',', ''));
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