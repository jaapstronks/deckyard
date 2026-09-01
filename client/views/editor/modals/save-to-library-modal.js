import { createModal, createModalActions } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { createTagEditor } from '../../list/tag-editor.js';
import { h } from '../../../lib/dom.js';
import { getLangDisplayName } from '../../../lib/format/lang-selector.js';
import {
  DEFAULT_DECK_LANG,
  TRANSLATION_LANGS,
} from '../../../../shared/i18n-utils.js';

/**
 * Get content for a slide in a specific language version of the presentation.
 */
function getSlideContentForLang(pres, slideId, lang) {
  const version = pres?.i18n?.versions?.[lang];
  if (!version || !Array.isArray(version.slides)) return null;
  const slide = version.slides.find((s) => s?.id === slideId);
  return slide?.content && typeof slide.content === 'object'
    ? slide.content
    : null;
}

/**
 * Check if slide content has meaningful text (for translation detection).
 */
function hasTextContent(content) {
  if (!content || typeof content !== 'object') return false;
  // Check common text fields
  const textFields = [
    'title',
    'subtitle',
    'text',
    'body',
    'description',
    'markdown',
    'html',
  ];
  for (const key of textFields) {
    const val = content[key];
    if (typeof val === 'string' && val.trim()) return true;
  }
  // Check items array (for list slides)
  if (Array.isArray(content.items)) {
    for (const item of content.items) {
      if (typeof item === 'string' && item.trim()) return true;
      if (item && typeof item === 'object') {
        if (typeof item.text === 'string' && item.text.trim()) return true;
        if (typeof item.title === 'string' && item.title.trim()) return true;
      }
    }
  }
  return false;
}

/**
 * Get language display name — the axis-keyed native label
 * (`shared/i18n-utils.js`), so a deck saved in Finnish reads "Suomi" here
 * rather than `fi`. This used to be a two-branch `if` over `nl`/`en-GB`.
 */
function getLangLabel(lang) {
  return getLangDisplayName(lang);
}

/**
 * Open a modal to save the current slide to the slide library.
 *
 * @param {Object} options
 * @param {HTMLElement} options.root - Root element for modal
 * @param {Object} options.slide - The slide to save
 * @param {Object} options.pres - The presentation (for themeId)
 * @param {Function} options.api - API function
 * @param {string} options.suggestedName - Suggested name for the slide
 * @param {Function} [options.openSlideLibraryModal] - Callback to open library after save
 */
