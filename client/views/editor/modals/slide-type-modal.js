import { t } from '../../../lib/ui-i18n.js';
import { storage } from '../../../lib/storage.js';
import { createImportSlidesTab } from './import-slides-tab.js';

// Remember which tab was last used so reopening the modal feels continuous.
const LAST_TAB_KEY = 'ps-slide-modal-tab';

export function openSlideTypeModal({
  h,
  root,
  pres,
  afterSlideId,
  parentId = null,
  openOverlayClosers,
  closeDrawer,
  openAiAppendWizard,
  renderSlideTypePicker,
  renderSlideLibraryPicker,
  api,
  onSlidesImported,
} = {}) {
  closeDrawer?.();

  const slides = pres?.slides || [];
  const afterIdxFor = (id) =>
    id == null ? -1 : slides.findIndex((s) => s?.id === id);
  const afterIdForSlideNumber = (n) => {
    const num = Number(n || 0) || 0;
    if (num <= 0) return null;
    if (!slides.length) return null;
    // If the number is higher than we have, insert at the end.
    const clamped = Math.min(slides.length, Math.floor(num));
    return slides[clamped - 1]?.id || null;
  };
  let insertAfterSlideId = afterSlideId ?? null;
  const insertParentId = parentId ?? null;

  const backdrop = h('div', { class: 'modal-backdrop ps-modal-overlay' });
  const modal = h('div', { class: 'modal ps-modal slide-type-modal' });
  const header = h('div', { class: 'ps-modal-header' });
  const title = h('h2', {
    text: t('editor.slideTypeModal.title', 'Insert slide'),
  });
  const closeBtn = h(
    'button',
    {
      class: 'btn btn-secondary btn-icon ps-modal-close',
      type: 'button',
        'aria-label': t('common.close', 'Close'),
      onclick: () => close(),
    },
    [
      h(
        'svg',
        {
          width: '16',
          height: '16',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
        },
        [h('path', { d: 'M18 6L6 18M6 6l12 12' })]
      ),
    ]
  );
  header.append(title, closeBtn);

  const body = h('div', { class: 'ps-modal-body' });

  // Allow overriding insert position by slide number. Kept compact and inline
  // in the top toolbar (built below) rather than in a separate bordered card.
  const posGroup = h('div', { class: 'ps-insert-pos' });
  const posLabel = h('label', {
    class: 'field-label',
    for: 'ps-insert-after',
    text: t('editor.slideTypeModal.insertAfter', 'Insert after slide'),
  });
  const posInput = h('input', {
    id: 'ps-insert-after',
    class: 'form-input ps-insert-input',
    type: 'number',
    min: '0',
    step: '1',
    inputmode: 'numeric',
    placeholder: t('editor.slideTypeModal.exampleN', 'e.g. 3'),
    value: (() => {
      const idx = afterIdxFor(insertAfterSlideId);
      return String(idx >= 0 ? idx + 1 : 0);
    })(),
  });
  const applyInsertNumber = () => {
    const n = Number(String(posInput.value || '').trim());
    insertAfterSlideId = afterIdForSlideNumber(n);
    renderActive?.();
  };
  posInput.addEventListener('change', applyInsertNumber);
  posInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    applyInsertNumber();
  });
  const endBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('editor.slideTypeModal.atEnd', 'At end'),
    onclick: () => {
      if (!slides.length) return;
      posInput.value = String(slides.length);
      applyInsertNumber();
    },
  });
  if (!slides.length) {
    posInput.disabled = true;
    endBtn.disabled = true;
  }
  posGroup.append(posLabel, posInput, endBtn);

  const aiBtn =
    typeof openAiAppendWizard === 'function'
      ? h('button', {
          class: 'btn btn-ai',
          type: 'button',
          text: t('editor.slideTypeModal.aiAdd', 'Add with AI…'),
          onclick: () => {
            // Capture the chosen insert position before closing (the number
            // input / "At end" button may have changed it), then hand it to the
            // AI flow so the generated slide lands where the user asked, not
            // after whatever slide happens to be selected.
            const aiAfterSlideId = insertAfterSlideId;
            // Close the picker first (modal/drawer), then open the AI flow.
            close();
            setTimeout(() => {
              try {
                openAiAppendWizard?.({ afterSlideId: aiAfterSlideId });
              } catch {
                // ignore
              }
            }, 0);
          },
        })
      : null;

  const typesMount = h('div', { class: 'ps-slide-types-mount' });
  const libraryMount = h('div', { class: 'ps-slide-library-mount' });
  const importMount = h('div', { class: 'ps-slide-import-mount' });

  // types | library | import. Restore the last-used tab, but only if it's
  // actually available in this context (library/import are conditional).
  const tabAvailable = (tab) => {
    if (tab === 'library') return typeof renderSlideLibraryPicker === 'function';
    if (tab === 'import') return !!(api && pres?.id);
    return tab === 'types';
  };
  const storedTab = storage.get(LAST_TAB_KEY, 'types');
  let activeTab = tabAvailable(storedTab) ? storedTab : 'types';

  // Assigned by the tabs builder below; lets the types picker's "See all" jump
  // to the library tab. Stays null when there is no library tab.
  let selectLibraryTab = null;
  // One-shot scope to apply the next time the library tab renders, set when the
  // types picker's per-scope "See all" is clicked. Consumed (cleared) on render
  // so later re-renders keep whatever scope the user picked in the library tab.
  let pendingLibraryScope = null;

  const renderActive = () => {
    if (activeTab === 'import' && api && pres?.id) {
      typesMount.hidden = true;
      libraryMount.hidden = true;
      importMount.hidden = false;
      // Only create the import tab content once
      if (!importMount.hasChildNodes()) {
        const importTab = createImportSlidesTab({
          h,
          api,
          presentationId: pres.id,
          afterSlideId: insertAfterSlideId,
          onComplete: (result) => {
            onSlidesImported?.(result);
            close();
          },
          onError: () => {
            // Keep modal open on error so user can see the message
          },
        });
        importMount.append(importTab);
      }
      return;
    }
    if (activeTab === 'library' && typeof renderSlideLibraryPicker === 'function') {
      typesMount.hidden = true;
      libraryMount.hidden = false;
      importMount.hidden = true;
      const scope = pendingLibraryScope;
      pendingLibraryScope = null;
      renderSlideLibraryPicker?.(libraryMount, {
        afterSlideId: insertAfterSlideId,
        onPicked: () => close(),
        ...(scope ? { scope } : {}),
      });
      return;
    }
    libraryMount.hidden = true;
    importMount.hidden = true;
    typesMount.hidden = false;
    renderSlideTypePicker?.(typesMount, {
      afterSlideId: insertAfterSlideId,
      parentId: insertParentId,
      onPicked: () => close(),
      // Only offer the inline library strip + "See all" when the library tab
      // actually exists in this context.
      onSeeAllLibrary:
        typeof renderSlideLibraryPicker === 'function' && selectLibraryTab
          ? selectLibraryTab
          : undefined,
    });
  };

  const tabs = (() => {
    const seg = h('div', { class: 'sb-segmented is-toggle ps-insert-tabs' });

    const updateActiveStates = () => {
      btnTypes.classList.toggle('is-active', activeTab === 'types');
      if (btnLibrary) btnLibrary.classList.toggle('is-active', activeTab === 'library');
      if (btnImport) btnImport.classList.toggle('is-active', activeTab === 'import');
    };

    const selectTab = (tab) => {
      activeTab = tab;
      storage.set(LAST_TAB_KEY, tab);
      updateActiveStates();
      renderActive();
    };
    // Expose library-tab switching to the types picker's "See all" affordance.
    // An optional scope ('personal' | 'team') routes straight to that scope.
    selectLibraryTab = (scope) => {
      if (scope === 'personal' || scope === 'team') pendingLibraryScope = scope;
      selectTab('library');
    };

    const btnTypes = h('button', {
      class: `sb-segmented-btn ${activeTab === 'types' ? 'is-active' : ''}`,
      type: 'button',
      text: t('editor.slideTypeModal.tab.types', 'Slide types'),
      onclick: () => selectTab('types'),
    });

    const btnLibrary =
      typeof renderSlideLibraryPicker === 'function'
        ? h('button', {
            class: `sb-segmented-btn ${activeTab === 'library' ? 'is-active' : ''}`,
            type: 'button',
            text: t('editor.slideTypeModal.tab.library', 'Slide library'),
            onclick: () => selectTab('library'),
          })
        : null;

    const btnImport =
      api && pres?.id
        ? h('button', {
            class: `sb-segmented-btn ${activeTab === 'import' ? 'is-active' : ''}`,
            type: 'button',
            text: t('editor.slideTypeModal.tab.import', 'Import from file'),
            onclick: () => selectTab('import'),
          })
        : null;

    seg.append(btnTypes);
    if (btnLibrary) seg.append(btnLibrary);
    if (btnImport) seg.append(btnImport);

    // Only show tabs if there's more than just the types tab
    return btnLibrary || btnImport ? seg : null;
  })();

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  const close = () => {
    try {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    } finally {
      openOverlayClosers?.delete(close);
    }
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  renderActive();

  // One compact toolbar: tabs on the left, insert-position + AI on the right.
  const toolbar = h('div', { class: 'ps-insert-toolbar' });
  if (tabs) toolbar.append(tabs);
  toolbar.append(posGroup);
  if (aiBtn) toolbar.append(aiBtn);

  body.append(toolbar, typesMount, libraryMount, importMount);
  modal.append(header, body);
  backdrop.append(modal);
  root.append(backdrop);
  openOverlayClosers?.add(close);
  document.addEventListener('keydown', onKey);
}
