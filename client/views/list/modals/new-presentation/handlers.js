/**
 * New Presentation Modal Handlers
 *
 * Action handlers for different creation modes (empty, paste-text, convert-file, notion, import-json).
 */

import { t } from '../../../../lib/ui-i18n.js';
import { generatePresentationStreaming } from '../../../../lib/net/ai-stream.js';
import { showLoadingModal } from '../../../../lib/dom/loading-modal.js';
import { createMessageRotator } from '../../../../lib/dom/status-message-rotator.js';
import { processSSEStream } from '../../../../lib/net/sse.js';
import { readFileAsDataUrl } from '../../../../lib/util/file.js';
import { nav } from '../../../../lib/state/router.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../../shared/i18n-utils.js';

/**
 * Wire an import's SSE progress events to the loading modal and its rotator.
 *
 * One contract for every streaming import (file conversion, Notion, paste
 * text), so the bar means the same thing everywhere
 * (`docs/reference/import-progress.md`):
 *
 * - **The bar belongs to the modal.** `setProgress` is monotone, and a phase
 *   that is one long model call carries `creepTo`, so it moves without
 *   claiming progress the server cannot measure.
 * - **The message line belongs to the rotator** once the server has handed it
 *   messages. `refine-progress` is real progress and therefore moves the bar
 *   only; the content-aware messages keep running beside it. The closing
 *   phases (`finalize`, `save`) stop the rotator and take over both.
 *
 * @param {Object} opts
 * @param {Object} opts.loadingModal - Controller from `showLoadingModal`.
 * @param {Object} opts.rotator - Controller from `createMessageRotator`.
 * @returns {{ onStatus: (data: Object) => void, onMessages: (data: Object) => void }}
 */
function createProgressBinding({ loadingModal, rotator }) {
  return {
    onStatus: (data) => {
      const phase = data?.phase || '';
      const closing = phase === 'finalize' || phase === 'save';
      const hasMessages = rotator.getState().messages.length > 0;

      if (closing) rotator.stop();

      // Real progress and the creep both move the bar, whoever owns the text.
      if (data?.progress) loadingModal.setProgress(data.progress);
      if (data?.creepTo) {
        loadingModal.creepTo(data.creepTo, { durationMs: data.creepMs });
      }

      // The text is the rotator's as soon as it has messages, except at the
      // close. `refine-progress` is a bar event: its section counter would
      // otherwise silence the content-aware messages.
      if (closing || (!hasMessages && phase !== 'refine-progress')) {
        loadingModal.update(data?.message || '', { immediate: closing });
      }
    },
    onMessages: (data) => {
      rotator.setMessages(data?.statusMessages || [], {
        interval: data?.intervalMs,
        loop: data?.loop,
      });
      rotator.start();
    },
  };
}

/**
 * Handle empty presentation creation.
 *
 * A missing title and a refusal from the server are states of the form, not
 * footer lines: both go through `refuse` with the field they name, and the
 * blank panel puts a `title` refusal under the title field and anything else
 * beside Create (docs/reference/feedback-surfaces.md). `setStatus` only
 * carries progress.
 *
 * @param {Object} opts
 * @param {(message: string, opts?: { field?: string }) => void} opts.refuse -
 *   Show a refusal; `field` is the one it names (`err.details.field` for a
 *   server refusal). Called after the form is usable again.
 */
export async function handleEmpty({
  api,
  titleText,
  langMode,
  themeId,
  close,
  setBusy,
  setStatus,
  refuse,
}) {
  if (!titleText) {
    refuse(t('list.newPresentation.titleRequired', 'Enter a title first.'), {
      field: 'title',
    });
    return;
  }
  const lang = normalizeLang(langMode) || DEFAULT_DECK_LANG;
  setBusy(true);
  setStatus(t('list.newPresentation.creating', 'Creating…'));
  try {
    const created = await api('/api/presentations', {
      method: 'POST',
      body: {
        title: titleText,
        lang,
        theme: themeId,
        settings: {
          stepParagraphs: true,
          transitions: { preset: 'fade' },
        },
      },
    });
    close();
    nav(`/app/${created.id}?lang=${encodeURIComponent(lang)}`);
  } catch (e) {
    setStatus('');
    setBusy(false);
    refuse(String(e?.message || e), { field: e?.details?.field });
  }
}

/**
 * Handle paste-text AI generation
 */
