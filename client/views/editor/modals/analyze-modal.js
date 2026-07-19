/**
 * AI Analysis Modal
 *
 * Triggers AI analysis of the presentation and shows progress.
 * Suggestions are created as comments that appear in the comments panel.
 */

import { createPromiseModal } from '../../../lib/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { stripMentionMarkup } from '../../../../shared/comment-mentions.js';

export function openAnalyzeModal({
  h,
  root,
  api,
  toast,
  pres,
  id,
  openOverlayClosers,
  onComplete,
} = {}) {
  const modal = createPromiseModal(h, {
    title: t('editor.analyzeModal.title', 'AI Analysis'),
    hint: t(
      'editor.analyzeModal.hint',
      'AI will analyze your presentation and create improvement suggestions as comments.'
    ),
    closeOnBackdrop: false,
    onClose: (result) => result,
  });

  // State
  let controller = null;
  let isRunning = false;

  // Progress display
  const progressContainer = h('div', { class: 'analyze-progress' });
  const statusText = h('div', { class: 'analyze-status', text: '' });
  const progressBar = h('div', { class: 'analyze-progress-bar' });
  const progressFill = h('div', { class: 'analyze-progress-fill' });
  progressBar.append(progressFill);

  const suggestionsList = h('div', { class: 'analyze-suggestions-list' });

  progressContainer.append(statusText, progressBar, suggestionsList);

  // Initial state - show options
  const optionsContainer = h('div', { class: 'analyze-options' });

  const infoText = h('p', {
    class: 'analyze-info',
    text: t(
      'editor.analyzeModal.info',
      'AI will review your slides and suggest improvements for clarity, structure, and visual balance. Suggestions appear as comments you can accept, dismiss, or act on.'
    ),
  });

  // Buttons
  const btnRow = h('div', { class: 'row is-end is-mt-8' });

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: () => {
      // Abort the in-flight analysis (if any) so the server request and the
      // client reader stop instead of running on after the modal closes.
      if (controller) {
        controller.abort();
        controller = null;
      }
      modal.close({ ok: false });
    },
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
  modal.content.append(optionsContainer, progressContainer, btnRow);

  // Initially hide progress
  progressContainer.style.display = 'none';

  /**
   * Start the analysis via SSE
   */
  async function startAnalysis() {
    if (isRunning) return;
    isRunning = true;

    // Switch UI to progress mode
    optionsContainer.style.display = 'none';
    progressContainer.style.display = '';
    btnAnalyze.style.display = 'none';
    btnCancel.textContent = t('common.cancel', 'Cancel');

    statusText.textContent = t('editor.analyzeModal.starting', 'Starting analysis...');
    progressFill.style.width = '0%';
    suggestionsList.innerHTML = '';

    controller = new AbortController();

    try {
      // Use fetch with SSE parsing since EventSource doesn't support POST
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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = null;
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(currentEvent, data);
            } catch {
              // Ignore parse errors
            }
            currentEvent = null;
          }
        }
      }
    } catch (error) {
      // Cancel aborts the fetch: the modal is already closing, so stay silent.
      if (error?.name === 'AbortError') return;
      console.error('[analyze] Error:', error);
      statusText.textContent = t('editor.analyzeModal.error', 'Analysis failed: {message}', {
        message: error?.message || 'Unknown error',
      });
      btnCancel.style.display = 'none';
      btnClose.style.display = '';
    } finally {
      isRunning = false;
      controller = null;
    }
  }

  /**
   * Handle SSE events
   */
  function handleSSEEvent(event, data) {
    switch (event) {
      case 'connected':
        statusText.textContent = t('editor.analyzeModal.connected', 'Connected, analyzing...');
        break;

      case 'progress':
        if (data.phase === 'analyzing') {
          statusText.textContent = t('editor.analyzeModal.analyzing', 'Analyzing {count} slides...', {
            count: String(data.slideCount || 0),
          });
          progressFill.style.width = '30%';
        } else if (data.phase === 'parsing') {
          statusText.textContent = t('editor.analyzeModal.parsing', 'Processing suggestions...');
          progressFill.style.width = '60%';
        } else if (data.phase === 'creating') {
          statusText.textContent = t('editor.analyzeModal.creating', 'Creating suggestions...');
          progressFill.style.width = '70%';
        } else if (data.phase === 'complete') {
          progressFill.style.width = '100%';
        }
        break;

      case 'suggestion':
        progressFill.style.width = `${70 + (30 * data.index / data.total)}%`;
        statusText.textContent = t('editor.analyzeModal.creatingN', 'Creating suggestion {n} of {total}...', {
          n: String(data.index),
          total: String(data.total),
        });

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
        break;

      case 'complete':
        isRunning = false;
        progressFill.style.width = '100%';

        if (data.suggestionCount === 0) {
          statusText.textContent = t('editor.analyzeModal.noSuggestions', 'No suggestions found. Your presentation looks great!');
        } else {
          statusText.textContent = t('editor.analyzeModal.complete', 'Analysis complete! {count} suggestions added as comments.', {
            count: String(data.suggestionCount),
          });
        }

        btnCancel.style.display = 'none';
        btnClose.style.display = '';

        // Notify parent to refresh comments
        onComplete?.({ suggestionCount: data.suggestionCount });
        break;

      case 'error':
        isRunning = false;
        statusText.textContent = t('editor.analyzeModal.error', 'Analysis failed: {message}', {
          message: data.message || 'Unknown error',
        });
        btnCancel.style.display = 'none';
        btnClose.style.display = '';
        break;
    }
  }

  modal.show(root, openOverlayClosers);

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