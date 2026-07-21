import { normalizeLang } from '../../lib/format/i18n.js';
import {
  fetchLlmStatus,
  labelForVendor,
  normalizeLlmVendor,
  pickInitialVendor,
  readPreferredLlmVendor,
  writePreferredLlmVendor,
} from '../../lib/net/llm-vendor.js';
import { t } from '../../lib/ui-i18n.js';
import { openModal } from '../../lib/dom/modal.js';
import { openAiBatchReviewModal } from './modals/ai-batch-review-modal.js';
import { highlightAiInsertedSlides } from './ai-added-highlight.js';

export function openAiAppendWizard({
  root,
  pres,
  afterSlideId,
  getSelectedSlideId,
  setSelectedSlideId,
  editorState,
  api,
  h,
  initialPrompt = '',
  // Review-step context (optional: without theme/SLIDE_TYPES the batch-review
  // step is skipped and slides insert directly, as before).
  theme = null,
  SLIDE_TYPES = null,
  openOverlayClosers = null,
  onReviewInserted = null,
} = {}) {
  const langMode = normalizeLang(pres?.i18n?.active) || 'nl';

  const ta = h('textarea', {
    class: 'form-input form-textarea-lg',
    placeholder:
      t(
        'editor.aiAppend.placeholder',
        'E.g.\n- Add 2 slides about approach and planning\n- Add a slide with a photo (placeholder) and 4 bullet points with key messages\n- Add a "list" slide with 6 tips (bullets)\n- Add a chart slide with a bar chart based on these numbers: ...\n'
      ),
  });
  // Prefilled when reached from the picker's "build with AI" escape hatch, so
  // the user's search query seeds the request. A textarea's value is its text
  // content (no `value` attribute), so set the property directly.
  if (typeof initialPrompt === 'string' && initialPrompt) {
    ta.value = initialPrompt;
  }

  // Content-only mode toggle (no chapter slides)
  let contentOnly = false;
  const contentOnlyCheckbox = h('input', {
    type: 'checkbox',
    id: 'ai-append-content-only',
    checked: false,
  });
  contentOnlyCheckbox.addEventListener('change', () => {
    contentOnly = contentOnlyCheckbox.checked;
  });
  const contentOnlyLabel = h('label', {
    for: 'ai-append-content-only',
    text: t(
      'editor.aiAppend.contentOnly',
      'Content slides only (no section headers)'
    ),
  });
  const contentOnlyWrap = h('div', { class: 'form-group form-group-checkbox' });
  contentOnlyWrap.append(contentOnlyCheckbox, contentOnlyLabel);

  // Verbatim mode: reproduce the entered copy as-is (only fix typos) instead of
  // letting the model rewrite it. For when the user already has finished copy.
  let verbatim = false;
  const verbatimCheckbox = h('input', {
    type: 'checkbox',
    id: 'ai-append-verbatim',
    checked: false,
  });
  verbatimCheckbox.addEventListener('change', () => {
    verbatim = verbatimCheckbox.checked;
  });
  const verbatimLabel = h('label', {
    for: 'ai-append-verbatim',
    text: t(
      'editor.aiAppend.verbatim',
      'Use my text verbatim (only fix typos, don’t rewrite)'
    ),
  });
  const verbatimWrap = h('div', { class: 'form-group form-group-checkbox' });
  verbatimWrap.append(verbatimCheckbox, verbatimLabel);
  const verbatimHint = h('div', {
    class: 'help',
    text: t(
      'editor.aiAppend.verbatimHint',
      'Keeps your wording as-is. Your text may mix instructions with the copy to place on the slides; the AI follows the instructions but quotes the copy instead of rephrasing it.'
    ),
  });

  const isDirty = () => !!String(ta.value || '').trim();

  const modalApi = openModal(h, root, {
    title: t('editor.aiAppend.title', 'AI: add slides'),
    isDirty,
    confirmMessage: t(
      'editor.aiAppend.confirmDiscard',
      'You have entered text. Close this wizard and discard your input?'
    ),
  });

  const langHint = h('div', {
    class: 'help',
    text:
      langMode === 'nl'
        ? t(
            'editor.aiAppend.langHint.nl',
            'Language mode: Dutch (AI output will be Dutch).'
          )
        : t(
            'editor.aiAppend.langHint.en',
            'Language mode: English (UK) (AI output will be English).'
          ),
  });
  const help = h('div', {
    class: 'help modal-hint-lg',
    text: t(
      'editor.aiAppend.help',
      'Describe what you want to add. You can request one or multiple slides at once. The AI also sees the existing presentation and tries to fit in logically. If you ask for a photo/image, an existing background image will be used as a placeholder (which you can replace afterwards).'
    ),
  });
  const status = h('div', {
    class: 'help ui-status-line',
  });
  const actions = h('div', {
    class: 'row is-end modal-actions',
  });

  // LLM vendor selection (persisted, shared with AI wizard + translations).
  let llmVendor = readPreferredLlmVendor();
  const llmWrap = h('div', { class: 'stack modal-field-narrow' });
  const llmLabel = h('div', { class: 'field-label', text: 'LLM' });
  const llmSelect = h('select', { class: 'form-input is-compact' });
  llmSelect.append(h('option', { value: '', text: '—' }));
  llmSelect.value = llmVendor || '';
  llmSelect.addEventListener('change', () => {
    llmVendor = String(llmSelect.value || '').trim() || null;
    writePreferredLlmVendor(llmVendor);
  });
  llmWrap.append(llmLabel, llmSelect);

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
  });
  const btnAdd = h('button', {
    class: 'btn btn-primary',
    text: t('editor.aiAppend.generateAdd', 'Generate & add'),
  });

  // While a generation is in flight the primary button flips to a Cancel
  // control (with a spinner) so a slow LLM call can be aborted; the textarea
  // stays editable so the user can keep drafting instead of a frozen modal.
  let controller = null;
  const isGenerating = () => !!controller;

  const setGenerating = (busy) => {
    btnAdd.classList.toggle('is-loading', busy);
    btnAdd.textContent = busy
      ? t('common.cancel', 'Cancel')
      : t('editor.aiAppend.generateAdd', 'Generate & add');
    // Keep the modal closable but flag busy so Esc/backdrop stay guarded by the
    // dirty check rather than hard-locking the wizard.
    llmSelect.disabled = busy || llmSelect.options.length <= 1;
    contentOnlyCheckbox.disabled = busy;
    verbatimCheckbox.disabled = busy;
    btnCancel.textContent = busy
      ? t('common.close', 'Close')
      : t('common.cancel', 'Cancel');
  };

  btnCancel.onclick = () => {
    if (isGenerating()) controller.abort();
    modalApi.requestClose();
  };

  const runGenerate = async () => {
    const raw = ta.value || '';
    if (!raw.trim()) {
      status.textContent = t(
        'editor.aiAppend.required',
        'First describe what you want to add.'
      );
      return;
    }

    status.textContent = t('editor.aiAppend.generating', 'Generating…');
    controller = new AbortController();
    setGenerating(true);

    try {
      const deck = {
        title: pres.title,
        theme: pres.theme,
        slides: (pres.slides || []).map((s) => ({
          type: s?.type,
          content: s?.content || {},
        })),
      };
      const requestBody = {
        raw,
        deck,
        lang: langMode,
        contentOnly,
        verbatim,
        ...(llmVendor ? { vendor: llmVendor } : {}),
      };
      const resp = await api('/api/ai/append-slides', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify(requestBody),
      });
      const newSlides = Array.isArray(resp?.slides) ? resp.slides : [];
      if (!newSlides.length) {
        status.textContent = t(
          'editor.aiAppend.noneReceived',
          'No slides received (please try again).'
        );
        return;
      }

      // Insert at the requested position. When the wizard was opened from an
      // insert "+" (or the number / "At end" controls), afterSlideId is
      // explicit: a slide id to insert after, or null for "at the beginning".
      // Otherwise (e.g. the standalone AI button) fall back to the selected
      // slide, appending at the end if nothing is selected. Position is
      // computed at insert time, so the review step can't go stale.
      const insertBatch = (slides) => {
        const selected = getSelectedSlideId?.();
        const hasExplicitPosition = typeof afterSlideId !== 'undefined';
        const anchorId = hasExplicitPosition ? afterSlideId : selected;
        const idx = (pres.slides || []).findIndex((s) => s.id === anchorId);
        const insertAt =
          idx >= 0
            ? idx + 1
            : hasExplicitPosition
              ? 0
              : (pres.slides || []).length;
        pres.slides.splice(insertAt, 0, ...slides);

        setSelectedSlideId?.(slides[0]?.id || selected);
        editorState.dirtyRefreshAll();
        highlightAiInsertedSlides({
          slideIds: slides.map((s) => s?.id),
          onReview:
            typeof onReviewInserted === 'function' ? onReviewInserted : null,
        });
      };

      // Multi-slide batches go through a review step first (single slides
      // insert directly — reviewing one slide is just the editor itself).
      const canReview = newSlides.length >= 2 && theme && SLIDE_TYPES;
      if (canReview) {
        modalApi.close();
        openAiBatchReviewModal({
          h,
          root,
          api,
          theme,
          SLIDE_TYPES,
          openOverlayClosers,
          batch: { slides: newSlides, rationale: resp?.rationale || '' },
          request: requestBody,
          onAccept: (slides) => insertBatch(slides),
        });
        return;
      }

      insertBatch(newSlides);
      modalApi.close();
    } catch (e) {
      if (e?.name === 'AbortError') {
        status.textContent = t(
          'editor.aiAppend.cancelled',
          'Generation cancelled.'
        );
      } else {
        status.textContent = String(e.message || e);
      }
    } finally {
      controller = null;
      setGenerating(false);
    }
  };

  btnAdd.onclick = () => {
    if (isGenerating()) {
      controller.abort();
      return;
    }
    runGenerate();
  };

  actions.append(btnCancel, btnAdd);
  modalApi.append(
    llmWrap,
    langHint,
    help,
    ta,
    contentOnlyWrap,
    verbatimWrap,
    verbatimHint,
    status,
    actions
  );
  ta.focus();

  // Populate LLM dropdown from server; default to server defaultVendor or stored value.
  fetchLlmStatus(api)
    .then((st) => {
      const configured = Array.isArray(st?.configuredVendors)
        ? st.configuredVendors
        : [];
      const initial = pickInitialVendor(st);
      llmSelect.innerHTML = '';
      for (const v of configured) {
        const norm = normalizeLlmVendor(v);
        if (!norm) continue;
        llmSelect.append(
          h('option', { value: norm, text: labelForVendor(norm, st) })
        );
      }
      llmVendor = initial;
      if (llmVendor) {
        llmSelect.value = llmVendor;
        writePreferredLlmVendor(llmVendor);
      } else {
        llmSelect.append(h('option', { value: '', text: '—' }));
        llmSelect.value = '';
      }
      llmSelect.disabled = isGenerating() || configured.length <= 1;
    })
    .catch(() => {});
}