export async function handlePasteText({
  api,
  root,
  raw,
  langMode,
  themeId,
  close,
  setBusy,
  setStatus,
  hideBackdrop,
  showBackdrop,
  focusTextarea,
}) {
  if (!raw) {
    setStatus(t('list.aiWizard.pasteFirst', 'Paste content first.'));
    focusTextarea?.();
    return;
  }
  setBusy(true);
  hideBackdrop?.();

  const loadingModal = showLoadingModal({
    root,
    initialMessage: t(
      'list.newPresentation.preparing',
      'Preparing your presentation…',
    ),
    title: t('list.newPresentation.generatingTitle', 'Generating presentation'),
  });
  loadingModal.setProgress(5);

  const rotator = createMessageRotator({
    onUpdate: (message) => loadingModal.update(message),
  });
  const progressBinding = createProgressBinding({ loadingModal, rotator });

  try {
    const created = await generatePresentationStreaming({
      api,
      raw,
      lang: langMode,
      theme: themeId,
      vendor: null,
      settings: {
        stepParagraphs: true,
        transitions: { preset: 'fade' },
      },
      notionSourcePageId: null,
      onStatus: progressBinding.onStatus,
      onMessages: progressBinding.onMessages,
      onError: ({ message }) => {
        rotator.stop();
        loadingModal.update(
          message || t('editor.aiAppend.failed', 'Generation failed.'),
        );
      },
    });

    rotator.stop();
    loadingModal.update(t('common.done', 'Done'), { immediate: true });
    loadingModal.setProgress(100);
    await new Promise((r) => setTimeout(r, 500));
    loadingModal.close();
    close();
    // aiReview=1 opens the whole-deck review grid on top of the editor.
    nav(`/app/${created.id}?lang=${encodeURIComponent(langMode)}&aiReview=1`);
  } catch (e) {
    rotator.stop();
    // Fallback to V1
    try {
      loadingModal.update(t('editor.aiAppend.generating', 'Generating…'));
      const created = await api('/api/ai/wizard', {
        method: 'POST',
        body: {
          raw,
          lang: langMode,
          theme: themeId,
          settings: {
            stepParagraphs: true,
            transitions: { preset: 'fade' },
          },
        },
      });
      loadingModal.update(t('common.done', 'Done'), { immediate: true });
      loadingModal.setProgress(100);
      await new Promise((r) => setTimeout(r, 500));
      loadingModal.close();
      close();
      nav(`/app/${created.id}?lang=${encodeURIComponent(langMode)}&aiReview=1`);
    } catch (fallbackError) {
      loadingModal.close();
      showBackdrop?.();
      setStatus(String(fallbackError.message || fallbackError));
      setBusy(false);
    }
  }
}

/**
 * Handle file conversion (PPTX/PDF)
 */
export async function handleConvertFile({
  api,
  root,
  selectedFile,
  langMode,
  themeId,
  close,
  setBusy,
  setStatus,
  hideBackdrop,
  showBackdrop,
}) {
  if (!selectedFile) {
    setStatus(t('list.fileConverter.selectFirst', 'Select a file first.'));
    return;
  }
  setBusy(true);
  setStatus(t('list.fileConverter.reading', 'Reading file…'));

  const lang = normalizeLang(langMode) || DEFAULT_DECK_LANG;

  let dataUrl;
  try {
    dataUrl = await readFileAsDataUrl(selectedFile);
  } catch (e) {
    setStatus(String(e.message || e));
    setBusy(false);
    return;
  }

  hideBackdrop?.();
  const loadingModal = showLoadingModal({
    root,
    initialMessage: t('list.fileConverter.converting', 'Converting file…'),
    title: t('list.fileConverter.convertingTitle', 'Converting file'),
  });
  loadingModal.setProgress(5);

  const rotator = createMessageRotator({
    onUpdate: (message) => loadingModal.update(message),
  });
  const progressBinding = createProgressBinding({ loadingModal, rotator });

  try {
    let useStreaming = true;

    try {
      // SSE stream: progress events are read from response.body.
      // eslint-disable-next-line no-restricted-syntax
      const response = await fetch('/api/convert/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl,
          filename: selectedFile.name,
          lang,
          theme: themeId,
        }),
      });

      if (!response.ok || !response.body) {
        useStreaming = false;
      } else {
        let streamComplete = false;
        let streamError = false;

        await processSSEStream(response.body, {
          onStatus: progressBinding.onStatus,
          onMessages: progressBinding.onMessages,
          onComplete: async (data) => {
            streamComplete = true;
            rotator.stop();
            const result = data;
            loadingModal.update(t('common.done', 'Done'), { immediate: true });
            loadingModal.setProgress(100);
            await new Promise((r) => setTimeout(r, 500));
            loadingModal.close();
            close();
            nav(
              `/app/${result.presentation.id}?lang=${encodeURIComponent(lang)}`,
            );
          },
          onError: (data) => {
            streamError = true;
            rotator.stop();
            loadingModal.close();
            showBackdrop?.();
            setStatus(
              data?.message ||
                t('list.fileConverter.failed', 'Conversion failed.'),
            );
            setBusy(false);
          },
        });

        if (streamComplete || streamError) return;
      }
    } catch {
      useStreaming = false;
    }

    if (!useStreaming) {
      loadingModal.update(
        t('list.fileConverter.converting', 'Converting file…'),
      );
      const result = await api('/api/convert', {
        method: 'POST',
        body: {
          dataUrl,
          filename: selectedFile.name,
          lang,
          theme: themeId,
        },
      });

      if (result.success && result.presentation) {
        loadingModal.update(t('common.done', 'Done'), { immediate: true });
        loadingModal.setProgress(100);
        await new Promise((r) => setTimeout(r, 500));
        loadingModal.close();
        close();
        nav(`/app/${result.presentation.id}?lang=${encodeURIComponent(lang)}`);
      } else {
        loadingModal.close();
        showBackdrop?.();
        setStatus(
          result.error || t('list.fileConverter.failed', 'Conversion failed.'),
        );
        setBusy(false);
      }
    }
  } catch (e) {
    rotator.stop();
    loadingModal.close();
    showBackdrop?.();
    setStatus(String(e.message || e));
    setBusy(false);
  }
}

