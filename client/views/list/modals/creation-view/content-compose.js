/**
 * Content-compose concern for the creation view.
 *
 * The "From content · AI" method is a self-contained sub-feature: paste text,
 * upload a document, or import a Notion page, and let the AI wizard turn it into
 * a deck. All of its state — the active sub-tab and the selected upload file —
 * lives here, exclusive to this concern; the creation view only wires it in.
 *
 * Split out of creation-view/index.js (B10 P4 seam), behaviour-preserving.
 *
 * The host provides two things:
 *   - onChange()   — re-run the host's syncUI (the Create button label reads the
 *     active sub-tab; the shared theme picker applies to every sub-tab).
 *   - aiDisabled   — when true the method is never surfaced in the rail, but the
 *     panel is still built (hidden); it only gates the Notion sub-tab reveal.
 */

import { t } from '../../../../lib/ui-i18n.js';
import {
  handlePasteText,
  handleConvertFile,
  handleNotion,
} from '../new-presentation/handlers.js';
import { h } from '../../../../lib/dom.js';

/**
 * @param {object} opts
 * @param {Function} opts.api - fetch wrapper.
 * @param {() => void} opts.onChange - re-run host syncUI.
 * @param {boolean} opts.aiDisabled - AI features off (gates the Notion reveal).
 * @returns {object} content-compose controller
 */
export function createContentCompose({ api, onChange, aiDisabled }) {
  const syncUI = () => onChange?.();

  // ===== State =====
  let contentSubtab = 'paste'; // paste | upload | notion
  let selectedConvertFile = null;

  // ===== Panel DOM =====
  const panel = h('div', {
    class: 'creation-panel is-hidden',
    'data-method': 'content',
  });
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

  const panelPaste = h('div', { class: 'creation-subpanel' });
  panelPaste.append(
    h('div', {
      class: 'help modal-hint',
      text: t(
        'list.aiWizard.help',
        'Paste your notes or any text. The wizard will turn it into a presentation automatically — you can edit everything afterwards.',
      ),
    }),
    h('textarea', {
      class: 'form-input form-textarea-lg',
      placeholder: t(
        'list.newPresentation.pasteText.placeholder',
        'Paste your notes here…',
      ),
    }),
  );
  const pasteTextarea = panelPaste.querySelector('textarea');

  const panelUpload = h('div', { class: 'creation-subpanel is-hidden' });
  const convertFileInput = h('input', {
    type: 'file',
    accept:
      '.pptx,.pdf,.docx,.rtf,.odt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/rtf,application/vnd.oasis.opendocument.text',
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
      text: t(
        'list.fileConverter.help',
        'Upload a .pptx, .pdf, .docx, .rtf, or .odt file to convert it into a presentation. The converter will extract content and use AI to create appropriate slides. Review the result afterwards.',
      ),
    }),
    convertFileInput,
    convertFileInfo,
  );

  const panelNotion = h('div', { class: 'creation-subpanel is-hidden' });
  const notionUrlInput = h('input', {
    class: 'form-input',
    placeholder: t(
      'list.newPresentation.notion.placeholder',
      'Paste Notion page URL…',
    ),
  });
  panelNotion.append(
    h('div', {
      class: 'help modal-hint',
      text: t(
        'list.newPresentation.notion.help',
        'Import a Notion page as a presentation. Images, tables, and text structure will be converted to appropriate slides.',
      ),
    }),
    notionUrlInput,
  );

  const contentSubWrap = h('div', { class: 'creation-subpanels' }, [
    panelPaste,
    panelUpload,
    panelNotion,
  ]);
  panel.append(contentSubtabs, contentSubWrap);

  // Reveal the Notion sub-tab only when the integration is configured.
  api('/api/notion/status')
    .then((resp) => {
      if (resp?.enabled && !aiDisabled)
        btnSubNotion.classList.remove('is-hidden');
    })
    .catch(() => {});

  btnSubPaste.addEventListener('click', () => {
    contentSubtab = 'paste';
    syncUI();
  });
  btnSubUpload.addEventListener('click', () => {
    contentSubtab = 'upload';
    syncUI();
  });
  btnSubNotion.addEventListener('click', () => {
    contentSubtab = 'notion';
    syncUI();
  });

  // Update the panel's own sub-tabs to match the active sub-tab. Called from the
  // host's syncUI (the sub-tabs and their panels live inside this panel).
  const syncPanel = () => {
    btnSubPaste.classList.toggle('is-active', contentSubtab === 'paste');
    btnSubUpload.classList.toggle('is-active', contentSubtab === 'upload');
    btnSubNotion.classList.toggle('is-active', contentSubtab === 'notion');
    panelPaste.classList.toggle('is-hidden', contentSubtab !== 'paste');
    panelUpload.classList.toggle('is-hidden', contentSubtab !== 'upload');
    panelNotion.classList.toggle('is-hidden', contentSubtab !== 'notion');
  };

  // Resolve which concrete create-flow the active sub-tab runs.
  const getMode = () =>
    ({ paste: 'paste-text', upload: 'convert-file', notion: 'notion' })[
      contentSubtab
    ];

  // Run the active sub-tab's create flow. Dispatches to the shared handlers,
  // passing the shared language + theme selected in the host footer.
  //
  // @param {object} ctx
  // @param {object} ctx.commonOpts - shared handler options (api, h, root, …).
  // @param {string} ctx.langMode - deck language mode.
  // @param {string} ctx.themeId - selected theme id.
  const run = async ({ commonOpts, langMode, themeId }) => {
    switch (contentSubtab) {
      case 'paste':
        await handlePasteText({
          ...commonOpts,
          raw: String(pasteTextarea.value || '').trim(),
          langMode,
          themeId,
          focusTextarea: () => pasteTextarea.focus(),
        });
        break;
      case 'upload':
        await handleConvertFile({
          ...commonOpts,
          selectedFile: selectedConvertFile,
          langMode,
          themeId,
        });
        break;
      case 'notion':
        await handleNotion({
          ...commonOpts,
          notionUrl: String(notionUrlInput.value || '').trim(),
          themeId,
          focusInput: () => notionUrlInput.focus(),
        });
        break;
    }
  };

  return {
    /** The content method's panel element (append into the right pane). */
    panel,
    /** Update the panel's own sub-tabs (call from host syncUI). */
    syncPanel,
    /** Effective create-mode for the active sub-tab. */
    getMode,
    /**
     * Whether the active sub-tab holds input worth guarding on close. Only the
     * visible sub-tab counts, and a selected upload file is intentionally not
     * "dirty" — both match the pre-split behaviour.
     */
    isDirty: () => {
      if (contentSubtab === 'paste')
        return !!String(pasteTextarea.value || '').trim();
      if (contentSubtab === 'notion')
        return !!String(notionUrlInput.value || '').trim();
      return false;
    },
    /** Run the active sub-tab's create flow. */
    run,
  };
}
