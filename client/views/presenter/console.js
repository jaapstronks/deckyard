import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { attachThumbScale } from '../../lib/thumb-scale.js';
import {
  cleanupSlideRuntimes,
  mountSlideInto,
} from '../../lib/slide-render.js';
import { markdownToSafeHtml } from '../../../shared/markdown.js';
import {
  createPresenterConsoleTimer,
  formatClock,
  parseTargetToSeconds,
} from './console-timer.js';

const TARGET_STORAGE_KEY = 'deckyard:presenterConsoleTargetSeconds';

/**
 * Presenter console panel: the presenter-only aid that lives beside the stage.
 * Shows the elapsed timer (with optional target), a next-slide thumbnail, and
 * the current slide's speaker notes.
 *
 * The panel owns its stopwatch; call {@link startTimer} when the presentation
 * begins. Slide-dependent content is refreshed via {@link update}.
 *
 * @param {Object} opts
 * @param {Object} [opts.theme] Resolved theme for thumbnail rendering.
 * @param {string} [opts.presentationId] Presentation id (for slide runtimes).
 * @returns {{
 *   el: HTMLElement,
 *   update: (state: { current: any, next: any, idx: number, total: number }) => void,
 *   startTimer: () => void,
 *   destroy: () => void,
 * }}
 */
export function createPresenterConsole({ theme, presentationId } = {}) {
  // --- Timer block -------------------------------------------------------
  const clockEl = h('div', {
    class: 'presenter-console-clock',
    text: '0:00',
    'aria-label': t('presenter.console.elapsed', 'Elapsed time'),
  });
  const overtimeTag = h('span', {
    class: 'presenter-console-overtime',
    text: t('presenter.console.overtime', 'over'),
    hidden: true,
  });
  const targetHintEl = h('div', {
    class: 'presenter-console-target-hint help',
    text: '',
    hidden: true,
  });

  const startPauseBtn = h('button', {
    class: 'btn btn-secondary presenter-console-timer-toggle',
    text: t('presenter.console.start', 'Start'),
    type: 'button',
  });
  const resetBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('presenter.console.reset', 'Reset'),
    type: 'button',
  });

  const targetInput = h('input', {
    class: 'form-input presenter-console-target-input',
    type: 'text',
    inputmode: 'numeric',
    placeholder: t('presenter.console.targetPlaceholder', 'e.g. 20'),
    'aria-label': t('presenter.console.targetLabel', 'Target (minutes)'),
    title: t(
      'presenter.console.targetTitle',
      'Target time in minutes (e.g. 20 or 20:00). Elapsed turns red when exceeded.'
    ),
  });

  const timer = createPresenterConsoleTimer({
    onTick: (state) => {
      clockEl.textContent = formatClock(state.elapsedSeconds);
      clockEl.classList.toggle('is-overtime', state.overtime);
      overtimeTag.hidden = !state.overtime;
      startPauseBtn.textContent = state.running
        ? t('presenter.console.pause', 'Pause')
        : state.started
          ? t('presenter.console.resume', 'Resume')
          : t('presenter.console.start', 'Start');
      startPauseBtn.classList.toggle('is-active', state.running);
      if (state.targetSeconds) {
        targetHintEl.textContent = t(
          'presenter.console.targetSet',
          'Target {time}',
          { time: formatClock(state.targetSeconds) }
        );
        targetHintEl.hidden = false;
      } else {
        targetHintEl.hidden = true;
      }
    },
  });

  startPauseBtn.onclick = () => timer.toggle();
  resetBtn.onclick = () => timer.reset();

  const applyTarget = () => {
    const seconds = parseTargetToSeconds(targetInput.value);
    timer.setTargetSeconds(seconds);
    try {
      if (seconds) localStorage.setItem(TARGET_STORAGE_KEY, String(seconds));
      else localStorage.removeItem(TARGET_STORAGE_KEY);
    } catch {
      // ignore storage failures (private mode etc.)
    }
  };
  targetInput.addEventListener('change', applyTarget);
  targetInput.addEventListener('blur', applyTarget);

  // Restore a previously set target.
  try {
    const savedSeconds = Number(localStorage.getItem(TARGET_STORAGE_KEY));
    if (Number.isFinite(savedSeconds) && savedSeconds > 0) {
      timer.setTargetSeconds(savedSeconds);
      targetInput.value = formatClock(savedSeconds);
    }
  } catch {
    // ignore
  }

  const timerBlock = h('section', { class: 'presenter-console-timer' }, [
    h('div', { class: 'presenter-console-clock-row' }, [clockEl, overtimeTag]),
    h('div', { class: 'presenter-console-timer-actions row' }, [
      startPauseBtn,
      resetBtn,
    ]),
    h('div', { class: 'presenter-console-target-row row' }, [
      h('label', {
        class: 'presenter-console-target-label help',
        text: t('presenter.console.targetLabel', 'Target (minutes)'),
      }),
      targetInput,
    ]),
    targetHintEl,
  ]);

  // --- Next-slide block --------------------------------------------------
  const nextThumb = h('div', { class: 'presenter-console-thumb thumb' });
  const detachThumb = attachThumbScale(nextThumb, { virtualWidth: 1600 });
  const nextMeta = h('div', {
    class: 'presenter-console-next-meta help',
    text: '',
  });
  const nextBlock = h('section', { class: 'presenter-console-next' }, [
    h('div', {
      class: 'presenter-console-label',
      text: t('presenter.console.nextLabel', 'Next'),
    }),
    nextThumb,
    nextMeta,
  ]);

  // --- Notes block -------------------------------------------------------
  const notesBody = h('div', { class: 'presenter-console-notes-body' });
  const notesBlock = h('section', { class: 'presenter-console-notes' }, [
    h('div', {
      class: 'presenter-console-label',
      text: t('presenter.console.notesLabel', 'Notes'),
    }),
    notesBody,
  ]);

  const el = h(
    'aside',
    {
      class: 'presenter-console',
      'aria-label': t('presenter.console.title', 'Presenter console'),
    },
    [timerBlock, nextBlock, notesBlock]
  );

  const update = ({ current, next, idx = 0, total = 0 } = {}) => {
    // Next-slide thumbnail
    if (next) {
      mountSlideInto(nextThumb, next, {
        mode: 'thumb',
        theme,
        presentationId,
      });
      nextThumb.classList.remove('is-empty');
      nextMeta.textContent = t('notes.slideOf', 'Slide {current} / {total}', {
        current: idx + 2,
        total,
      });
    } else {
      cleanupSlideRuntimes(nextThumb);
      nextThumb.innerHTML = '';
      nextThumb.classList.add('is-empty');
      nextThumb.append(
        h('div', {
          class: 'help thumb-overlay is-muted',
          text: t('presenter.console.endOfDeck', 'End of deck'),
        })
      );
      nextMeta.textContent = '';
    }

    // Speaker notes for the current slide
    const notes = typeof current?.notes === 'string' ? current.notes : '';
    notesBody.innerHTML = notes.trim()
      ? markdownToSafeHtml(notes)
      : `<p class="help">${t('notes.noNotes', 'No notes for this slide.')}</p>`;
  };

  const destroy = () => {
    timer.destroy();
    try {
      detachThumb?.();
    } catch {
      // ignore
    }
    cleanupSlideRuntimes(nextThumb);
  };

  return { el, update, startTimer: () => timer.start(), destroy };
}
