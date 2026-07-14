import { t } from '../../../lib/ui-i18n.js';
import { generatePresentationStreaming } from '../../../lib/ai-stream.js';
import { showLoadingModal } from '../../../lib/loading-modal.js';
import { createMessageRotator } from '../../../lib/status-message-rotator.js';
import { populateThemes } from '../../../lib/theme-select.js';
import { createLangSelector } from '../../../lib/lang-selector.js';
import { createLlmSelector } from '../../../lib/llm-vendor.js';
import { createQuickModal as createModal, createModalStatus } from '../../../lib/modal.js';
import { DEFAULT_THEME_ID, DEFAULT_THEME_NAME } from '../../../../shared/constants/themes.js';

export function openAiWizard({
  h,
  api,
  root,
  nav,
  readLangMode,
  writeLangMode,
  getSupportedLangs,
} = {}) {
  const readTransitionsPreset = (v) => {
    const s = String(v || '').trim();
    return s || 'none';
  };
  let notionEnabled = false;
  let notionKeyword = '';

  const ta = h('textarea', {
    class: 'form-input form-textarea-lg',
  });

  // Create modal with dirty check
  const modal = createModal({
    h,
    root,
    title: t('list.aiWizard.title', 'AI presentation wizard'),
    isDirty: () => !!String(ta.value || '').trim(),
    confirmMessage: t('list.aiWizard.confirmDiscard', 'You have entered text. Close the wizard and discard your input?'),
  });

  const help = h('div', {
    class: 'help modal-hint',
    text: t(
      'list.aiWizard.help',
      'Paste your notes or any text. The wizard will turn it into a presentation automatically — you can edit everything afterwards.'
    ),
  });

  // Notion suggestion UI
  const suggestWrap = h('div', { class: 'stack is-hidden' });
  const suggestTitle = h('div', { class: 'field-label', text: 'Notion' });
  const suggestSubjectsLabel = h('div', {
    class: 'help',
    text: t('list.aiWizard.notion.recent', 'Recent topics (or search below by keyword).'),
  });
  const suggestSearchRow = h('div', { class: 'row is-wrap' });
  const suggestKeywordInput = h('input', {
    class: 'form-input is-compact',
    type: 'text',
    placeholder: t('list.aiWizard.notion.keywordPlaceholder', 'Keyword (optional)'),
  });
  const btnKeywordSearch = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.search', 'Search'),
  });
  const btnKeywordGenerate = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('list.aiWizard.notion.searchGenerate', 'Search & generate'),
    title: t('list.aiWizard.notion.searchGenerate.title', 'Search multiple Notion pages about this term and generate a presentation.'),
  });
  suggestSearchRow.append(suggestKeywordInput, btnKeywordSearch, btnKeywordGenerate);
  const suggestBtns = h('div', { class: 'row is-wrap' });
  suggestWrap.append(suggestTitle, suggestSearchRow, suggestSubjectsLabel, suggestBtns);

  const status = createModalStatus(h);
  const actions = h('div', { class: 'row is-end modal-actions' });

  // LLM vendor selection
  const llmSelector = createLlmSelector({ h, api });

  // Theme selection
  let themeId = DEFAULT_THEME_ID;
  const themeWrap = h('div', { class: 'stack modal-field-narrow' });
  const themeLabel = h('div', { class: 'field-label', text: t('common.theme', 'Theme') });
  const themeSelect = h('select', { class: 'form-input is-compact' });
  themeSelect.append(
    h('option', { value: DEFAULT_THEME_ID, text: DEFAULT_THEME_NAME }),
    h('option', { value: 'clicknl', text: 'ClickNL' })
  );
  themeSelect.value = themeId;
  themeSelect.addEventListener('change', () => {
    themeId = String(themeSelect.value || DEFAULT_THEME_ID) || DEFAULT_THEME_ID;
  });
  themeWrap.append(themeLabel, themeSelect);

  // Populate themes from server
  populateThemes({
    api,
    h,
    select: themeSelect,
    currentTheme: themeId,
    onPopulated: (resolvedTheme) => {
      themeId = resolvedTheme;
    },
  });

  // Language selector
  const langSelector = createLangSelector({
    h,
    readLangMode,
    writeLangMode,
    getSupportedLangs,
    className: 'sb-segmented modal-lang-fixed',
  });
  let langMode = langSelector.getLang();

  const langHelp = h('div', {
    class: 'help',
    text: langMode === 'nl'
      ? t('editor.aiAppend.langHint.nl', 'Language mode: Dutch (AI output will be Dutch).')
      : t('editor.aiAppend.langHint.en', 'Language mode: English (UK) (AI output will be English).'),
  });

  // Override lang selector to update help text
  const originalLangSyncUi = langSelector.syncUi;
  langSelector.syncUi = () => {
    originalLangSyncUi();
    langMode = langSelector.getLang();
    langHelp.textContent = langMode === 'nl'
      ? t('editor.aiAppend.langHint.nl', 'Language mode: Dutch (AI output will be Dutch).')
      : t('editor.aiAppend.langHint.en', 'Language mode: English (UK) (AI output will be English).');
  };

  // Presentation length selector
  let targetLength = 'auto';
  const lengthWrap = h('div', { class: 'stack modal-field-narrow' });
  const lengthLabel = h('div', {
    class: 'field-label',
    text: t('list.aiWizard.length.title', 'Presentation length'),
  });
  const lengthSelect = h('select', { class: 'form-input is-compact' });
  lengthSelect.append(
    h('option', { value: 'auto', text: t('list.aiWizard.length.auto', 'Auto (smart detection)') }),
    h('option', { value: '5min', text: t('list.aiWizard.length.5min', 'Quick (5-8 slides)') }),
    h('option', { value: '10min', text: t('list.aiWizard.length.10min', 'Standard (10-15 slides)') }),
    h('option', { value: '20min', text: t('list.aiWizard.length.20min', 'Detailed (18-25 slides)') }),
    h('option', { value: '30min', text: t('list.aiWizard.length.30min', 'Comprehensive (25-35 slides)') })
  );
  lengthSelect.value = targetLength;
  lengthSelect.addEventListener('change', () => {
    targetLength = String(lengthSelect.value || 'auto') || 'auto';
  });
  const lengthHelp = h('div', {
    class: 'help',
    text: t('list.aiWizard.length.help', 'Controls how many slides are generated. Auto detects the right amount from your content.'),
  });
  lengthWrap.append(lengthLabel, lengthSelect, lengthHelp);

  // Presenter transition preset
  let transitionsPreset = readTransitionsPreset('none');
  const transitionsWrap = h('div', { class: 'stack modal-field-narrow' });
  const transitionsLabel = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.transitions.title', 'Presenter transition (slide to slide)'),
  });
  const transitionsSelect = h('select', { class: 'form-input is-compact' });
  const initTransitions = async () => {
    try {
      const m = await import('../../../lib/presenter-transitions.js');
      transitionsSelect.innerHTML = '';
      for (const opt of m.PRESENTER_TRANSITION_PRESETS) {
        transitionsSelect.append(h('option', { value: opt.value, text: opt.label }));
      }
      transitionsPreset = m.normalizePresenterTransitionPreset(transitionsPreset);
      transitionsSelect.value = transitionsPreset;
      transitionsSelect.addEventListener('change', () => {
        transitionsPreset = m.normalizePresenterTransitionPreset(transitionsSelect.value);
        transitionsSelect.value = transitionsPreset;
      });
    } catch {
      transitionsSelect.innerHTML = '';
      transitionsSelect.append(
        h('option', { value: 'none', text: t('common.none', 'None') }),
        h('option', { value: 'fade', text: 'Fade' }),
        h('option', { value: 'slide', text: 'Slide' }),
        h('option', { value: 'push', text: 'Push' }),
        h('option', { value: 'cube', text: '3D (Cube)' })
      );
      transitionsPreset = 'none';
      transitionsSelect.value = transitionsPreset;
      transitionsSelect.addEventListener('change', () => {
        const v = String(transitionsSelect.value || '').trim();
        transitionsPreset = v === 'fade' || v === 'slide' || v === 'push' || v === 'cube' ? v : 'none';
        transitionsSelect.value = transitionsPreset;
      });
    }
  };
  initTransitions();
  transitionsWrap.append(transitionsLabel, transitionsSelect);

  // Step mode
  let stepParagraphs = true;
  const stepsWrap = h('div', { class: 'stack modal-field-narrow' });
  const stepsLabel = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.steps.title', 'Steps (reveal content step-by-step)'),
  });
  const stepsSeg = h('div', { class: 'sb-segmented is-toggle' });
  const btnStepsOff = h('button', {
    class: 'sb-segmented-btn',
    type: 'button',
    text: t('common.off', 'Off'),
    onclick: () => {
      stepParagraphs = false;
      syncStepsUi();
    },
  });
  const btnStepsOn = h('button', {
    class: 'sb-segmented-btn',
    type: 'button',
    text: t('common.on', 'On'),
    onclick: () => {
      stepParagraphs = true;
      syncStepsUi();
    },
  });
  stepsSeg.append(btnStepsOff, btnStepsOn);
  const stepsHelp = h('div', {
    class: 'help',
    text: t('editor.deckSettings.steps.help', 'Reveal text/elements step by step during presentation (arrows or space).'),
  });
  const syncStepsUi = () => {
    btnStepsOff.classList.toggle('is-active', !stepParagraphs);
    btnStepsOn.classList.toggle('is-active', !!stepParagraphs);
    btnStepsOff.setAttribute('aria-pressed', stepParagraphs ? 'false' : 'true');
    btnStepsOn.setAttribute('aria-pressed', stepParagraphs ? 'true' : 'false');
  };
  syncStepsUi();
  stepsWrap.append(stepsLabel, stepsSeg, stepsHelp);

  const setBusy = (v) => {
    modal.setBusy(v);
    btnCreate.disabled = v;
    btnSuggest.disabled = v || !notionEnabled;
    btnCancel.disabled = v;
    ta.disabled = v;
    themeSelect.disabled = v;
    lengthSelect.disabled = v;
    transitionsSelect.disabled = v;
    btnStepsOff.disabled = v;
    btnStepsOn.disabled = v;
    llmSelector.setDisabled(v);
    langSelector.setDisabled?.(v);
    suggestKeywordInput.disabled = v;
    btnKeywordSearch.disabled = v || !notionEnabled;
    btnKeywordGenerate.disabled = v || !notionEnabled;
    for (const el of Array.from(suggestBtns.querySelectorAll('button'))) {
      el.disabled = v;
    }
  };

  const runWizardFromRaw = async (raw) => {
    modal.hide();

    const loadingModal = showLoadingModal({
      h,
      root,
      initialMessage: t('list.newPresentation.preparing', 'Preparing your presentation...'),
      title: t('list.newPresentation.generatingTitle', 'Generating presentation'),
    });

    loadingModal.setProgress(5);

    const rotator = createMessageRotator({
      onUpdate: (message, progress) => {
        loadingModal.update(message);
        loadingModal.setProgress(progress);
      },
    });

    try {
      const created = await generatePresentationStreaming({
        api,
        raw,
        lang: langMode,
        theme: themeId,
        vendor: llmSelector.getVendor(),
        targetLength,
        settings: {
          stepParagraphs: !!stepParagraphs,
          transitions: { preset: transitionsPreset },
        },
        onStatus: ({ message, progress }) => {
          if (!rotator.getState().messages.length) {
            loadingModal.update(message);
            if (progress) loadingModal.setProgress(progress);
          }
        },
        onMessages: ({ statusMessages }) => {
          rotator.setMessages(statusMessages || []);
          rotator.start();
        },
        onError: ({ error }) => {
          rotator.stop();
          loadingModal.update(error || t('editor.aiAppend.failed', 'Generation failed.'));
        },
      });

      rotator.stop();
      loadingModal.update(t('common.done', 'Done!'));
      loadingModal.setProgress(100);

      await new Promise((r) => setTimeout(r, 800));
      loadingModal.close();
      modal.close();
      nav?.(`/app/${created.id}?lang=${encodeURIComponent(langMode)}`);
    } catch (e) {
      rotator.stop();
      console.warn('[AI Wizard] Streaming failed, falling back to V1:', e.message);
      loadingModal.update(t('editor.aiAppend.generating', 'Generating...'));

      try {
        const created = await api('/api/ai/wizard', {
          method: 'POST',
          body: JSON.stringify({
            raw,
            lang: langMode,
            theme: themeId,
            targetLength,
            settings: {
              stepParagraphs: !!stepParagraphs,
              transitions: { preset: transitionsPreset },
            },
            ...(llmSelector.getVendor() ? { vendor: llmSelector.getVendor() } : {}),
          }),
        });

        loadingModal.update(t('common.done', 'Done!'));
        loadingModal.setProgress(100);
        await new Promise((r) => setTimeout(r, 800));
        loadingModal.close();
        modal.close();
        nav?.(`/app/${created.id}?lang=${encodeURIComponent(langMode)}`);
      } catch (fallbackError) {
        loadingModal.close();
        modal.unhide();
        status.setText(String(fallbackError.message || fallbackError));
        throw fallbackError;
      }
    }
  };

  const loadSubjects = async ({ keyword = '' } = {}) => {
    const kw = String(keyword || '').trim();
    notionKeyword = kw;
    const resp = await api('/api/notion/subjects', {
      method: 'POST',
      body: JSON.stringify(kw ? { keyword: kw } : {}),
    });
    const subjects = Array.isArray(resp?.subjects) ? resp.subjects : [];
    suggestBtns.innerHTML = '';
    if (!subjects.length) return [];
    for (const s of subjects) {
      const pageId = String(s?.pageId || '').trim();
      const subjTitle = String(s?.title || '').trim();
      const subjKeyword = String(s?.keyword || '').trim();
      if (!pageId) continue;
      const b = h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: subjTitle || t('list.aiWizard.notion.topic', 'Topic'),
        onclick: async () => {
          if (modal.isBusy()) return;
          status.setText(t('editor.aiAppend.generating', 'Generating...'));
          setBusy(true);
          try {
            const chosenKeyword = String(suggestKeywordInput.value || '').trim() || subjKeyword;
            const composed = await api('/api/notion/compose', {
              method: 'POST',
              body: JSON.stringify({ pageId, ...(chosenKeyword ? { keyword: chosenKeyword } : {}) }),
            });
            const raw = String(composed?.raw || '').trim();
            if (!raw) throw new Error(t('list.aiWizard.notion.noneFound', 'No Notion content found.'));
            await runWizardFromRaw(raw);
          } catch (e) {
            status.setText(String(e.message || e));
          } finally {
            setBusy(false);
          }
        },
      });
      suggestBtns.append(b);
    }
    return subjects;
  };

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.requestClose(),
  });
  const btnSuggest = h('button', {
    class: 'btn btn-secondary',
    text: t('list.aiWizard.notion.suggest', 'Suggest a topic'),
    title: t('list.aiWizard.notion.suggest.title', 'Fetch a recent Notion page (optional; requires NOTION_SECRET on the server).'),
    onclick: async () => {
      if (modal.isBusy()) return;
      status.setText(t('list.aiWizard.notion.fetching', 'Fetching topics...'));
      setBusy(true);
      try {
        suggestKeywordInput.value = '';
        notionKeyword = '';
        const subjects = await loadSubjects({ keyword: '' });
        if (!subjects.length) {
          status.setText(t('list.aiWizard.notion.noneTopics', 'No topics found.'));
          return;
        }
        status.setText(t('list.aiWizard.notion.chooseTopic', 'Choose a topic...'));
      } catch (e) {
        status.setText(String(e.message || e));
      } finally {
        setBusy(false);
      }
    },
  });
  const btnCreate = h('button', {
    class: 'btn btn-primary',
    text: t('list.aiWizard.generate', 'Generate'),
    onclick: async () => {
      const raw = ta.value || '';
      if (!raw.trim()) {
        status.setText(t('list.aiWizard.pasteFirst', 'Paste content first.'));
        return;
      }
      status.setText(t('editor.aiAppend.generating', 'Generating...'));
      setBusy(true);
      try {
        await runWizardFromRaw(raw);
      } catch (e) {
        status.setText(String(e.message || e));
      } finally {
        setBusy(false);
      }
    },
  });

  actions.append(btnSuggest, btnCancel, btnCreate);

  modal.append(
    help,
    llmSelector.wrap,
    themeWrap,
    lengthWrap,
    transitionsWrap,
    stepsWrap,
    langSelector.wrap,
    langHelp,
    suggestWrap,
    ta,
    status.el,
    actions
  );

  modal.show();
  ta.focus();

  suggestKeywordInput.addEventListener('input', () => {
    notionKeyword = String(suggestKeywordInput.value || '').trim();
  });
  btnKeywordSearch.addEventListener('click', async () => {
    if (modal.isBusy() || !notionEnabled) return;
    const kw = String(suggestKeywordInput.value || '').trim();
    if (!kw) {
      status.setText(t('list.aiWizard.notion.enterKeyword', 'Enter a keyword.'));
      suggestKeywordInput.focus();
      return;
    }
    status.setText(t('list.aiWizard.notion.searching', 'Searching...'));
    setBusy(true);
    try {
      const subjects = await loadSubjects({ keyword: kw });
      if (!subjects.length) {
        status.setText(t('list.aiWizard.notion.noneForKeyword', 'No topics found for this keyword.'));
        return;
      }
      suggestWrap.classList.remove('is-hidden');
      status.setText(t('list.aiWizard.notion.chooseTopic', 'Choose a topic...'));
    } catch (e) {
      status.setText(String(e.message || e));
    } finally {
      setBusy(false);
    }
  });
  btnKeywordGenerate.addEventListener('click', async () => {
    if (modal.isBusy() || !notionEnabled) return;
    const kw = String(suggestKeywordInput.value || '').trim();
    if (kw.length < 3) {
      status.setText(t('list.aiWizard.notion.keywordTooShort', 'Keyword is too short.'));
      suggestKeywordInput.focus();
      return;
    }
    status.setText(t('editor.aiAppend.generating', 'Generating...'));
    setBusy(true);
    try {
      const composed = await api('/api/notion/compose', {
        method: 'POST',
        body: JSON.stringify({ keyword: kw }),
      });
      const raw = String(composed?.raw || '').trim();
      if (!raw) throw new Error(t('list.aiWizard.notion.noneFound', 'No Notion content found.'));
      await runWizardFromRaw(raw);
    } catch (e) {
      status.setText(String(e.message || e));
    } finally {
      setBusy(false);
    }
  });

  // Enable Notion suggestions when the server is configured
  api('/api/notion/status')
    .then((resp) => {
      notionEnabled = !!resp?.enabled;
      btnSuggest.disabled = modal.isBusy() || !notionEnabled;
      btnSuggest.classList.toggle('is-hidden', !notionEnabled);
      suggestWrap.classList.toggle('is-hidden', !notionEnabled);
      btnKeywordSearch.disabled = modal.isBusy() || !notionEnabled;
      btnKeywordGenerate.disabled = modal.isBusy() || !notionEnabled;
    })
    .catch(() => {
      notionEnabled = false;
      btnSuggest.disabled = true;
      btnSuggest.classList.add('is-hidden');
      suggestWrap.classList.add('is-hidden');
      btnKeywordSearch.disabled = true;
      btnKeywordGenerate.disabled = true;
    });
}