/**
 * Handle JSON import.
 *
 * A refusal (no file, not JSON, the server says no) is a state of the import
 * form, not a footer line: it goes through `refuse`, which the import tab
 * renders as an inline error at its control
 * (docs/reference/feedback-surfaces.md). `setStatus` only carries progress.
 *
 * @param {Object} opts
 * @param {(message: string) => void} opts.refuse - Show a refusal at the tab's
 *   control; called after the form is usable again.
 */
export async function handleImportJson({
  api,
  selectedFile,
  langMode,
  close,
  setBusy,
  setStatus,
  refuse,
}) {
  if (!selectedFile) {
    refuse(t('list.fileConverter.selectFirst', 'Select a file first.'));
    return;
  }
  setBusy(true);
  setStatus(t('list.newPresentation.importing', 'Importing…'));

  try {
    const text = await selectedFile.text();

    let deck;
    try {
      deck = JSON.parse(text);
    } catch (parseErr) {
      setStatus('');
      setBusy(false);
      refuse(
        t(
          'list.newPresentation.importJson.parseError',
          'This file is not valid JSON: {message}',
          { message: parseErr.message },
        ),
      );
      return;
    }

    // Use the language from the deck if available, otherwise fall back to langMode
    const lang =
      normalizeLang(deck?.lang) || normalizeLang(langMode) || DEFAULT_DECK_LANG;

    const created = await api('/api/presentations/import/json', {
      method: 'POST',
      body: { deck, lang },
    });

    // Use the language from the response (which reflects the actual presentation language)
    const navLang = created?.lang || lang;
    close();
    nav(`/app/${created.id}?lang=${encodeURIComponent(navLang)}`);
  } catch (e) {
    setStatus('');
    setBusy(false);
    refuse(String(e?.message || e));
  }
}

/**
 * Handle Markdown import. Refusals go through `refuse`, as for JSON.
 *
 * @param {Object} opts
 * @param {(message: string) => void} opts.refuse - Show a refusal at the tab's
 *   control; called after the form is usable again.
 */
export async function handleImportMarkdown({
  api,
  selectedFile,
  langMode,
  themeId,
  close,
  setBusy,
  setStatus,
  refuse,
  showWarnings,
}) {
  if (!selectedFile) {
    refuse(t('list.fileConverter.selectFirst', 'Select a file first.'));
    return;
  }
  setBusy(true);
  setStatus(t('list.newPresentation.importing', 'Importing…'));

  try {
    const markdown = await selectedFile.text();

    if (!markdown.trim()) {
      setStatus('');
      setBusy(false);
      refuse(
        t('list.newPresentation.importMarkdown.empty', 'The file is empty.'),
      );
      return;
    }

    const lang = normalizeLang(langMode) || DEFAULT_DECK_LANG;

    const created = await api('/api/presentations/import/markdown', {
      method: 'POST',
      body: { markdown, lang, theme: themeId },
    });

    const navLang = created?.lang || lang;
    const navUrl = `/app/${created.id}?lang=${encodeURIComponent(navLang)}`;
    const warnings = created?._importReport?.warnings || [];

    if (warnings.length > 0 && showWarnings) {
      showWarnings({ warnings, navUrl });
      return;
    }

    close();
    nav(navUrl);
  } catch (e) {
    setStatus('');
    setBusy(false);
    refuse(String(e?.message || e));
  }
}

/**
 * Handle Paste Markdown (direct text, no AI). Refusals go through `refuse`,
 * as for JSON; the refusal focuses the textarea.
 *
 * @param {Object} opts
 * @param {(message: string) => void} opts.refuse - Show a refusal at the
 *   textarea; called after the form is usable again.
 */
