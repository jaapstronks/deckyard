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
  // null lets the visual picker adopt the workspace default theme; an explicit
  // preselected theme (e.g. duplicating within a themed context) overrides it.
  let themeId = preselectedTheme?.id || null;
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
  const titleEl = h('h2', {
    id: 'new-pres-title',
    text: t('list.newPresentation.title', 'New presentation'),
  });

  // ===== Section container =====
  const sectionsContainer = h('div', { class: 'new-pres-sections' });

  // --- Section 1: Start blank ---
  const blankSection = h('div', { class: 'new-pres-section is-selected', 'data-section': 'blank' });
  const blankHeader = h('label', { class: 'new-pres-section-header' });
  const blankRadio = h('input', { type: 'radio', name: 'new-pres-mode', value: 'blank', checked: true });
  blankHeader.append(
    blankRadio,
    h('span', { class: 'new-pres-section-title', text: t('list.newPresentation.section.blank', 'Start blank') })
  );
  const blankBody = h('div', { class: 'new-pres-section-body' });
  const emptyTitleInput = h('input', {
    class: 'form-input',
    placeholder: t('list.newPresentation.titlePlaceholder', 'Title...'),
  });
  blankBody.append(emptyTitleInput);
  blankSection.append(blankHeader, blankBody);

  // --- Section 2: From template ---
  const templateSection = h('div', { class: 'new-pres-section', 'data-section': 'template' });
  const templateHeader = h('label', { class: 'new-pres-section-header' });
  const templateRadio = h('input', { type: 'radio', name: 'new-pres-mode', value: 'template' });
  templateHeader.append(
    templateRadio,
    h('span', { class: 'new-pres-section-title', text: t('list.newPresentation.section.template', 'From template') }),
    h('span', { class: 'new-pres-section-desc', text: t('list.newPresentation.section.templateDesc', 'Pick a starter deck to customize') })
  );
  const templateBody = h('div', { class: 'new-pres-section-body' });
  const starterKitGrid = h('div', { class: 'starter-kit-grid' });
  const starterKitLoading = h('div', { class: 'help', text: t('common.loading', 'Loading...') });
  const starterKitEmpty = h('div', { class: 'help', text: t('list.newPresentation.starterKit.empty', 'No templates available yet.') });
  templateBody.append(starterKitLoading);
  templateSection.append(templateHeader, templateBody);

  let starterKitsData = [];
  const loadStarterKits = async () => {
    try {
      const all = await api('/api/presentations');
      starterKitsData = (Array.isArray(all) ? all : []).filter(p => p?.isStarterKit);
      starterKitGrid.innerHTML = '';

      if (starterKitsData.length === 0) {
        starterKitGrid.append(starterKitEmpty);
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
    } catch {
      starterKitGrid.innerHTML = '';
      starterKitGrid.append(h('div', { class: 'help is-error', text: t('common.loadError', 'Failed to load.') }));
    }
  };

  // --- Section 3: From content (AI) ---
  const contentSection = h('div', { class: 'new-pres-section', 'data-section': 'content' });
  if (aiDisabled) contentSection.classList.add('is-hidden');

  const contentHeader = h('label', { class: 'new-pres-section-header' });
  const contentRadio = h('input', { type: 'radio', name: 'new-pres-mode', value: 'content' });
  contentHeader.append(
    contentRadio,
    h('span', { class: 'new-pres-section-title', text: t('list.newPresentation.section.content', 'From content') }),
    h('span', { class: 'new-pres-section-badge', text: 'AI' }),
    h('span', { class: 'new-pres-section-desc', text: t('list.newPresentation.section.contentDesc', 'Paste notes, upload a file, or import from Notion') })
  );

  const contentBody = h('div', { class: 'new-pres-section-body' });

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
  contentBody.append(contentSubtabs, subContentWrap);
  contentSection.append(contentHeader, contentBody);

  // Check Notion availability
  api('/api/notion/status')
    .then((resp) => {
      if (resp?.enabled && !aiDisabled) {
        btnSubNotion.classList.remove('is-hidden');
      }
    })
    .catch(() => {});

  // Assemble sections
  sectionsContainer.append(blankSection, templateSection);
  if (!aiDisabled) sectionsContainer.append(contentSection);

  // ===== Shared theme + language =====
  const sharedWrap = h('div', { class: 'new-pres-shared' });
  const themeSelect = createVisualThemePicker({
    h, api, initialTheme: themeId,
    onChange: (id) => { themeId = id; },
  });
  const langSelect = createLangSelector({
    h, readLangMode, writeLangMode, getSupportedLangs,
    onChange: (l) => { langMode = l; },
  });
  sharedWrap.append(themeSelect.wrap, langSelect.wrap);

  // ===== Advanced import =====
  const advancedDetails = h('details', { class: 'new-pres-advanced' });
  const advancedSummary = h('summary', {
    text: t('list.newPresentation.advancedImport', 'Advanced import'),
  });
  const advancedBody = h('div', { class: 'new-pres-advanced-body' });

  // Advanced sub-tabs
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

  // Advanced sub-content
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
  advancedDetails.append(advancedSummary, advancedBody);

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
      'starter-kit': t('list.newPresentation.starterKit.use', 'Use template'),
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
    // 1. Toggle is-selected on section cards
    blankSection.classList.toggle('is-selected', section === 'blank');
    templateSection.classList.toggle('is-selected', section === 'template');
    contentSection.classList.toggle('is-selected', section === 'content');

    // 2. Section bodies shown/hidden via CSS (.is-selected .new-pres-section-body)

    // 3. Content sub-tabs
    btnSubPaste.classList.toggle('is-active', contentSubtab === 'paste');
    btnSubUpload.classList.toggle('is-active', contentSubtab === 'upload');
    btnSubNotion.classList.toggle('is-active', contentSubtab === 'notion');
    panelPaste.classList.toggle('is-hidden', contentSubtab !== 'paste');
    panelUpload.classList.toggle('is-hidden', contentSubtab !== 'upload');
    panelNotion.classList.toggle('is-hidden', contentSubtab !== 'notion');

    // 4. Advanced sub-tabs
    btnAdvJson.classList.toggle('is-active', advancedSubtab === 'json');
    btnAdvImportMd.classList.toggle('is-active', advancedSubtab === 'import-md');
    btnAdvPasteMd.classList.toggle('is-active', advancedSubtab === 'paste-md');
    panelJson.classList.toggle('is-hidden', advancedSubtab !== 'json');
    panelImportMd.classList.toggle('is-hidden', advancedSubtab !== 'import-md');
    panelPasteMd.classList.toggle('is-hidden', advancedSubtab !== 'paste-md');

    // 5. Dim main sections when advanced is active
    sectionsContainer.classList.toggle('is-advanced-active', useAdvanced);

    // 6. Update action button label
    btnAction.textContent = getButtonLabel(getEffectiveMode());

    // 7. Lazy load starter kits
    if (section === 'template' && !starterKitsLoaded) {
      starterKitsLoaded = true;
      templateBody.innerHTML = '';
      templateBody.append(starterKitGrid);
      loadStarterKits();
    }
  };

  // ===== Event wiring =====
  const onSectionChange = () => {
    section = blankRadio.checked ? 'blank' : templateRadio.checked ? 'template' : 'content';
    useAdvanced = false;
    syncUI();
  };
  blankRadio.addEventListener('change', onSectionChange);
  templateRadio.addEventListener('change', onSectionChange);
  contentRadio.addEventListener('change', onSectionChange);

  // Content sub-tab clicks
  btnSubPaste.addEventListener('click', () => { contentSubtab = 'paste'; syncUI(); });
  btnSubUpload.addEventListener('click', () => { contentSubtab = 'upload'; syncUI(); });
  btnSubNotion.addEventListener('click', () => { contentSubtab = 'notion'; syncUI(); });

  // Advanced sub-tab clicks
  btnAdvJson.addEventListener('click', () => { advancedSubtab = 'json'; useAdvanced = true; syncUI(); });
  btnAdvImportMd.addEventListener('click', () => { advancedSubtab = 'import-md'; useAdvanced = true; syncUI(); });
  btnAdvPasteMd.addEventListener('click', () => { advancedSubtab = 'paste-md'; useAdvanced = true; syncUI(); });

  // Details toggle
  advancedDetails.addEventListener('toggle', () => {
    useAdvanced = advancedDetails.open;
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
  // Middle content scrolls; title stays at the top and the actions footer
  // stays pinned at the bottom so Create is always reachable on short viewports.
  const scrollBody = h('div', { class: 'new-pres-scroll' });
  scrollBody.append(sectionsContainer, sharedWrap, advancedDetails, status);
  modal.append(titleEl, scrollBody, actions);

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
