import {
  bgClassExtended,
  BACKGROUND_FIELD_EXTENDED,
  clampInt,
  esc,
} from '../helpers.js';

/**
 * Countdown timer slide.
 *
 * Renders a large, presenter-controlled countdown timer. The markup is fully
 * static and server-safe (no inline JS); all behaviour lives in the client
 * runtime `client/lib/countdown-runtime.js`, driven by the data attributes
 * emitted here.
 *
 * Modes (see client/lib/slide-render.js):
 *  - present / follow: interactive — presenter starts/pauses/resets.
 *  - thumb: static — shows the configured start time, never runs.
 */

const DEFAULT_MINUTES = 5;

function totalSeconds(content) {
  const mins = clampInt(content?.durationMinutes, 0, 60, DEFAULT_MINUTES);
  const secs = clampInt(content?.durationSeconds, 0, 59, 0);
  const total = mins * 60 + secs;
  // Never allow a zero-length timer; fall back to the default.
  return total > 0 ? total : DEFAULT_MINUTES * 60;
}

function formatMmSs(total) {
  const t = Math.max(0, Math.floor(total));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function isOn(v, fallback) {
  if (v == null || v === '') return fallback;
  return v === 'on' || v === true || v === '1' || v === 1;
}

export default {
  label: 'Countdown timer',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'durationMinutes',
      label: 'Minutes',
      type: 'number',
      required: false,
      min: 0,
      max: 60,
      step: 1,
      helpText: 'Countdown length in minutes (0–60). Default 5.',
    },
    {
      key: 'durationSeconds',
      label: 'Seconds',
      type: 'number',
      required: false,
      min: 0,
      max: 59,
      step: 1,
      helpText: 'Extra seconds on top of the minutes (0–59).',
    },
    {
      key: 'autoStart',
      label: 'Auto-start',
      type: 'enum',
      required: false,
      options: [
        { value: 'off', label: 'Off (presenter starts)' },
        { value: 'on', label: 'On (start when slide opens)' },
      ],
    },
    {
      key: 'flashOnZero',
      label: 'Flash red at zero',
      type: 'enum',
      required: false,
      options: [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
    },
    {
      key: 'soundOnZero',
      label: 'Beep at zero',
      type: 'enum',
      required: false,
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
      helpText:
        'Plays a short beep when the timer reaches zero. Browsers only allow sound after the presenter has interacted with the slide.',
    },
    {
      key: 'zeroText',
      label: 'Text at zero',
      type: 'string',
      required: false,
      maxLength: 60,
      helpText: 'Shown big when the timer hits zero, e.g. "Tijd!". Leave empty for none.',
    },
    BACKGROUND_FIELD_EXTENDED,
  ],
  defaults: {
    title: '',
    durationMinutes: DEFAULT_MINUTES,
    durationSeconds: 0,
    autoStart: 'off',
    flashOnZero: 'on',
    soundOnZero: 'off',
    zeroText: 'Tijd!',
    background: 'dark',
  },
  // Signature must be (content, slide, ctx) – see `shared/slide-types/presentation.js`.
  renderHtml: (content, slide, _ctx = {}) => {
    const bg = bgClassExtended(content?.background || 'dark');
    const seconds = totalSeconds(content);
    const autoStart = isOn(content?.autoStart, false);
    const flash = isOn(content?.flashOnZero, true);
    const sound = isOn(content?.soundOnZero, false);

    const titleText =
      typeof content?.title === 'string' ? content.title.trim() : '';
    const title = titleText
      ? `<h2 class="cd-title heading" data-inline-field="title" dir="auto">${esc(titleText)}</h2>`
      : '';

    const zeroText =
      typeof content?.zeroText === 'string' ? content.zeroText.trim() : '';
    const zeroEl = zeroText
      ? `<div class="cd-zero-text" aria-hidden="true">${esc(zeroText)}</div>`
      : '';

    return `
      <div class="slide slide-countdown ${bg}"
        data-countdown-seconds="${seconds}"
        data-countdown-autostart="${autoStart ? '1' : '0'}"
        data-countdown-sound="${sound ? '1' : '0'}"
        data-countdown-flash="${flash ? '1' : '0'}">
        <div class="slide-inner">
          ${title}
          <div class="cd-stage">
            <time class="cd-time" data-countdown-display="1" role="timer" aria-live="off">${formatMmSs(
              seconds
            )}</time>
            ${zeroEl}
          </div>
          <div class="cd-controls" data-countdown-controls="1" hidden>
            <button type="button" class="btn btn-primary cd-btn" data-countdown-action="start">Start</button>
            <button type="button" class="btn btn-secondary cd-btn" data-countdown-action="pause" hidden>Pause</button>
            <button type="button" class="btn btn-secondary cd-btn" data-countdown-action="reset">Reset</button>
          </div>
        </div>
      </div>
    `.trim();
  },
};
