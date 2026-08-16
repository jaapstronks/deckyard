/**
 * Creation view — the two-column "New presentation" surface.
 *
 * Left rail = creation method; right pane = the selected method, with theme +
 * language shown only where they apply. Header and action bar are pinned; only
 * the right pane scrolls. Replaces the single overflowing new-presentation
 * modal (create-flow track, Slice 1).
 *
 * Methods live behind rail items: Blank, From the library (Slice 2 — shown
 * disabled here), From content · AI (paste / upload / Notion), and — after a
 * divider — Import (.json / .md). The Content · AI and Import flows reuse the
 * existing handlers in ../new-presentation/handlers.js unchanged.
 */

import { t, getUiLocale } from '../../../../lib/ui-i18n.js';
import {
  readStoredLangMode,
  resolveInitialDeckLang,
} from '../../../../lib/format/i18n.js';
import { confirmModal } from '../../../../lib/dom/modal.js';
import { createFocusTrap } from '../../../../lib/dom.js';
import { getFeatures } from '../../../../lib/state/features.js';
import { createVisualThemePicker } from '../../../../lib/theme/theme-select.js';
import { createLangSelector } from '../../../../lib/format/lang-selector.js';
import { createLibraryCompose } from './library-compose.js';
import { createContentCompose } from './content-compose.js';
import { createImportCompose } from './import-compose.js';
import { handleEmpty } from '../new-presentation/handlers.js';