export function openSaveToLibraryModal({
  root,
  slide,
  pres,
  api,
  suggestedName = '',
  openSlideLibraryModal,
} = {}) {
  const modal = createModal({
    title: t('editor.slideLibrary.saveModal.title', 'Save to slide library'),
    hint: t(
      'editor.slideLibrary.saveModal.hint',
      'Save this slide so you can reuse it in other presentations.',
    ),
  });

  // Detect available language versions for this slide
  const slideId = slide?.id;
  const currentLang =
    pres?.i18n?.active || pres?.i18n?.dominant || DEFAULT_DECK_LANG;
  const availableLangs = [];
  const langContents = {};

  for (const lang of TRANSLATION_LANGS) {
    const content = getSlideContentForLang(pres, slideId, lang);
    if (content && hasTextContent(content)) {
      availableLangs.push(lang);
      langContents[lang] = content;
    }
  }

  // If no language versions found in i18n, use the current slide content
  if (availableLangs.length === 0 && slide?.content) {
    availableLangs.push(currentLang);
    langContents[currentLang] = slide.content;
  }

  const hasBothLangs = availableLangs.length >= 2;
  const hasOneLang = availableLangs.length === 1;
  const onlyLang = hasOneLang ? availableLangs[0] : null;

  // Name input
  const nameLabel = h('label', {
    class: 'field-label',
    text: t('editor.slideLibrary.saveModal.name', 'Name'),
  });
  const nameInput = h('input', {
    class: 'form-input',
    type: 'text',
    value: suggestedName,
    placeholder: t(
      'editor.slideLibrary.saveModal.namePlaceholder',
      'E.g. Contact slide',
    ),
    autocomplete: 'off',
    autofocus: true,
  });
  const nameField = h('div', { class: 'field' });
  nameField.append(nameLabel, nameInput);

  // Description textarea (optional)
  const descLabel = h('label', {
    class: 'field-label',
    text: t('editor.slideLibrary.saveModal.description', 'Description'),
  });
  const descInput = h('textarea', {
    class: 'form-input',
    rows: 2,
    placeholder: t(
      'editor.slideLibrary.saveModal.descriptionPlaceholder',
      'Briefly describe this slide…',
    ),
  });
  const descHint = h('div', {
    class: 'help is-small',
    text: t(
      'editor.slideLibrary.saveModal.descriptionHint',
      'Optional. Helps you find this slide later.',
    ),
  });
  const descField = h('div', { class: 'field' });
  descField.append(descLabel, descInput, descHint);

  // Tag editor
  const tagsLabel = h('label', {
    class: 'field-label',
    text: t('editor.slideLibrary.saveModal.tags', 'Tags'),
  });
  const tagEditor = createTagEditor({
    api,
    initialTags: [],
    placeholder: t(
      'editor.slideLibrary.saveModal.tagsPlaceholder',
      'Add tags…',
    ),
    onChange: () => {}, // Tags will be read on save
  });
  const tagsHint = h('div', {
    class: 'help is-small',
    text: t(
      'editor.slideLibrary.saveModal.tagsHint',
      'Optional. Use tags to organize your slides.',
    ),
  });
  const tagsField = h('div', { class: 'field' });
  tagsField.append(tagsLabel, tagEditor.el, tagsHint);

  // Language info/warning
  let langField = null;
  if (hasBothLangs) {
    // Show info that both languages will be saved
    const langInfo = h('div', { class: 'field' });
    const langLabel = h('label', {
      class: 'field-label',
      text: t('editor.slideLibrary.saveModal.languages', 'Languages'),
    });
    const langHint = h('div', {
      class: 'help is-small is-success',
      text: t(
        'editor.slideLibrary.saveModal.bothLangsAvailable',
        'This slide has content in both Dutch and English. Both versions will be saved.',
      ),
    });
    langInfo.append(langLabel, langHint);
    langField = langInfo;
  } else if (hasOneLang) {
    // Show warning that only one language is available
    const langInfo = h('div', { class: 'field' });
    const langLabel = h('label', {
      class: 'field-label',
      text: t('editor.slideLibrary.saveModal.languages', 'Languages'),
    });
    const langText = t(
      'editor.slideLibrary.saveModal.onlyOneLang',
      'This slide only has content in {lang}. Consider translating it first to save both versions.',
      { lang: getLangLabel(onlyLang) },
    );
    const langHint = h('div', {
      class: 'help is-small is-warning',
      text: langText,
    });
    langInfo.append(langLabel, langHint);
    langField = langInfo;
  }

  // Shelf selector (Personal / Team)
  const shelfLabel = h('label', {
    class: 'field-label',
    text: t('editor.slideLibrary.saveModal.saveTo', 'Save to'),
  });

  const shelfSegmented = h('div', { class: 'sb-segmented is-toggle' });
  let selectedShelf = 'personal';

  const personalBtn = h('button', {
    class: 'sb-segmented-btn is-active',
    type: 'button',
    text: t('slideLibrary.shelf.personal', 'Personal'),
  });
  const teamBtn = h('button', {
    class: 'sb-segmented-btn',
    type: 'button',
    text: t('slideLibrary.shelf.organization', 'Team'),
  });

  personalBtn.addEventListener('click', () => {
    selectedShelf = 'personal';
    personalBtn.classList.add('is-active');
    teamBtn.classList.remove('is-active');
  });

  teamBtn.addEventListener('click', () => {
    selectedShelf = 'organization';
    teamBtn.classList.add('is-active');
    personalBtn.classList.remove('is-active');
  });

  shelfSegmented.append(personalBtn, teamBtn);

  const shelfHint = h('div', {
    class: 'help is-small',
    text: t(
      'editor.slideLibrary.saveModal.shelfHint',
      'Personal slides are only visible to you. Team slides are shared with your organization.',
    ),
  });

  const shelfField = h('div', { class: 'field' });
  shelfField.append(shelfLabel, shelfSegmented, shelfHint);

  // Status message
  const status = h('div', { class: 'help modal-status', text: '' });

  // Actions
  let saving = false;

  const doSave = async () => {
    const name = String(nameInput.value || '').trim();
    if (!name) {
      status.textContent = t(
        'editor.slideLibrary.saveModal.nameRequired',
        'Please enter a name.',
      );
      nameInput.focus();
      return;
    }

    if (saving) return;
    saving = true;
    actions.setDisabled(true);
    status.textContent = t('common.saving', 'Saving…');

    try {
      const endpoint =
        selectedShelf === 'organization'
          ? '/api/slide-library/organization'
          : '/api/slide-library/personal';

      // Build the payload with i18n if we have multiple languages
      const description = String(descInput.value || '').trim();
      const tags = tagEditor.getTags();

      const payload = {
        name,
        description,
        slideType: slide.type,
        content: slide.content || {},
        themeId: pres?.theme || '',
      };

      // Add i18n data if we have language versions
      if (availableLangs.length > 0) {
        const i18nVersions = {};
        for (const lang of availableLangs) {
          i18nVersions[lang] = {
            content: langContents[lang] || {},
          };
        }
        // Same invariant as a deck's: `dominant` names the version the top-level
        // buffers hold (`contentLang()` in client/lib/slide-library/search.js
        // reads it as "which language is `item.content` written in"). A library
        // item is born here from the slide on screen — `payload.content` is that
        // version's content — so its `dominant` is fixed at creation to the
        // *active* language, not copied from the deck's source (D74 split the
        // two). Copying the deck's would label `content` with a language it is
        // not in whenever a slide is saved while editing a translation.
        payload.i18n = {
          dominant: currentLang,
          versions: i18nVersions,
        };
      }

      const result = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      // Save tags if any were specified
      if (tags.length > 0 && result?.id) {
        try {
          await api(`${endpoint}/${encodeURIComponent(result.id)}/tags`, {
            method: 'PUT',
            body: JSON.stringify({ tags }),
          });
        } catch (tagErr) {
          console.warn('Failed to save tags:', tagErr);
          // Don't fail the whole save if tags fail
        }
      }

      const successMsg =
        selectedShelf === 'organization'
          ? t(
              'editor.slideLibrary.saveModal.doneTeam',
              'Saved to team slide library.',
            )
          : t(
              'editor.slideLibrary.saveModal.donePersonal',
              'Saved to personal slide library.',
            );

      toast.success(successMsg);
      modal.close();

      // Optionally open the library to show the newly saved slide
      openSlideLibraryModal?.({
        initialShelf: selectedShelf,
        initialQuery: name,
        allowInsert: true,
      });
    } catch (e) {
      status.textContent = String(e?.message || e);
      toast.error(e);
    } finally {
      saving = false;
      actions.setDisabled(false);
    }
  };

  const actions = createModalActions({
    onCancel: () => modal.close(),
    onAction: doSave,
    cancelText: t('common.cancel', 'Cancel'),
    actionText: t('editor.slideLibrary.saveModal.save', 'Save to library'),
  });

  // Handle Enter key in name input
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSave();
    }
  });

  // Build modal content
  modal.content.append(nameField, descField, tagsField);
  if (langField) modal.content.append(langField);
  modal.content.append(shelfField, status, actions.wrap);
  modal.show(root);

  // Focus and select the name input
  try {
    nameInput.focus();
    nameInput.select();
  } catch {
    // ignore
  }

  return modal;
}
