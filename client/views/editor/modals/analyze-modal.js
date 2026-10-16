/**
 * AI Analysis Modal
 *
 * Triggers AI analysis of the presentation and shows the result.
 * Suggestions are created as comments that appear in the comments panel.
 *
 * The analysis itself is a long task: while it runs, the loading modal stands
 * in front of this dialog with the progress and a Cancel that aborts the
 * request, which stops the model call and the comment writes on the server
 * (B716). This dialog keeps what is left when it is done: the summary and the
 * suggestions that were added.
 */

import { createPromiseModal } from '../../../lib/dom/modal.js';
import { showLoadingModal } from '../../../lib/dom/loading-modal.js';
import { processSSEStream } from '../../../lib/net/sse.js';
import { t } from '../../../lib/ui-i18n.js';
import { stripMentionMarkup } from '../../../../shared/comment-mentions.js';
import { h } from '../../../lib/dom/index.js';

export function openAnalyzeModal({ root, id, onComplete } = {}) {
  const modal = createPromiseModal({
    title: t('editor.analyzeModal.title', 'AI Analysis'),
    hint: t(
      'editor.analyzeModal.hint',
      'AI will analyze your presentation and create improvement suggestions as comments.',
    ),
    closeOnBackdrop: false,
    onClose: (result) => result,
  });

  // State
  let isRunning = false;

  // The result: the summary line and the suggestions that were added.
  const resultsContainer = h('div', { class: 'analyze-results' });
  const statusText = h('div', { class: 'analyze-status', text: '' });
  const suggestionsList = h('div', { class: 'analyze-suggestions-list' });
  resultsContainer.append(statusText, suggestionsList);

  // Initial state - show options
  const optionsContainer = h('div', { class: 'analyze-options' });

  const infoText = h('p', {
    class: 'analyze-info',
    text: t(
      'editor.analyzeModal.info',
      'AI will review your slides and suggest improvements for clarity, structure, and visual balance. Suggestions appear as comments you can accept, dismiss, or act on.',
    ),
  });

  // Buttons
  const btnRow = h('div', { class: 'row is-end is-mt-8' });

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.close({ ok: false }),
  });

  const btnAnalyze = h('button', {
    class: 'btn btn-primary',
    text: t('editor.analyzeModal.analyze', 'Analyze'),
    onclick: () => startAnalysis(),
  });

  const btnClose = h('button', {
    class: 'btn btn-primary',
    text: t('common.close', 'Close'),
    style: 'display: none;',
    onclick: () => modal.close({ ok: true }),
  });

  btnRow.append(btnCancel, btnAnalyze, btnClose);

  optionsContainer.append(infoText);
  modal.content.append(optionsContainer, resultsContainer, btnRow);

  // Nothing to show until the analysis ran
  resultsContainer.style.display = 'none';

  /** Swap the dialog to its result: the summary, the list, Close. */
  function showResult(message) {
    statusText.textContent = message;
    optionsContainer.style.display = 'none';
    resultsContainer.style.display = '';
    btnAnalyze.style.display = 'none';
    btnCancel.style.display = 'none';
    btnClose.style.display = '';
  }

  /**
   * Start the analysis via SSE
   */
  async function startAnalysis() {
    if (isRunning) return;
    isRunning = true;
    suggestionsList.replaceChildren();

    const controller = new AbortController();
    const progress = showLoadingModal({
      root: document.body,
      title: t('editor.analyzeModal.title', 'AI Analysis'),
      initialMessage: t('editor.analyzeModal.starting', 'Starting analysis…'),
      // Abort the analysis so the server request and the client reader stop
      // instead of running on after the dialog closes.
      onCancel: () => {
        controller.abort();
        modal.close({ ok: false });
      },
    });

    try {
      // SSE stream (POST, so EventSource is out): reads response.body.
      // eslint-disable-next-line no-restricted-syntax
      const response = await fetch(`/api/presentations/${id}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        credentials: 'same-origin',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.status}`);
      }

      await processSSEStream(response.body, eventHandlers(progress));
    } catch (error) {
      // Cancel aborts the fetch: the dialog is already closing, so stay silent.
      if (error?.name === 'AbortError') return;
      console.error('[analyze] Error:', error);
      showResult(
        t('editor.analyzeModal.error', 'Analysis failed: {message}', {
          message: error?.message || t('common.unknownError', 'Unknown error'),
        }),
      );
    } finally {
      progress.close();
      isRunning = false;
    }
  }

  /**
   * The stream's events, read into the loading modal while it runs and into
   * this dialog when it is done.
   *
   * @param {ReturnType<typeof showLoadingModal>} progress
   */
  function eventHandlers(progress) {
    return {
      connected: () => {
        progress.update(
          t('editor.analyzeModal.connected', 'Connected, analyzing…'),
        );
      },

      progress: (data) => {
        if (data.phase === 'analyzing') {
          progress.update(
            t(
              'editor.analyzeModal.analyzing',
              { one: 'Analyzing 1 slide…', many: 'Analyzing {count} slides…' },
              { count: data.slideCount || 0 },
            ),
          );
          // One model call: it creeps toward the parse step, it cannot count.
          progress.setProgress(10);
          progress.creepTo(55);
        } else if (data.phase === 'parsing') {
          progress.update(
            t('editor.analyzeModal.parsing', 'Processing suggestions…'),
          );
          progress.setProgress(60);
        } else if (data.phase === 'creating') {
          progress.update(
            t('editor.analyzeModal.creating', 'Creating suggestions…'),
          );
          progress.setProgress(70);
        }
      },

      suggestion: (data) => {
        progress.setProgress(70 + (30 * data.index) / data.total);
        progress.update(
          t(
            'editor.analyzeModal.creatingN',
            'Creating suggestion {n} of {total}…',
            {
              n: String(data.index),
              total: String(data.total),
            },
          ),
          { immediate: true },
        );

        // Add suggestion to list
        const suggestionEl = h('div', { class: 'analyze-suggestion-item' });
        const categoryBadge = h('span', {
          class: `analyze-category-badge analyze-category-${data.comment?.suggestionCategory || 'other'}`,
          text: data.comment?.suggestionCategory || 'suggestion',
        });
        const bodyText = h('span', {
          class: 'analyze-suggestion-body',
          text: truncate(stripMentionMarkup(data.comment?.body || ''), 80),
        });
        suggestionEl.append(categoryBadge, bodyText);
        suggestionsList.append(suggestionEl);
      },

      complete: (data) => {
        progress.setProgress(100);
        showResult(
          data.suggestionCount === 0
            ? t(
                'editor.analyzeModal.noSuggestions',
                'No suggestions found. Your presentation looks great!',
              )
            : t(
                'editor.analyzeModal.complete',
                {
                  one: 'Analysis complete! 1 suggestion added as a comment.',
                  many: 'Analysis complete! {count} suggestions added as comments.',
                },
                { count: data.suggestionCount },
              ),
        );

        // Notify parent to refresh comments
        onComplete?.({ suggestionCount: data.suggestionCount });
      },

      error: (data) => {
        showResult(
          t('editor.analyzeModal.error', 'Analysis failed: {message}', {
            message: data.message || t('common.unknownError', 'Unknown error'),
          }),
        );
      },
    };
  }

  modal.show(root);

  return modal.promise;
}

/**
 * Truncate text with ellipsis
 */
function truncate(text, maxLength) {
  const s = String(text || '').trim();
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength - 1) + '...';
}
