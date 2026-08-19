/**
 * Per-slide duration control for the inspector, shown only when the deck has
 * auto-advance enabled. An empty value means "use the deck default"; a number
 * (clamped 1–300s on blur) overrides this slide only.
 *
 * Pure builder: returns the wrapper element (or null when auto-advance is off
 * or in bulk-edit mode). It writes `slide.duration` directly and calls
 * `markDirty`/`requestSave`, but holds no render-loop state, so it lives beside
 * `editor-form.js`.
 */

import { t } from '../../../lib/ui-i18n.js';
import { DEFAULT_ADVANCE_INTERVAL_SECONDS } from '../../../../shared/slide-timing.js';

/**
 * @param {object} ctx
 * @param {(tag: string, props?: object, ...kids: any[]) => HTMLElement} ctx.h
 * @param {object} ctx.pres
 * @param {object} ctx.slide
 * @param {boolean} ctx.contentOnly Bulk-edit mode renders no duration control.
 * @param {() => void} [ctx.markDirty]
 * @param {() => void} [ctx.requestSave]
 * @returns {HTMLElement|null}
 */
export function buildSlideDurationControl({
  h,
  pres,
  slide,
  contentOnly,
  markDirty,
  requestSave,
}) {
  const timingEnabled = !contentOnly && !!pres?.settings?.autoAdvance?.enabled;
  if (!timingEnabled) return null;

  const deckDefault =
    pres.settings.autoAdvance.intervalSeconds ||
    DEFAULT_ADVANCE_INTERVAL_SECONDS;
  const durationWrap = h('div', { class: 'editor-slide-duration' });
  const durationLabel = h('div', {
    class: 'help',
    text: t('editor.slide.duration.label', 'Slide duration (seconds)'),
  });
  const durationInput = h('input', {
    type: 'number',
    class: 'form-input form-input-sm',
    min: '1',
    max: '300',
    placeholder: String(deckDefault) + 's (default)',
    value: slide.duration != null ? String(slide.duration) : '',
  });
  const durationHelp = h('div', {
    class: 'help',
    text: t(
      'editor.slide.duration.help',
      'Leave empty to use the deck default ({default}s). Override for this slide only.',
      { default: String(deckDefault) },
    ),
  });
  durationInput.addEventListener('input', () => {
    const v = durationInput.value.trim();
    if (v === '') {
      delete slide.duration;
      markDirty?.();
    } else {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 1 && n <= 300) {
        slide.duration = Math.round(n);
        markDirty?.();
      }
    }
  });
  durationInput.addEventListener('blur', () => {
    const v = durationInput.value.trim();
    if (v === '') {
      delete slide.duration;
    } else {
      let n = Number(v);
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n > 300) n = 300;
      n = Math.round(n);
      durationInput.value = String(n);
      slide.duration = n;
    }
    markDirty?.();
    requestSave?.();
  });
  durationWrap.append(durationLabel, durationInput, durationHelp);
  return durationWrap;
}
