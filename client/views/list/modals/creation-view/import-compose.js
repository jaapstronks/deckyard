/**
 * Import concern for the creation view.
 *
 * The "Import" method (.json / .md file / paste markdown) is a self-contained
 * sub-feature: pick a sub-tab, select a file or paste markdown, and import a
 * deck directly — no AI. Its active sub-tab, the two selected files, the
 * sub-tab DOM, and the inline import-warnings renderer all live here, exclusive
 * to this concern; the creation view only wires it in.
 *
 * Split out of creation-view/index.js (B10 P4 seam), behaviour-preserving.
 *
 * The host provides one callback:
 *   - onChange() — re-run the host's syncUI (the shared theme picker hides for
 *     JSON import, and the Create button label reads the active sub-tab).
 */

import { t } from '../../../../lib/ui-i18n.js';
import {
  handleImportJson,
  handleImportMarkdown,
  handlePasteMarkdown,
} from '../new-presentation/handlers.js';
import { h } from '../../../../lib/dom.js';
import { nav } from '../../../../lib/state/router.js';

/**
 * @param {object} opts
 * @param {() => void} opts.onChange - re-run host syncUI.
 * @returns {object} import controller
 */
export function createImportCompose({ onChange }) {
  const syncUI = () => onChange?.();

  // ===== State =====
  let importSubtab = 'json'; // json | import-md | paste-md
  let selectedImportFile = null;
  let selectedImportMdFile = null;

  // ===== Panel DOM =====
  const panel = h('div', {
    class: 'creation-panel is-hidden',
    'data-method': 'import',
  });
  const importSubtabs = h('div', { class: 'sb-segmented' });
  const btnImpJson = h('button', {
    type: 'button',
    class: 'sb-segmented-btn is-active',
    text: t('list.newPresentation.mode.importJson', 'Import JSON'),
  });
  const btnImpMd = h('button', {
    type: 'button',
    class: 'sb-segmented-btn',
    text: t('list.newPresentation.mode.importMarkdown', 'Import Markdown'),
  });
  const btnImpPasteMd = h('button', {
    type: 'button',
    class: 'sb-segmented-btn',
    text: t('list.newPresentation.mode.pasteMarkdown', 'Paste Markdown'),
  });
  importSubtabs.append(btnImpJson, btnImpMd, btnImpPasteMd);

  const panelJson = h('div', { class: 'creation-subpanel' });
  const importFileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'form-input',
  });
  const importFileInfo = h('div', { class: 'help', text: '' });
  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files?.[0];
    selectedImportFile = file || null;
    importFileInfo.textContent = file ? file.name : '';
  });
  panelJson.append(
    h('div', {
      class: 'help modal-hint',
      text: t(
        'list.newPresentation.importJson.help',
        'Import a presentation from a previously exported .json file.',
      ),
    }),
    importFileInput,
    importFileInfo,
  );

  const panelImportMd = h('div', { class: 'creation-subpanel is-hidden' });
  const importMdFileInput = h('input', {
    type: 'file',
    accept: '.md,.markdown,.zip,text/markdown,text/x-markdown,application/zip',
    class: 'form-input',
  });
  const importMdFileInfo = h('div', { class: 'help', text: '' });
  importMdFileInput.addEventListener('change', () => {
    const file = importMdFileInput.files?.[0];
    selectedImportMdFile = file || null;
    importMdFileInfo.textContent = file ? file.name : '';
  });
  panelImportMd.append(
    h('div', {
      class: 'help modal-hint',
      text: t(
        'list.newPresentation.importMarkdown.help',
        'Import a presentation from a markdown file or zip bundle (.md + images). Use --- to separate slides. No AI — slides are mapped directly from your markdown structure.',
      ),
    }),
    importMdFileInput,
    importMdFileInfo,
  );

  const panelPasteMd = h('div', { class: 'creation-subpanel is-hidden' });
  const pasteMdTextarea = h('textarea', {
    class: 'form-input form-textarea-lg',
    placeholder: t(
      'list.newPresentation.pasteMarkdown.placeholder',
      'Paste your markdown here…',
    ),
  });
  panelPasteMd.append(
    h('div', {
      class: 'help modal-hint',
      text: t(
        'list.newPresentation.pasteMarkdown.help',
        'Paste your markdown directly. Use --- to separate slides. No AI — slides are mapped directly from your markdown structure.',
      ),
    }),
    pasteMdTextarea,
  );

  const importSubWrap = h('div', { class: 'creation-subpanels' }, [
    panelJson,
    panelImportMd,
    panelPasteMd,
  ]);
  panel.append(importSubtabs, importSubWrap);

  btnImpJson.addEventListener('click', () => {
    importSubtab = 'json';
    syncUI();
  });
  btnImpMd.addEventListener('click', () => {
    importSubtab = 'import-md';
    syncUI();
  });
  btnImpPasteMd.addEventListener('click', () => {
    importSubtab = 'paste-md';
    syncUI();
  });

  // Update the panel's own sub-tabs to match the active sub-tab. Called from the
  // host's syncUI (the sub-tabs and their panels live inside this panel).
  const syncPanel = () => {
    btnImpJson.classList.toggle('is-active', importSubtab === 'json');
    btnImpMd.classList.toggle('is-active', importSubtab === 'import-md');
    btnImpPasteMd.classList.toggle('is-active', importSubtab === 'paste-md');
    panelJson.classList.toggle('is-hidden', importSubtab !== 'json');
    panelImportMd.classList.toggle('is-hidden', importSubtab !== 'import-md');
    panelPasteMd.classList.toggle('is-hidden', importSubtab !== 'paste-md');
  };

  // Resolve which concrete create-flow the active sub-tab runs.
  const getMode = () =>
    ({
      json: 'import-json',
      'import-md': 'import-markdown',
      'paste-md': 'paste-markdown',
    })[importSubtab];

  // Import warnings render inline in their sub-panel, turning Create into "Open".
  const makeWarningShower = (
    panel_,
    { setStatus, setBusy, btnAction, close },
  ) => {
    return ({ warnings, navUrl }) => {
      panel_.innerHTML = '';
      panel_.append(
        h('div', {
          class: 'help modal-hint',
          text: t(
            'list.newPresentation.importMarkdown.warningsIntro',
            'Import succeeded, but {count} issue(s) were detected:',
            { count: warnings.length },
          ),
        }),
      );
      const list = h('ul', { class: 'import-warnings' });
      for (const w of warnings)
        list.append(h('li', { class: 'help', text: w }));
      panel_.append(list);
      setStatus('');
      setBusy(false);
      btnAction.textContent = t(
        'list.newPresentation.importMarkdown.open',
        'Open presentation',
      );
      btnAction.onclick = (e) => {
        e.preventDefault();
        close();
        nav(navUrl);
      };
    };
  };

  // Run the active sub-tab's import flow. JSON import carries its own theme, so
  // it does not receive the shared theme id; the two markdown flows do.
  //
  // @param {object} ctx
  // @param {object} ctx.commonOpts - shared handler options (api, root, …).
  // @param {string} ctx.langMode - deck language mode.
  // @param {string} ctx.themeId - selected theme id (markdown flows only).
  // @param {HTMLElement} ctx.btnAction - the footer Create button (warning shower).
  const run = async ({ commonOpts, langMode, themeId, btnAction }) => {
    const warnCtx = { ...commonOpts, btnAction };
    switch (importSubtab) {
      case 'json':
        await handleImportJson({
          ...commonOpts,
          selectedFile: selectedImportFile,
          langMode,
        });
        break;
      case 'import-md':
        await handleImportMarkdown({
          ...commonOpts,
          selectedFile: selectedImportMdFile,
          langMode,
          themeId,
          showWarnings: makeWarningShower(panelImportMd, warnCtx),
        });
        break;
      case 'paste-md':
        await handlePasteMarkdown({
          ...commonOpts,
          raw: String(pasteMdTextarea.value || '').trim(),
          langMode,
          themeId,
          focusTextarea: () => pasteMdTextarea.focus(),
          showWarnings: makeWarningShower(panelPasteMd, warnCtx),
        });
        break;
    }
  };

  return {
    /** The import method's panel element (append into the right pane). */
    panel,
    /** Update the panel's own sub-tabs (call from host syncUI). */
    syncPanel,
    /** Effective create-mode for the active sub-tab. */
    getMode,
    /** Whether the active sub-tab brings its own theme (JSON import does). */
    carriesOwnTheme: () => importSubtab === 'json',
    /**
     * Whether the active sub-tab holds input worth guarding on close. Only the
     * paste-markdown textarea counts; a selected file is not "dirty" — both
     * match the pre-split behaviour.
     */
    isDirty: () =>
      importSubtab === 'paste-md' &&
      !!String(pasteMdTextarea.value || '').trim(),
    /** Run the active sub-tab's import flow. */
    run,
  };
}