export function openCreationView({
  h,
  api,
  root,
  nav,
  readLangMode,
  writeLangMode,
  getSupportedLangs,
  preselectedTheme,
  // Optional: land directly in the library compose flow, seeded from a
  // building block. `{ collection }` pre-fills the tray from a saved
  // collection; `{ items }` seeds it from an already-resolved list of
  // library items (Home "Building blocks" shelf).
  preselect,
} = {}) {
  const features = getFeatures() || {};
  const aiDisabled = !features.enableAi;
  // Sandbox guests have no slide library of their own, so "From the library"
  // has nothing to compose from — hide the method entirely there.
  const libraryDisabled = !!features.sandboxMode;

  // ===== State =====
  let method = 'blank'; // blank | library | content | import
  let busy = false;
  // null lets the visual picker adopt the workspace default theme.
  let themeId = preselectedTheme?.id || null;
  let onKey = null;
  let detachFocusTrap = null;

  // Resolve which concrete flow a Create click runs, given the active method.
  const getEffectiveMode = () => {
    if (method === 'blank') return 'empty';
    if (method === 'library') return 'library';
    if (method === 'content') return content.getMode();
    if (method === 'import') return importMethod.getMode();
    return null;
  };

  // ===== Shell =====
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', {
    class: 'modal creation-view',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'creation-view-title',
  });

  const header = h('div', { class: 'creation-view-header' }, [
    h('h2', {
      id: 'creation-view-title',
      text: t('list.creationView.title', 'New presentation'),
    }),
  ]);

  // ===== Left rail =====
  const rail = h('nav', {
    class: 'creation-rail',
    'aria-label': t('list.creationView.methodsLabel', 'Creation methods'),
  });

  const railItems = new Map(); // method -> button

  const makeRailItem = (key, label, { badge, desc, disabled } = {}) => {
    const btn = h('button', {
      type: 'button',
      class: 'creation-rail-item',
      role: 'tab',
      'aria-selected': String(key === method),
      disabled: !!disabled,
    });
    const titleRow = h('span', { class: 'creation-rail-item-title', text: label });
    if (badge) {
      titleRow.append(h('span', { class: 'creation-rail-badge', text: badge }));
    }
    btn.append(titleRow);
    if (desc) {
      btn.append(h('span', { class: 'creation-rail-item-desc', text: desc }));
    }
    if (!disabled) {
      btn.addEventListener('click', () => selectMethod(key));
    }
    railItems.set(key, btn);
    return btn;
  };

  const blankItem = makeRailItem('blank', t('list.creationView.method.blank', 'Blank'));
  rail.append(blankItem);
  if (!libraryDisabled) {
    const libraryItem = makeRailItem('library', t('list.creationView.method.library', 'From the library'), {
      desc: t('list.creationView.method.libraryDesc', 'Reusable slides'),
    });
    rail.append(libraryItem);
  }
  if (!aiDisabled) {
    rail.append(
      makeRailItem('content', t('list.creationView.method.content', 'From content'), {
        badge: 'AI',
        desc: t('list.creationView.method.contentDesc', 'Paste, upload, or Notion'),
      })
    );
  }
  rail.append(h('div', { class: 'creation-rail-divider' }));
  rail.append(
    makeRailItem('import', t('list.creationView.method.import', 'Import'), {
      desc: t('list.creationView.method.importDesc', '.json or .md'),
    })
  );

  // ===== Right pane =====
  const pane = h('div', { class: 'creation-pane' });

  // --- Blank panel ---
  const blankPanel = h('div', { class: 'creation-panel', 'data-method': 'blank' });
  const blankTitleField = h('div', { class: 'stack is-field' });
  const emptyTitleInput = h('input', {
    class: 'form-input',
    placeholder: t('list.newPresentation.titlePlaceholder', 'Title...'),
    'aria-label': t('list.creationView.nameLabel', 'Give it a name'),
  });
  blankTitleField.append(
    h('label', { class: 'field-label', text: t('list.creationView.nameLabel', 'Give it a name') }),
    emptyTitleInput
  );
  blankPanel.append(blankTitleField);

  // --- Library panel (compose from reusable slides) ---
  // The whole "From the library" method is a self-contained concern; it owns
  // its source toggle, picker, selection tray, and collections cache. The host
  // only wires it in: syncUI drives its panel, isDirty/count read its state.
  const library = createLibraryCompose({
    h,
    api,
    onSelectionChange: () => syncUI(),
    setStatus: (text) => setStatus(text),
    isBusy: () => busy,
  });
  const libraryPanel = library.panel;

  // --- Content (AI) panel (paste / upload / Notion) ---
  // Another self-contained concern: the active sub-tab, the selected upload
  // file, and the Notion reveal all live in the module. syncUI drives its panel,
  // getEffectiveMode/isDirty read its state, and Create delegates to its run().
  const content = createContentCompose({
    h,
    api,
    onChange: () => syncUI(),
    aiDisabled,
  });
  const contentPanel = content.panel;

  // --- Import panel (.json / .md file / paste markdown) ---
  // A third self-contained concern: the active sub-tab, the two selected files,
  // and the inline import-warnings renderer live in the module. syncUI drives
  // its panel, getEffectiveMode/isDirty/themeApplies read its state, and Create
  // delegates to its run().
  const importMethod = createImportCompose({
    h,
    onChange: () => syncUI(),
  });
  const importPanel = importMethod.panel;

  // --- Shared setup (language + theme) ---
  // Language sits first so it stays visible without scrolling past the tall
  // theme grid — and it only renders at all when the deck supports >1 language.
  const setupWrap = h('div', { class: 'creation-setup' });
  // A new deck starts in the language the app is being read in, unless the
  // user already saved a deck-language preference — then that wins. Reading
  // the stored value and the UI locale straight from their modules (rather
  // than through the injected readLangMode/writeLangMode pair) keeps the
  // "no preference stored" case distinguishable, which readLangMode() hides.
  const langSelect = createLangSelector({
    h, readLangMode, writeLangMode, getSupportedLangs,
    initialLang: resolveInitialDeckLang({
      storedLang: readStoredLangMode(),
      uiLocale: getUiLocale(),
    }),
    className: '',
  });
  const themeSelect = createVisualThemePicker({
    h, api, initialTheme: themeId,
    onChange: (id) => { themeId = id; },
  });
  // Theme lives in a disclosure so it can read as optional where re-theming is
  // rare: composing from the library, you almost always keep the slides' look,
  // so it starts collapsed there. Every other method keeps it open, so the
  // change is invisible for blank / AI / import.
  const themeSummary = h('summary', {
    class: 'creation-theme-summary',
    text: t('common.theme', 'Theme'),
  });
  const themeDisclosure = h('details', { class: 'creation-theme-disclosure' }, [
    themeSummary,
    themeSelect.wrap,
  ]);
  themeDisclosure.open = true;
  // The hint lives outside the disclosure so it stays visible while collapsed —
  // that is exactly when "what theme do I get if I skip this?" needs answering.
  const themeHint = h('div', {
    class: 'help creation-theme-hint is-hidden',
    text: t('list.creationView.themeOptionalHint', 'Keeps the workspace theme unless you pick another.'),
  });
  setupWrap.append(langSelect.wrap, themeDisclosure, themeHint);

  // Sandbox shows only the neutral built-in themes and has no theme builder, so
  // surface what a real Deckyard adds: your own branded theme with custom fonts.
  if (features.sandboxMode) {
    setupWrap.append(
      h('div', {
        class: 'help creation-theme-prod-hint',
        text: t(
          'list.creationView.themeSandboxHint',
          'In your own Deckyard you can build a branded theme with custom colours, fonts, and logo.'
        ),
      })
    );
  }

  // The hint only makes sense in the optional (library) mode while collapsed.
  const syncThemeHint = () => {
    themeHint.classList.toggle('is-hidden', !(method === 'library' && !themeDisclosure.open));
  };
  themeDisclosure.addEventListener('toggle', syncThemeHint);

  // Default open state follows the method, but only when the method changes —
  // syncUI() runs on every library-selection tick, so it must not slam a
  // manually-opened disclosure shut mid-interaction.
  const syncThemeDefaultOpen = () => {
    themeDisclosure.open = method !== 'library';
    syncThemeHint();
  };

  pane.append(blankPanel, libraryPanel, contentPanel, importPanel, setupWrap);

  // ===== Footer (pinned) =====
  const status = h('div', { class: 'help modal-status', text: '' });
  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.cancel', 'Cancel'),
  });
  const btnAction = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('common.create', 'Create'),
  });
  const footer = h('div', { class: 'creation-view-footer' }, [
    status,
    h('div', { class: 'row is-end gap-2' }, [btnCancel, btnAction]),
  ]);

  const body = h('div', { class: 'creation-view-body' }, [rail, pane]);
  modal.append(header, body, footer);
  backdrop.append(modal);

  // ===== Behavior =====
  const setStatus = (text) => { status.textContent = text || ''; };

  const setBusy = (v) => {
    busy = v;
    for (const el of modal.querySelectorAll('input, textarea, select, button')) {
      el.disabled = v;
    }
  };

  const getButtonLabel = (mode) => {
    const labels = {
      'empty': t('common.create', 'Create'),
      'paste-text': t('list.aiWizard.generate', 'Generate'),
      'convert-file': t('list.fileConverter.convert', 'Convert'),
      'notion': t('list.newPresentation.notion.import', 'Import'),
      'import-json': t('list.importJson', 'Import'),
      'import-markdown': t('list.importJson', 'Import'),
      'paste-markdown': t('list.importJson', 'Import'),
    };
    return labels[mode] || t('common.create', 'Create');
  };

  // Theme applies to every method except JSON import (which carries its own).
  const themeApplies = () => !(method === 'import' && importMethod.carriesOwnTheme());

  const syncUI = () => {
    for (const [key, btn] of railItems) {
      const active = key === method;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    blankPanel.classList.toggle('is-hidden', method !== 'blank');
    libraryPanel.classList.toggle('is-hidden', method !== 'library');
    contentPanel.classList.toggle('is-hidden', method !== 'content');
    importPanel.classList.toggle('is-hidden', method !== 'import');

    // Content sub-tabs — the panel owns its controls.
    content.syncPanel();

    // Library source (collections vs all slides) — the panel owns its controls.
    library.syncPanel();

    // Import sub-tabs — the panel owns its controls.
    importMethod.syncPanel();

    // Setup (theme + language) applies to every method; theme is hidden only
    // for JSON import (which carries its own theme). Composing from the library
    // reads it as optional (collapsed, with a "keeps the workspace theme" hint);
    // every other method keeps it prominent.
    setupWrap.classList.remove('is-hidden');
    const showTheme = themeApplies();
    const themeOptional = method === 'library';
    themeDisclosure.classList.toggle('is-hidden', !showTheme);
    themeSummary.textContent = themeOptional
      ? t('list.creationView.themeOptional', 'Theme (optional)')
      : t('common.theme', 'Theme');
    syncThemeHint();

    // Action button
    const mode = getEffectiveMode();
    btnAction.classList.toggle('is-hidden', !mode);
    if (mode === 'library') {
      const count = library.getSelectedCount();
      btnAction.textContent = count
        ? t('list.creationView.library.create', 'Create · {count} slides', { count: String(count) })
        : t('common.create', 'Create');
      btnAction.disabled = busy || count === 0;
    } else if (mode) {
      btnAction.textContent = getButtonLabel(mode);
      btnAction.disabled = busy;
    }
  };

  function selectMethod(key) {
    if (busy) return;
    method = key;
    syncThemeDefaultOpen();
    syncUI();
    if (key === 'blank') emptyTitleInput.focus();
    if (key === 'library') library.ensurePicker();
  }

  // ===== Close handling =====
  const close = () => {
    try { if (onKey) window.removeEventListener('keydown', onKey); } catch {}
    try { detachFocusTrap?.(); } catch {}
    backdrop.remove();
  };

  const isDirty = () => {
    const mode = getEffectiveMode();
    if (mode === 'empty') return !!String(emptyTitleInput.value || '').trim();
    if (mode === 'library') return library.isDirty();
    if (method === 'content') return content.isDirty();
    if (method === 'import') return importMethod.isDirty();
    return false;
  };

  const requestClose = async () => {
    if (busy) return;
    if (isDirty() && !(await confirmModal(h, root, {
      title: t('list.newPresentation.discard', 'Discard'),
      message: t('list.newPresentation.confirmDiscard', 'Discard your input?'),
      confirmLabel: t('list.newPresentation.discard', 'Discard'),
      danger: true,
    }))) {
      return;
    }
    close();
  };

  btnCancel.addEventListener('click', requestClose);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) requestClose();
  });

  // ===== Create =====
  btnAction.addEventListener('click', async () => {
    const mode = getEffectiveMode();
    if (!mode) return;
    const commonOpts = {
      api,
      h,
      root,
      close,
      nav,
      setBusy,
      setStatus,
      hideBackdrop: () => { backdrop.style.display = 'none'; },
      showBackdrop: () => { backdrop.style.display = ''; },
    };

    switch (mode) {
      case 'library':
        await library.compose({
          lang: langSelect.getLang() === 'en-GB' ? 'en-GB' : 'nl',
          theme: themeSelect.getTheme(),
          nav,
          close,
          setBusy,
        });
        break;
      case 'empty':
        await handleEmpty({
          ...commonOpts,
          titleText: String(emptyTitleInput.value || '').trim(),
          langMode: langSelect.getLang(),
          themeId: themeSelect.getTheme(),
          focusTitle: () => emptyTitleInput.focus(),
        });
        break;
      case 'paste-text':
      case 'convert-file':
      case 'notion':
        await content.run({
          commonOpts,
          langMode: langSelect.getLang(),
          themeId: themeSelect.getTheme(),
        });
        break;
      case 'import-json':
      case 'import-markdown':
      case 'paste-markdown':
        await importMethod.run({
          commonOpts,
          langMode: langSelect.getLang(),
          themeId: themeSelect.getTheme(),
          btnAction,
        });
        break;
    }
  });

  // ===== Mount =====
  onKey = (e) => {
    if (e.key === 'Escape' && !busy) requestClose();
    if (e.key === 'Enter' && !busy && getEffectiveMode() === 'empty') btnAction.click();
  };
  window.addEventListener('keydown', onKey);

  root.append(backdrop);
  detachFocusTrap = createFocusTrap(modal);
  syncUI();

  // External preselection wins over the default blank focus: open straight into
  // the library compose flow with the building block seeded.
  const hasPreselectItems = Array.isArray(preselect?.items) && preselect.items.some(Boolean);
  if (!libraryDisabled && (preselect?.collection || hasPreselectItems)) {
    method = 'library';
    // Seed via the collections source, whose tray is the source of truth (so a
    // seeded slide can be removed without a picker round-trip).
    library.setMode('collections');
    syncThemeDefaultOpen();
    syncUI();
    if (preselect.collection) {
      // Render the chooser first so seedCollection can flag the active card.
      library.ensureCollectionsChooser().then(() => library.seedCollection(preselect.collection));
    } else {
      library.ensureCollectionsChooser();
      library.seedItems(preselect.items.filter(Boolean));
    }
  } else {
    emptyTitleInput.focus();
  }
}
