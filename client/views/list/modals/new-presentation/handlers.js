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

/**
 * Handle empty presentation creation
 */
export async function handleEmpty({
  api,
  titleText,
  langMode,
  themeId,
  close,
  nav,
  setBusy,
  setStatus,
  focusTitle,
}) {
  if (!titleText) {
    setStatus(t('list.newPresentation.titleRequired', 'Please enter a title.'));
    focusTitle?.();
    return;
  }
  const lang = langMode === 'en-GB' ? 'en-GB' : 'nl';
  setBusy(true);
  setStatus(t('list.newPresentation.creating', 'Creating...'));
  try {
    const created = await api('/api/presentations', {
      method: 'POST',
      body: JSON.stringify({
        title: titleText,
        lang,
        theme: themeId,
        settings: {
          stepParagraphs: true,
          transitions: { preset: 'fade' },
        },
      }),
    });
    close();
    nav?.(`/app/${created.id}?lang=${encodeURIComponent(lang)}`);
  } catch (e) {
    setStatus(String(e?.message || e));
    setBusy(false);
  }
}

/**
 * Handle paste-text AI generation
 */
export async function handlePasteText({
  api,
  h,
  root,
  raw,
  langMode,
  themeId,
  close,
  nav,
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
      vendor: null,
      settings: {
        stepParagraphs: true,
        transitions: { preset: 'fade' },
      },
      notionSourcePageId: null,
      onStatus: ({ message, progress, phase }) => {
        // Real progress from the staged pipeline ("Wrote section 2 of 5…")
        // takes over from the rotating placeholder messages.
        if (phase === 'refine-progress' || phase === 'save' || phase === 'finalize') {
          rotator.stop();
          loadingModal.update(message);
          if (progress) loadingModal.setProgress(progress);
          return;
        }
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
    close();
    // aiReview=1 opens the whole-deck review grid on top of the editor.
    nav?.(`/app/${created.id}?lang=${encodeURIComponent(langMode)}&aiReview=1`);
  } catch (e) {
    rotator.stop();
    // Fallback to V1
    try {
      loadingModal.update(t('editor.aiAppend.generating', 'Generating...'));
      const created = await api('/api/ai/wizard', {
        method: 'POST',
        body: JSON.stringify({
          raw,
          lang: langMode,
          theme: themeId,
          settings: {
            stepParagraphs: true,
            transitions: { preset: 'fade' },
          },
        }),
      });
      loadingModal.update(t('common.done', 'Done!'));
      loadingModal.setProgress(100);
      await new Promise((r) => setTimeout(r, 800));
      loadingModal.close();
      close();
      nav?.(`/app/${created.id}?lang=${encodeURIComponent(langMode)}&aiReview=1`);
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
  h,
  root,
  selectedFile,
  langMode,
  themeId,
  close,
  nav,
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
  setStatus(t('list.fileConverter.reading', 'Reading file...'));

  const lang = langMode === 'en-GB' ? 'en-GB' : 'nl';

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
    h,
    root,
    initialMessage: t('list.fileConverter.converting', 'Converting file...'),
    title: t('list.fileConverter.convertingTitle', 'Converting file'),
  });
  loadingModal.setProgress(5);

  const rotator = createMessageRotator({
    onUpdate: (message, progress) => {
      loadingModal.update(message);
      loadingModal.setProgress(progress);
    },
  });

  try {
    let useStreaming = true;

    try {
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
          onStatus: (data) => {
            const phase = data?.phase || '';
            if (phase === 'finalize' || phase === 'save' || !rotator.getState().messages.length) {
              rotator.stop();
              loadingModal.update(data?.message || '');
              if (data?.progress) loadingModal.setProgress(data.progress);
            }
          },
          onMessages: (data) => {
            rotator.setMessages(data?.statusMessages || []);
            rotator.start();
          },
          onComplete: async (data) => {
            streamComplete = true;
            rotator.stop();
            const result = data;
            loadingModal.update(t('common.done', 'Done!'));
            loadingModal.setProgress(100);
            await new Promise((r) => setTimeout(r, 800));
            loadingModal.close();
            close();
            nav?.(`/app/${result.presentation.id}?lang=${encodeURIComponent(lang)}`);
          },
          onError: (data) => {
            streamError = true;
            rotator.stop();
            loadingModal.close();
            showBackdrop?.();
            setStatus(data?.error || t('list.fileConverter.failed', 'Conversion failed.'));
            setBusy(false);
          },
        });

        if (streamComplete || streamError) return;
      }
    } catch {
      useStreaming = false;
    }

    if (!useStreaming) {
      loadingModal.update(t('list.fileConverter.converting', 'Converting file...'));
      const result = await api('/api/convert', {
        method: 'POST',
        body: JSON.stringify({
          dataUrl,
          filename: selectedFile.name,
          lang,
          theme: themeId,
        }),
      });

      if (result.success && result.presentation) {
        loadingModal.update(t('common.done', 'Done!'));
        loadingModal.setProgress(100);
        await new Promise((r) => setTimeout(r, 800));
        loadingModal.close();
        close();
        nav?.(`/app/${result.presentation.id}?lang=${encodeURIComponent(lang)}`);
      } else {
        loadingModal.close();
        showBackdrop?.();
        setStatus(result.error || t('list.fileConverter.failed', 'Conversion failed.'));
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
 * Handle JSON import
 */
export async function handleImportJson({
  api,
  selectedFile,
  langMode,
  close,
  nav,
  setBusy,
  setStatus,
}) {
  if (!selectedFile) {
    setStatus(t('list.fileConverter.selectFirst', 'Select a file first.'));
    return;
  }
  setBusy(true);
  setStatus(t('list.newPresentation.importing', 'Importing...'));

  try {
    const text = await selectedFile.text();

    let deck;
    try {
      deck = JSON.parse(text);
    } catch (parseErr) {
      console.error('[handleImportJson] JSON parse error:', parseErr.message);
      setStatus(`JSON parse error: ${parseErr.message}`);
      setBusy(false);
      return;
    }

    // Use the language from the deck if available, otherwise fall back to langMode
    const lang = deck?.lang === 'en-GB' || deck?.lang === 'nl'
      ? deck.lang
      : (langMode === 'en-GB' ? 'en-GB' : 'nl');

    const created = await api('/api/presentations/import/json', {
      method: 'POST',
      body: JSON.stringify({ deck, lang }),
    });

    // Use the language from the response (which reflects the actual presentation language)
    const navLang = created?.lang || lang;
    close();
    nav?.(`/app/${created.id}?lang=${encodeURIComponent(navLang)}`);
  } catch (e) {
    console.error('[handleImportJson] Error:', e);
    setStatus(String(e?.message || e));
    setBusy(false);
  }
}

/**
 * Handle Markdown import
 */
export async function handleImportMarkdown({
  api,
  h,
  selectedFile,
  langMode,
  themeId,
  close,
  nav,
  setBusy,
  setStatus,
  showWarnings,
}) {
  if (!selectedFile) {
    setStatus(t('list.fileConverter.selectFirst', 'Select a file first.'));
    return;
  }
  setBusy(true);
  setStatus(t('list.newPresentation.importing', 'Importing...'));

  try {
    const markdown = await selectedFile.text();

    if (!markdown.trim()) {
      setStatus(t('list.newPresentation.importMarkdown.empty', 'The file is empty.'));
      setBusy(false);
      return;
    }

    const lang = langMode === 'en-GB' ? 'en-GB' : 'nl';

    const created = await api('/api/presentations/import/markdown', {
      method: 'POST',
      body: JSON.stringify({ markdown, lang, theme: themeId }),
    });

    const navLang = created?.lang || lang;
    const navUrl = `/app/${created.id}?lang=${encodeURIComponent(navLang)}`;
    const warnings = created?._importReport?.warnings || [];

    if (warnings.length > 0 && showWarnings) {
      showWarnings({ warnings, navUrl });
      return;
    }

    close();
    nav?.(navUrl);
  } catch (e) {
    setStatus(String(e?.message || e));
    setBusy(false);
  }
}

/**
 * Handle Paste Markdown (direct text, no AI)
 */
export async function handlePasteMarkdown({
  api,
  h,
  raw,
  langMode,
  themeId,
  close,
  nav,
  setBusy,
  setStatus,
  focusTextarea,
  showWarnings,
}) {
  if (!raw) {
    setStatus(t('list.newPresentation.pasteMarkdown.pasteFirst', 'Paste markdown content first.'));
    focusTextarea?.();
    return;
  }
  setBusy(true);
  setStatus(t('list.newPresentation.importing', 'Importing...'));

  try {
    const lang = langMode === 'en-GB' ? 'en-GB' : 'nl';

    const created = await api('/api/presentations/import/markdown', {
      method: 'POST',
      body: JSON.stringify({ markdown: raw, lang, theme: themeId }),
    });

    const navLang = created?.lang || lang;
    const navUrl = `/app/${created.id}?lang=${encodeURIComponent(navLang)}`;
    const warnings = created?._importReport?.warnings || [];

    if (warnings.length > 0 && showWarnings) {
      showWarnings({ warnings, navUrl });
      return;
    }

    close();
    nav?.(navUrl);
  } catch (e) {
    setStatus(String(e?.message || e));
    setBusy(false);
  }
}

/**
 * Handle Notion import
 */
export async function handleNotion({
  api,
  h,
  root,
  notionUrl,
  themeId,
  close,
  nav,
  setBusy,
  setStatus,
  hideBackdrop,
  showBackdrop,
  focusInput,
}) {
  if (!notionUrl) {
    setStatus(t('list.newPresentation.notion.urlRequired', 'Please enter a Notion page URL.'));
    focusInput?.();
    return;
  }
  setBusy(true);
  hideBackdrop?.();

  const loadingModal = showLoadingModal({
    h,
    root,
    initialMessage: t('list.newPresentation.notion.importing', 'Importing Notion page...'),
    title: t('list.newPresentation.notion.importingTitle', 'Importing from Notion'),
  });
  loadingModal.setProgress(5);

  const rotator = createMessageRotator({
    onUpdate: (message, progress) => {
      loadingModal.update(message);
      loadingModal.setProgress(progress);
    },
  });

  try {
    let useStreaming = true;

    try {
      const response = await fetch('/api/notion/import/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: notionUrl,
          lang: 'auto',
          theme: themeId,
        }),
      });

      if (!response.ok || !response.body) {
        useStreaming = false;
      } else {
        let streamComplete = false;
        let streamError = false;

        await processSSEStream(response.body, {
          onStatus: (data) => {
            const phase = data?.phase || '';
            if (phase === 'finalize' || phase === 'save' || !rotator.getState().messages.length) {
              rotator.stop();
              loadingModal.update(data?.message || '');
              if (data?.progress) loadingModal.setProgress(data.progress);
            }
          },
          onMessages: (data) => {
            rotator.setMessages(data?.statusMessages || []);
            rotator.start();
          },
          onComplete: async (data) => {
            streamComplete = true;
            rotator.stop();
            const result = data;
            const detectedLang = result.detectedLang || result.presentation?.lang || 'nl';
            loadingModal.update(t('common.done', 'Done!'));
            loadingModal.setProgress(100);
            await new Promise((r) => setTimeout(r, 800));
            loadingModal.close();
            close();
            nav?.(`/app/${result.presentation.id}?lang=${encodeURIComponent(detectedLang)}`);
          },
          onError: (data) => {
            streamError = true;
            rotator.stop();
            loadingModal.close();
            showBackdrop?.();
            setStatus(data?.error || t('list.newPresentation.notion.failed', 'Import failed.'));
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
      loadingModal.update(t('list.newPresentation.notion.importing', 'Importing Notion page...'));
      const result = await api('/api/notion/import', {
        method: 'POST',
        body: JSON.stringify({
          url: notionUrl,
          lang: 'auto',
          theme: themeId,
        }),
      });

      if (result.success && result.presentation) {
        const detectedLang = result.detectedLang || result.presentation?.lang || 'nl';
        loadingModal.update(t('common.done', 'Done!'));
        loadingModal.setProgress(100);
        await new Promise((r) => setTimeout(r, 800));
        loadingModal.close();
        close();
        nav?.(`/app/${result.presentation.id}?lang=${encodeURIComponent(detectedLang)}`);
      } else {
        loadingModal.close();
        showBackdrop?.();
        setStatus(result.error || t('list.newPresentation.notion.failed', 'Import failed.'));
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