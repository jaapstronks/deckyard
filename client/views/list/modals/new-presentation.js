import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/modal.js';
import { getFeatures } from '../../../lib/features.js';
import { createVisualThemePicker } from '../../../lib/theme-select.js';
import { createLangSelector } from '../../../lib/lang-selector.js';
import {
  handleEmpty,
  handlePasteText,
  handleConvertFile,
  handleImportJson,
  handleImportMarkdown,
  handlePasteMarkdown,
  handleNotion,
} from './new-presentation/handlers.js';

export function openNewPresentationModal({
  h,
  api,
  root,
  nav,
  readLangMode,
  writeLangMode,
  getSupportedLangs,
  preselectedTheme,
} = {}) {
  const features = getFeatures() || {};
  const aiDisabled = !!features.disableAi;

  // ===== State =====
  let section = 'blank';
  let contentSubtab = 'paste';
  let advancedSubtab = 'json';
  let useAdvanced = false;
  let busy = false;
  let starterKitsLoaded = false;
  let selectedStarterKit = null;
  let selectedConvertFile = null;
  let selectedImportFile = null;
  let selectedImportMdFile = null;
  let themeId = preselectedTheme?.id || 'deckyard';
  let langMode = readLangMode();
  let onKey = null;

  const getEffectiveMode = () => {
    if (useAdvanced) {
      return { json: 'import-json', 'import-md': 'import-markdown', 'paste-md': 'paste-markdown' }[advancedSubtab];
    }
    if (section === 'blank') return 'empty';
    if (section === 'template') return 'starter-kit';
    return { paste: 'paste-text', upload: 'convert-file', notion: 'notion' }[contentSubtab];
  };

  // ===== Modal structure =====
  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', {
    class: 'modal modal-new-presentation',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'new-pres-title',
  });
  const header = h('div', { class: 'new-pres-header' });
  const titleEl = h('h2', {
    id: 'new-pres-title',
    text: t('list.newPresentation.title', 'New presentation'),
  });
  const subtitleEl = h('p', {
    class: 'new-pres-subtitle',
    text: t('list.newPresentation.subtitle', "Choose how you'd like to begin."),
  });
  header.append(titleEl, subtitleEl);

  // ===== Primary zone: mode switcher + swapping panel =====
  const primaryZone = h('div', { class: 'new-pres-primary' });

  // --- Mode switcher (segmented) ---
  const modeSwitcher = h('div', { class: 'new-pres-modes', role: 'tablist' });

  const makeModeButton = (value, labelKey, labelFallback, { badge } = {}) => {
    const btn = h('button', {
      type: 'button',
      class: 'new-pres-mode',
      role: 'tab',
      'data-mode': value,
    });
    btn.append(h('span', { class: 'new-pres-mode-label', text: t(labelKey, labelFallback) }));
    if (badge) {
      btn.append(h('span', { class: 'new-pres-mode-badge', text: badge }));
    }
    btn.addEventListener('click', () => {
      section = value;
      useAdvanced = false;
      syncUI();
    });
    return btn;
  };

  const modeBlankBtn = makeModeButton('blank', 'list.newPresentation.tab.blank', 'Blank');
  const modeTemplateBtn = makeModeButton('template', 'list.newPresentation.tab.template', 'Starter kit');
  const modeContentBtn = makeModeButton('content', 'list.newPresentation.tab.content', 'Content', { badge: 'AI' });

  modeSwitcher.append(modeBlankBtn, modeTemplateBtn);
  if (!aiDisabled) modeSwitcher.append(modeContentBtn);

  // --- Panels container ---
  const panelsWrap = h('div', { class: 'new-pres-panels' });

  // Panel 1: Start blank
  const panelBlank = h('div', { class: 'new-pres-panel', 'data-panel': 'blank' });
  const emptyTitleInput = h('input', {
    class: 'form-input',
    placeholder: t('list.newPresentation.titlePlaceholder', 'Title...'),
  });
  panelBlank.append(
    h('div', {
      class: 'help modal-hint',
      text: t('list.newPresentation.section.blankDesc', 'Give it a name now, or rename it later.'),
    }),
    emptyTitleInput
  );

  // Panel 2: From a starter kit (the app's term for a duplicatable template deck)
  const panelTemplate = h('div', { class: 'new-pres-panel is-hidden', 'data-panel': 'template' });
  const templateHint = h('div', {
    class: 'help modal-hint',
    text: t('list.newPresentation.section.templateDesc', 'Pick a starter kit and make it your own.'),
  });
  // Status line (loading / empty / error) lives outside the grid so it lines up
  // with the hint instead of picking up the grid's inner padding.
  const starterKitStatus = h('div', { class: 'help', text: t('common.loading', 'Loading...') });
  const starterKitGrid = h('div', { class: 'starter-kit-grid is-hidden' });
  const templateBody = h('div', { class: 'new-pres-panel-body' });
  templateBody.append(starterKitStatus, starterKitGrid);
  panelTemplate.append(templateHint, templateBody);

  const setKitStatus = (text, { error = false, hint = true } = {}) => {
    starterKitStatus.textContent = text || '';
    starterKitStatus.classList.toggle('is-hidden', !text);
    starterKitStatus.classList.toggle('is-error', !!error);
    starterKitGrid.classList.toggle('is-hidden', !!text);
    // When there are no kits, the "pick one" hint is redundant with the empty
    // message, so hide it and let the empty state carry the panel.
    templateHint.classList.toggle('is-hidden', !hint);
  };

  let starterKitsData = [];
  const loadStarterKits = async () => {
    try {
      const all = await api('/api/presentations');
      starterKitsData = (Array.isArray(all) ? all : []).filter(p => p?.isStarterKit);
      starterKitGrid.innerHTML = '';

      if (starterKitsData.length === 0) {
        setKitStatus(t('list.newPresentation.starterKit.empty', 'No starter kits available yet.'), { hint: false });
        return;
      }

      for (const kit of starterKitsData) {
        const kitCard = h('button', {
          class: 'starter-kit-card',
          type: 'button',
          onclick: () => {
            for (const c of starterKitGrid.querySelectorAll('.starter-kit-card')) {
              c.classList.remove('is-selected');
            }
            kitCard.classList.add('is-selected');
            selectedStarterKit = kit;
          },
        });
        kitCard.append(
          h('div', { class: 'starter-kit-card-title', text: kit.title }),
          h('div', { class: 'starter-kit-card-desc', text: kit.description || t('list.newPresentation.starterKit.noDesc', 'No description') })
        );
        starterKitGrid.append(kitCard);
      }
      setKitStatus('');
    } catch {
      starterKitGrid.innerHTML = '';
      setKitStatus(t('common.loadError', 'Failed to load.'), { error: true });
    }
  };

  // Panel 3: From content (AI)
  const panelContent = h('div', { class: 'new-pres-panel is-hidden', 'data-panel': 'content' });

  const contentHint = h('div', {
    class: 'help modal-hint',
    text: t('list.newPresentation.section.contentDesc', 'Paste notes, upload a file, or import from Notion.'),
  });

  // Content sub-tabs
  const contentSubtabs = h('div', { class: 'sb-segmented' });
  const btnSubPaste = h('button', {
    type: 'button',
    class: 'sb-segmented-btn is-active',
    text: t('list.newPresentation.subtab.pasteText', 'Paste text'),
  });
  const btnSubUpload = h('button', {
    type: 'button',
    class: 'sb-segmented-btn',
    text: t('list.newPresentation.subtab.uploadFile', 'Upload file'),
  });
  const btnSubNotion = h('button', {
    type: 'button',
    class: 'sb-segmented-btn is-hidden',
    text: t('list.newPresentation.subtab.notion', 'Notion'),
  });
  contentSubtabs.append(btnSubPaste, btnSubUpload, btnSubNotion);

  // Content sub-content areas
  const subContentWrap = h('div', { class: 'new-pres-subcontent' });

  // Paste text panel
  const panelPaste = h('div', { class: 'new-pres-content' });
  panelPaste.append(
    h('div', {
      class: 'help modal-hint',
      text: t('list.aiWizard.help', 'Paste your notes or any text. The wizard will turn it into a presentation automatically — you can edit everything afterwards.'),
    }),
    h('textarea', {
      class: 'form-input form-textarea-lg',
      placeholder: t('list.newPresentation.pasteText.placeholder', 'Paste your notes here...'),
    })
  );
  const pasteTextarea = panelPaste.querySelector('textarea');

  // Upload file panel
  const panelUpload = h('div', { class: 'new-pres-content is-hidden' });
  const convertFileInput = h('input', {
    type: 'file',
    accept: '.pptx,.pdf,.docx,.rtf,.odt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/rtf,application/vnd.oasis.opendocument.text',
    class: 'form-input',
  });
  const convertFileInfo = h('div', { class: 'help', text: '' });
  convertFileInput.addEventListener('change', () => {
    const file = convertFileInput.files?.[0];
    if (file) {
      selectedConvertFile = file;
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      convertFileInfo.textContent = `${file.name} (${sizeMB} MB)`;
    } else {
      selectedConvertFile = null;
      convertFileInfo.textContent = '';
    }
  });
  panelUpload.append(
    h('div', {
      class: 'help modal-hint',
      text: t('list.fileConverter.help', 'Upload a .pptx, .pdf, .docx, .rtf, or .odt file to convert it into a presentation. The converter will extract content and use AI to create appropriate slides.'),
    }),
    convertFileInput,
    convertFileInfo
  );

  // Notion panel
  const panelNotion = h('div', { class: 'new-pres-content is-hidden' });
  const notionUrlInput = h('input', {
    class: 'form-input',
    placeholder: t('list.newPresentation.notion.placeholder', 'Paste Notion page URL...'),
  });
  panelNotion.append(
    h('div', {
      class: 'help modal-hint',
      text: t('list.newPresentation.notion.help', 'Import a Notion page as a presentation. Images, tables, and text structure will be converted to appropriate slides.'),
    }),
    notionUrlInput
  );

  subContentWrap.append(panelPaste, panelUpload, panelNotion);
  panelContent.append(contentHint, contentSubtabs, subContentWrap);

  // Check Notion availability
  api('/api/notion/status')
    .then((resp) => {
      if (resp?.enabled && !aiDisabled) {
        btnSubNotion.classList.remove('is-hidden');
      }
    })
    .catch(() => {});

  // Assemble primary zone
  panelsWrap.append(panelBlank, panelTemplate);
  if (!aiDisabled) panelsWrap.append(panelContent);
  primaryZone.append(modeSwitcher, panelsWrap);

  // ===== Setup zone: theme + language + advanced =====
  const setupZone = h('div', { class: 'new-pres-setup' });

  const themeSelect = createVisualThemePicker({
    h, api, initialTheme: themeId,
    onChange: (id) => { themeId = id; },
  });
  const langSelect = createLangSelector({
    h, readLangMode, writeLangMode, getSupportedLangs,
    onChange: (l) => { langMode = l; },
  });

  // A starter kit brings its own theme and language, so the pickers are hidden
  // in that mode (the duplicate keeps the kit's own). This note explains why.
  const setupNote = h('div', {
    class: 'help modal-hint is-hidden',
    text: t('list.newPresentation.templateSetupNote', 'A starter kit brings its own theme and language.'),
  });

  // Language + advanced-import toggle share one row
  const setupRow = h('div', { class: 'new-pres-setup-row' });
  const advancedToggleBtn = h('button', {
    type: 'button',
    class: 'new-pres-advanced-toggle',
    'aria-expanded': 'false',
    text: t('list.newPresentation.advancedImport', 'Advanced import'),
  });
  setupRow.append(langSelect.wrap, advancedToggleBtn);

  // ===== Advanced import body =====
  const advancedBody = h('div', { class: 'new-pres-advanced-body is-hidden' });

  const advSubtabs = h('div', { class: 'sb-segmented' });
  const btnAdvJson = h('button', {
    type: 'button',
    class: 'sb-segmented-btn is-active',
    text: t('list.newPresentation.mode.importJson', 'Import JSON'),
  });
  const btnAdvImportMd = h('button', {
    type: 'button',
    class: 'sb-segmented-btn',
    text: t('list.newPresentation.mode.importMarkdown', 'Import Markdown'),
  });
  const btnAdvPasteMd = h('button', {
    type: 'button',
    class: 'sb-segmented-btn',
    text: t('list.newPresentation.mode.pasteMarkdown', 'Paste Markdown'),
  });
  advSubtabs.append(btnAdvJson, btnAdvImportMd, btnAdvPasteMd);

  const advSubContentWrap = h('div', { class: 'new-pres-adv-subcontent' });

  // JSON import panel
  const panelJson = h('div', { class: 'new-pres-content' });
  const importFileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'form-input',
  });
  const importFileInfo = h('div', { class: 'help', text: '' });
  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files?.[0];
    if (file) {
      selectedImportFile = file;
      importFileInfo.textContent = file.name;
    } else {
      selectedImportFile = null;
      importFileInfo.textContent = '';
    }
  });
  panelJson.append(
    h('div', {
      class: 'help modal-hint',
      text: t('list.newPresentation.importJson.help', 'Import a presentation from a previously exported .json file.'),
    }),
    importFileInput,
    importFileInfo
  );

  // Markdown file import panel
  const panelImportMd = h('div', { class: 'new-pres-content is-hidden' });
  const importMdFileInput = h('input', {
    type: 'file',
    accept: '.md,.markdown,.zip,text/markdown,text/x-markdown,application/zip',
    class: 'form-input',
  });
  const importMdFileInfo = h('div', { class: 'help', text: '' });
  importMdFileInput.addEventListener('change', () => {
    const file = importMdFileInput.files?.[0];
    if (file) {
      selectedImportMdFile = file;
      importMdFileInfo.textContent = file.name;
    } else {
      selectedImportMdFile = null;
      importMdFileInfo.textContent = '';
    }
  });
  panelImportMd.append(
    h('div', {
      class: 'help modal-hint',
      text: t('list.newPresentation.importMarkdown.help', 'Import a presentation from a markdown file or zip bundle (.md + images). Use --- to separate slides. No AI — slides are mapped directly from your markdown structure.'),
    }),
    importMdFileInput,
    importMdFileInfo
  );

  // Paste markdown panel
  const panelPasteMd = h('div', { class: 'new-pres-content is-hidden' });
  const pasteMdTextarea = h('textarea', {
    class: 'form-input form-textarea-lg',
    placeholder: t('list.newPresentation.pasteMarkdown.placeholder', 'Paste your markdown here...'),
  });
  panelPasteMd.append(
    h('div', {
      class: 'help modal-hint',
      text: t('list.newPresentation.pasteMarkdown.help', 'Paste your markdown directly. Use --- to separate slides. No AI — slides are mapped directly from your markdown structure.'),
    }),
    pasteMdTextarea
  );

  advSubContentWrap.append(panelJson, panelImportMd, panelPasteMd);
  advancedBody.append(advSubtabs, advSubContentWrap);

  setupZone.append(setupNote, themeSelect.wrap, setupRow, advancedBody);

  // ===== Status and actions =====
  const status = h('div', { class: 'help modal-status', text: '' });
  const actions = h('div', { class: 'row is-end modal-actions' });

  const close = () => {
    try {
      if (onKey) window.removeEventListener('keydown', onKey);
    } catch {}
    backdrop.remove();
  };

  const isDirty = () => {
    const mode = getEffectiveMode();
    if (mode === 'empty') return !!String(emptyTitleInput.value || '').trim();
    if (mode === 'paste-text') return !!String(pasteTextarea.value || '').trim();
    if (mode === 'paste-markdown') return !!String(pasteMdTextarea.value || '').trim();
    if (mode === 'notion') return !!String(notionUrlInput.value || '').trim();
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

  const setBusy = (v) => {
    busy = v;
    for (const el of modal.querySelectorAll('input, textarea, select, button')) {
      el.disabled = v;
    }
  };

  const setStatus = (text) => {
    status.textContent = text || '';
  };

  // ===== syncUI =====
  const getButtonLabel = (mode) => {
    const labels = {
      'empty': t('common.create', 'Create'),
      'starter-kit': t('list.newPresentation.starterKit.use', 'Use starter kit'),
      'paste-text': t('list.aiWizard.generate', 'Generate'),
      'convert-file': t('list.fileConverter.convert', 'Convert'),
      'notion': t('list.newPresentation.notion.import', 'Import'),
      'import-json': t('list.importJson', 'Import'),
      'import-markdown': t('list.importJson', 'Import'),
      'paste-markdown': t('list.importJson', 'Import'),
    };
    return labels[mode] || t('common.create', 'Create');
  };

  const syncUI = () => {
    // 1. Mode switcher active state + panel visibility. While Advanced import
    //    is open no mode is "current"; the switcher stays visible (muted) as
    //    the way back, and the primary panel is hidden so it can't crowd out
    //    the advanced panel below.
    modeBlankBtn.classList.toggle('is-active', section === 'blank' && !useAdvanced);
    modeTemplateBtn.classList.toggle('is-active', section === 'template' && !useAdvanced);
    modeContentBtn.classList.toggle('is-active', section === 'content' && !useAdvanced);
    modeBlankBtn.setAttribute('aria-selected', String(section === 'blank' && !useAdvanced));
    modeTemplateBtn.setAttribute('aria-selected', String(section === 'template' && !useAdvanced));
    modeContentBtn.setAttribute('aria-selected', String(section === 'content' && !useAdvanced));
    modeSwitcher.classList.toggle('is-muted', useAdvanced);
    panelsWrap.classList.toggle('is-hidden', useAdvanced);
    panelBlank.classList.toggle('is-hidden', section !== 'blank');
    panelTemplate.classList.toggle('is-hidden', section !== 'template');
    panelContent.classList.toggle('is-hidden', section !== 'content');

    // 2. Content sub-tabs
    btnSubPaste.classList.toggle('is-active', contentSubtab === 'paste');
    btnSubUpload.classList.toggle('is-active', contentSubtab === 'upload');
    btnSubNotion.classList.toggle('is-active', contentSubtab === 'notion');
    panelPaste.classList.toggle('is-hidden', contentSubtab !== 'paste');
    panelUpload.classList.toggle('is-hidden', contentSubtab !== 'upload');
    panelNotion.classList.toggle('is-hidden', contentSubtab !== 'notion');

    // 3. Advanced sub-tabs
    btnAdvJson.classList.toggle('is-active', advancedSubtab === 'json');
    btnAdvImportMd.classList.toggle('is-active', advancedSubtab === 'import-md');
    btnAdvPasteMd.classList.toggle('is-active', advancedSubtab === 'paste-md');
    panelJson.classList.toggle('is-hidden', advancedSubtab !== 'json');
    panelImportMd.classList.toggle('is-hidden', advancedSubtab !== 'import-md');
    panelPasteMd.classList.toggle('is-hidden', advancedSubtab !== 'paste-md');

    // 4. Advanced import open/closed — reveals the adv body
    advancedToggleBtn.classList.toggle('is-active', useAdvanced);
    advancedToggleBtn.setAttribute('aria-expanded', String(useAdvanced));
    advancedBody.classList.toggle('is-hidden', !useAdvanced);

    // 5. In starter-kit mode the theme + language pickers are irrelevant (the
    //    kit's own carry over on duplicate), so hide them and show a short note.
    //    Every other mode — including advanced import — uses them.
    const templateOnly = section === 'template' && !useAdvanced;
    themeSelect.wrap.classList.toggle('is-hidden', templateOnly);
    langSelect.wrap.classList.toggle('is-hidden', templateOnly);
    setupNote.classList.toggle('is-hidden', !templateOnly);

    // 6. Update action button label
    btnAction.textContent = getButtonLabel(getEffectiveMode());

    // 7. Lazy load starter kits
    if (section === 'template' && !starterKitsLoaded) {
      starterKitsLoaded = true;
      loadStarterKits();
    }
  };

  // ===== Event wiring =====
  // Content sub-tab clicks
  btnSubPaste.addEventListener('click', () => { contentSubtab = 'paste'; syncUI(); });
  btnSubUpload.addEventListener('click', () => { contentSubtab = 'upload'; syncUI(); });
  btnSubNotion.addEventListener('click', () => { contentSubtab = 'notion'; syncUI(); });

  // Advanced sub-tab clicks
  btnAdvJson.addEventListener('click', () => { advancedSubtab = 'json'; useAdvanced = true; syncUI(); });
  btnAdvImportMd.addEventListener('click', () => { advancedSubtab = 'import-md'; useAdvanced = true; syncUI(); });
  btnAdvPasteMd.addEventListener('click', () => { advancedSubtab = 'paste-md'; useAdvanced = true; syncUI(); });

  // Advanced import toggle
  advancedToggleBtn.addEventListener('click', () => {
    useAdvanced = !useAdvanced;
    syncUI();
  });

  // ===== Action handlers =====
  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: requestClose,
  });

  const btnAction = h('button', {
    class: 'btn btn-primary',
    text: t('common.create', 'Create'),
    onclick: async () => {
      const effectiveMode = getEffectiveMode();
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

      switch (effectiveMode) {
        case 'empty':
          await handleEmpty({
            ...commonOpts,
            titleText: String(emptyTitleInput.value || '').trim(),
            langMode: langSelect.getLang(),
            themeId: themeSelect.getTheme(),
            focusTitle: () => emptyTitleInput.focus(),
          });
          break;
        case 'starter-kit':
          if (!selectedStarterKit) {
            setStatus(t('list.newPresentation.starterKit.selectFirst', 'Please select a template first.'));
            return;
          }
          setBusy(true);
          setStatus(t('list.newPresentation.starterKit.duplicating', 'Creating your copy...'));
          try {
            const created = await api(`/api/presentations/${selectedStarterKit.id}/duplicate`, {
              method: 'POST',
            });
            close();
            nav?.(`/app/${created.id}`);
          } catch (e) {
            setStatus(String(e?.message || e));
            setBusy(false);
          }
          break;
        case 'paste-text':
          await handlePasteText({
            ...commonOpts,
            raw: String(pasteTextarea.value || '').trim(),
            langMode: langSelect.getLang(),
            themeId: themeSelect.getTheme(),
            focusTextarea: () => pasteTextarea.focus(),
          });
          break;
        case 'convert-file':
          await handleConvertFile({
            ...commonOpts,
            selectedFile: selectedConvertFile,
            langMode: langSelect.getLang(),
            themeId: themeSelect.getTheme(),
          });
          break;
        case 'notion':
          await handleNotion({
            ...commonOpts,
            notionUrl: String(notionUrlInput.value || '').trim(),
            themeId: themeSelect.getTheme(),
            focusInput: () => notionUrlInput.focus(),
          });
          break;
        case 'import-json':
          await handleImportJson({
            ...commonOpts,
            selectedFile: selectedImportFile,
            langMode: langSelect.getLang(),
          });
          break;
        case 'import-markdown':
          await handleImportMarkdown({
            ...commonOpts,
            selectedFile: selectedImportMdFile,
            langMode: langSelect.getLang(),
            themeId: themeSelect.getTheme(),
            showWarnings: ({ warnings, navUrl }) => {
              panelImportMd.innerHTML = '';
              const heading = h('div', {
                class: 'help modal-hint',
                text: t(
                  'list.newPresentation.importMarkdown.warningsIntro',
                  `Import succeeded, but ${warnings.length} issue(s) were detected:`
                ),
              });
              const list = h('ul', { class: 'import-warnings' });
              for (const w of warnings) {
                list.append(h('li', { class: 'help', text: w }));
              }
              panelImportMd.append(heading, list);
              setStatus('');
              setBusy(false);
              btnAction.textContent = t('list.newPresentation.importMarkdown.open', 'Open presentation');
              btnAction.onclick = (e) => {
                e.preventDefault();
                close();
                nav?.(navUrl);
              };
            },
          });
          break;
        case 'paste-markdown':
          await handlePasteMarkdown({
            ...commonOpts,
            raw: String(pasteMdTextarea.value || '').trim(),
            langMode: langSelect.getLang(),
            themeId: themeSelect.getTheme(),
            focusTextarea: () => pasteMdTextarea.focus(),
            showWarnings: ({ warnings, navUrl }) => {
              panelPasteMd.innerHTML = '';
              const heading = h('div', {
                class: 'help modal-hint',
                text: t(
                  'list.newPresentation.importMarkdown.warningsIntro',
                  `Import succeeded, but ${warnings.length} issue(s) were detected:`
                ),
              });
              const list = h('ul', { class: 'import-warnings' });
              for (const w of warnings) {
                list.append(h('li', { class: 'help', text: w }));
              }
              panelPasteMd.append(heading, list);
              setStatus('');
              setBusy(false);
              btnAction.textContent = t('list.newPresentation.importMarkdown.open', 'Open presentation');
              btnAction.onclick = (e) => {
                e.preventDefault();
                close();
                nav?.(navUrl);
              };
            },
          });
          break;
      }
    },
  });

  actions.append(btnCancel, btnAction);

  // ===== Assemble modal =====
  // Middle content scrolls; header stays at the top and the actions footer
  // stays pinned at the bottom so Create is always reachable on short viewports.
  const scrollBody = h('div', { class: 'new-pres-scroll' });
  scrollBody.append(primaryZone, setupZone, status);
  modal.append(header, scrollBody, actions);

  backdrop.append(modal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) requestClose();
  });

  onKey = (e) => {
    if (e.key === 'Escape' && !busy) requestClose();
    if (e.key === 'Enter' && !busy && getEffectiveMode() === 'empty') btnAction.click();
  };
  window.addEventListener('keydown', onKey);

  root.append(backdrop);
  syncUI();
  emptyTitleInput.focus();
}