export async function handlePasteMarkdown({
  api,
  raw,
  langMode,
  themeId,
  close,
  setBusy,
  setStatus,
  refuse,
  showWarnings,
}) {
  if (!raw) {
    refuse(
      t(
        'list.newPresentation.pasteMarkdown.pasteFirst',
        'Paste markdown content first.',
      ),
    );
    return;
  }
  setBusy(true);
  setStatus(t('list.newPresentation.importing', 'Importing…'));

  try {
    const lang = normalizeLang(langMode) || DEFAULT_DECK_LANG;

    const created = await api('/api/presentations/import/markdown', {
      method: 'POST',
      body: { markdown: raw, lang, theme: themeId },
    });

    const navLang = created?.lang || lang;
    const navUrl = `/app/${created.id}?lang=${encodeURIComponent(navLang)}`;
    const warnings = created?._importReport?.warnings || [];

    if (warnings.length > 0 && showWarnings) {
      showWarnings({ warnings, navUrl });
      return;
    }

    close();
    nav(navUrl);
  } catch (e) {
    setStatus('');
    setBusy(false);
    refuse(String(e?.message || e));
  }
}

/**
 * Handle Notion import
 */
export async function handleNotion({
  api,
  root,
  notionUrl,
  themeId,
  close,
  setBusy,
  setStatus,
  hideBackdrop,
  showBackdrop,
  focusInput,
}) {
  if (!notionUrl) {
    setStatus(
      t(
        'list.newPresentation.notion.urlRequired',
        'Please enter a Notion page URL.',
      ),
    );
    focusInput?.();
    return;
  }
  setBusy(true);
  hideBackdrop?.();

  const loadingModal = showLoadingModal({
    root,
    initialMessage: t(
      'list.newPresentation.notion.importing',
      'Importing Notion page…',
    ),
    title: t(
      'list.newPresentation.notion.importingTitle',
      'Importing from Notion',
    ),
  });
  loadingModal.setProgress(5);

  const rotator = createMessageRotator({
    onUpdate: (message) => loadingModal.update(message),
  });
  const progressBinding = createProgressBinding({ loadingModal, rotator });

  try {
    let useStreaming = true;

    try {
      // SSE stream: progress events are read from response.body.
      // eslint-disable-next-line no-restricted-syntax
      const response = await fetch('/api/notion/import/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: notionUrl,
          theme: themeId,
        }),
      });

      if (!response.ok || !response.body) {
        useStreaming = false;
      } else {
        let streamComplete = false;
        let streamError = false;

        await processSSEStream(response.body, {
          onStatus: progressBinding.onStatus,
          onMessages: progressBinding.onMessages,
          onComplete: async (data) => {
            streamComplete = true;
            rotator.stop();
            const result = data;
            const detectedLang =
              normalizeLang(result.detectedLang) ||
              normalizeLang(result.presentation?.lang) ||
              DEFAULT_DECK_LANG;
            loadingModal.update(t('common.done', 'Done'), { immediate: true });
            loadingModal.setProgress(100);
            await new Promise((r) => setTimeout(r, 500));
            loadingModal.close();
            close();
            nav(
              `/app/${result.presentation.id}?lang=${encodeURIComponent(detectedLang)}`,
            );
          },
          onError: (data) => {
            streamError = true;
            rotator.stop();
            loadingModal.close();
            showBackdrop?.();
            setStatus(
              data?.message ||
                t('list.newPresentation.notion.failed', 'Import failed.'),
            );
            setBusy(false);
          },
        });

        if (streamComplete || streamError) return;
      }
    } catch {
      useStreaming = false;
    }

    // Fallback to non-streaming endpoint
    if (!useStreaming) {
      loadingModal.update(
        t('list.newPresentation.notion.importing', 'Importing Notion page…'),
      );
      const result = await api('/api/notion/import', {
        method: 'POST',
        body: {
          url: notionUrl,
          theme: themeId,
        },
      });

      if (result.success && result.presentation) {
        const detectedLang =
          normalizeLang(result.detectedLang) ||
          normalizeLang(result.presentation?.lang) ||
          DEFAULT_DECK_LANG;
        loadingModal.update(t('common.done', 'Done'), { immediate: true });
        loadingModal.setProgress(100);
        await new Promise((r) => setTimeout(r, 500));
        loadingModal.close();
        close();
        nav(
          `/app/${result.presentation.id}?lang=${encodeURIComponent(detectedLang)}`,
        );
      } else {
        loadingModal.close();
        showBackdrop?.();
        setStatus(
          result.error ||
            t('list.newPresentation.notion.failed', 'Import failed.'),
        );
        setBusy(false);
      }
    }
  } catch (e) {
    rotator.stop();
    loadingModal.close();
    showBackdrop?.();
    setStatus(String(e.message || e));
    setBusy(false);
  }
}
