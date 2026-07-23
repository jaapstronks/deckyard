import { t } from '../../../../lib/ui-i18n.js';
import {
  calculateDeckTime,
  DEFAULT_ADVANCE_INTERVAL_SECONDS,
} from '../../../../../shared/slide-timing.js';

// Named presets: fill interval + loop + auto mode in one pick.
// "Custom" is the catch-all for any values that don't match a preset.
const AUTO_ADVANCE_PRESETS = [
  { id: 'pecha-kucha', intervalSeconds: 20, loop: true },
  { id: 'ignite', intervalSeconds: 15, loop: true },
  { id: 'kiosk', intervalSeconds: 10, loop: true },
];

/**
 * Auto-advance: enable toggle plus preset, interval, timer mode, loop, strict,
 * countdown, and a live total-deck-time readout (fields hidden while disabled).
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ el: HTMLElement }}
 */
export function buildAutoAdvanceSection({ h, pres, markDirty, requestSave }) {
  pres.settings.autoAdvance =
    pres.settings.autoAdvance && typeof pres.settings.autoAdvance === 'object'
      ? pres.settings.autoAdvance
      : {};
  pres.settings.autoAdvance.enabled = !!pres.settings.autoAdvance.enabled;
  pres.settings.autoAdvance.intervalSeconds =
    Number(pres.settings.autoAdvance.intervalSeconds) ||
    DEFAULT_ADVANCE_INTERVAL_SECONDS;
  pres.settings.autoAdvance.loop = !!pres.settings.autoAdvance.loop;
  pres.settings.autoAdvance.showCountdown =
    pres.settings.autoAdvance.showCountdown !== false;
  pres.settings.autoAdvance.mode =
    pres.settings.autoAdvance.mode === 'pacing' ? 'pacing' : 'auto';
  pres.settings.autoAdvance.strict = !!pres.settings.autoAdvance.strict;

  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.autoAdvance.title', 'Auto-advance'),
  });

  // Enable toggle
  const enableRow = h('label', {
    class: 'row is-start is-gap-xs',
    style: 'margin-top: var(--ps-space-2);',
  });
  const enableCb = h('input', { type: 'checkbox' });
  enableCb.checked = pres.settings.autoAdvance.enabled;
  enableRow.append(
    enableCb,
    h('span', {
      text: t('editor.deckSettings.autoAdvance.enable', 'Enable timed slides'),
    })
  );
  enableCb.addEventListener('change', () => {
    pres.settings.autoAdvance.enabled = !!enableCb.checked;
    fields.style.display = enableCb.checked ? '' : 'none';
    markDirty?.();
    requestSave?.();
  });

  // Fields container (hidden when disabled)
  const fields = h('div', {
    class: 'stack is-gap-xs',
    style: enableCb.checked ? '' : 'display:none;',
  });

  // Interval input
  const intervalLabel = h('div', {
    class: 'help',
    text: t('editor.deckSettings.autoAdvance.intervalHelp', 'Seconds per slide (1–300)'),
  });
  const intervalInput = h('input', {
    type: 'number',
    class: 'form-input',
    min: '1',
    max: '300',
    step: '1',
    value: String(pres.settings.autoAdvance.intervalSeconds),
  });

  // Total deck time display (updated live)
  const totalTimeEl = h('div', { class: 'help', text: '' });
  const syncTotalTime = () => {
    const interval =
      pres.settings.autoAdvance.intervalSeconds ||
      DEFAULT_ADVANCE_INTERVAL_SECONDS;
    const slides = Array.isArray(pres.slides) ? pres.slides : [];
    const { formatted } = calculateDeckTime(slides, interval);
    const hasOverrides = slides.some((s) => s.duration != null);
    const detail = hasOverrides
      ? ''
      : ` (${slides.length} slides × ${interval}s)`;
    totalTimeEl.textContent = t(
      'editor.deckSettings.autoAdvance.totalTime',
      'Total deck time: {time}{detail}',
      { time: formatted, detail }
    );
  };
  syncTotalTime();

  intervalInput.addEventListener('input', () => {
    const v = Number(intervalInput.value);
    if (Number.isFinite(v) && v >= 1 && v <= 300) {
      pres.settings.autoAdvance.intervalSeconds = Math.round(v);
      markDirty?.();
      syncTotalTime();
      syncPreset();
    }
  });
  intervalInput.addEventListener('blur', () => {
    // Clamp on blur
    let v = Number(intervalInput.value);
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > 300) v = 300;
    v = Math.round(v);
    intervalInput.value = String(v);
    pres.settings.autoAdvance.intervalSeconds = v;
    markDirty?.();
    requestSave?.();
    syncTotalTime();
    syncPreset();
  });

  // Mode selector (auto-advance vs pacing timer)
  const modeLabel = h('div', {
    class: 'help',
    text: t('editor.deckSettings.autoAdvance.modeLabel', 'Timer behavior'),
  });
  const modeSel = h('select', { class: 'form-input' });
  modeSel.append(
    h('option', {
      value: 'auto',
      text: t(
        'editor.deckSettings.autoAdvance.modeAuto',
        'Auto-advance (advance slides automatically)'
      ),
    }),
    h('option', {
      value: 'pacing',
      text: t(
        'editor.deckSettings.autoAdvance.modePacing',
        'Pacing timer (shows timer, you advance manually)'
      ),
    })
  );
  modeSel.value = pres.settings.autoAdvance.mode;

  // Loop checkbox (hidden in pacing mode)
  const loopRow = h('label', {
    class: 'row is-start is-gap-xs',
    style: pres.settings.autoAdvance.mode === 'pacing' ? 'display:none;' : '',
  });
  const loopCb = h('input', { type: 'checkbox' });
  loopCb.checked = pres.settings.autoAdvance.loop;
  loopRow.append(
    loopCb,
    h('span', {
      text: t(
        'editor.deckSettings.autoAdvance.loop',
        'Loop (restart from first slide)'
      ),
    })
  );
  loopCb.addEventListener('change', () => {
    pres.settings.autoAdvance.loop = !!loopCb.checked;
    markDirty?.();
    requestSave?.();
    syncPreset();
  });

  modeSel.addEventListener('change', () => {
    const v = modeSel.value === 'pacing' ? 'pacing' : 'auto';
    pres.settings.autoAdvance.mode = v;
    // Hide loop + strict in pacing mode (neither has effect when slides don't
    // auto-advance; strict would trap the deck with no way to move).
    loopRow.style.display = v === 'pacing' ? 'none' : '';
    strictRow.style.display = v === 'pacing' ? 'none' : '';
    markDirty?.();
    requestSave?.();
    syncPreset();
  });

  // Show countdown checkbox
  const countdownRow = h('label', { class: 'row is-start is-gap-xs' });
  const countdownCb = h('input', { type: 'checkbox' });
  countdownCb.checked = pres.settings.autoAdvance.showCountdown;
  countdownRow.append(
    countdownCb,
    h('span', {
      text: t(
        'editor.deckSettings.autoAdvance.showCountdown',
        'Show countdown bar'
      ),
    })
  );
  countdownCb.addEventListener('change', () => {
    pres.settings.autoAdvance.showCountdown = !!countdownCb.checked;
    markDirty?.();
    requestSave?.();
  });

  // Named presets
  const presetLabelText = {
    'pecha-kucha': t(
      'editor.deckSettings.autoAdvance.presetPechaKucha',
      'Pecha Kucha (20s, loop)'
    ),
    ignite: t('editor.deckSettings.autoAdvance.presetIgnite', 'Ignite (15s, loop)'),
    kiosk: t('editor.deckSettings.autoAdvance.presetKiosk', 'Kiosk (10s, loop)'),
    custom: t('editor.deckSettings.autoAdvance.presetCustom', 'Custom'),
  };
  const presetLabel = h('div', {
    class: 'help',
    text: t('editor.deckSettings.autoAdvance.presetLabel', 'Preset'),
  });
  const presetSel = h('select', { class: 'form-input' });
  for (const p of AUTO_ADVANCE_PRESETS) {
    presetSel.append(h('option', { value: p.id, text: presetLabelText[p.id] }));
  }
  presetSel.append(
    h('option', { value: 'custom', text: presetLabelText.custom })
  );

  const matchPreset = () => {
    const aa = pres.settings.autoAdvance;
    if (aa.mode !== 'auto') return 'custom';
    const hit = AUTO_ADVANCE_PRESETS.find(
      (p) => p.intervalSeconds === aa.intervalSeconds && p.loop === !!aa.loop
    );
    return hit ? hit.id : 'custom';
  };
  const syncPreset = () => {
    presetSel.value = matchPreset();
  };
  syncPreset();

  presetSel.addEventListener('change', () => {
    const preset = AUTO_ADVANCE_PRESETS.find((p) => p.id === presetSel.value);
    if (!preset) return; // "custom": leave fields as-is
    pres.settings.autoAdvance.intervalSeconds = preset.intervalSeconds;
    pres.settings.autoAdvance.loop = preset.loop;
    pres.settings.autoAdvance.mode = 'auto';
    // Reflect into the individual controls
    intervalInput.value = String(preset.intervalSeconds);
    loopCb.checked = preset.loop;
    modeSel.value = 'auto';
    loopRow.style.display = '';
    strictRow.style.display = '';
    markDirty?.();
    requestSave?.();
    syncTotalTime();
  });

  // Strict mode: timer-only, disable manual navigation (auto mode only).
  const strictRow = h('label', {
    class: 'row is-start is-gap-xs',
    style: pres.settings.autoAdvance.mode === 'pacing' ? 'display:none;' : '',
  });
  const strictCb = h('input', { type: 'checkbox' });
  strictCb.checked = pres.settings.autoAdvance.strict;
  strictRow.append(
    strictCb,
    h('span', {
      text: t(
        'editor.deckSettings.autoAdvance.strict',
        'Strict (timer only — disable manual navigation)'
      ),
    })
  );
  strictCb.addEventListener('change', () => {
    pres.settings.autoAdvance.strict = !!strictCb.checked;
    markDirty?.();
    requestSave?.();
  });

  const hint = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.autoAdvance.hint',
      'Tip: Pecha Kucha = 20s, Ignite = 15s. Press A to pause/resume while presenting.'
    ),
  });

  fields.append(
    presetLabel,
    presetSel,
    intervalLabel,
    intervalInput,
    modeLabel,
    modeSel,
    loopRow,
    strictRow,
    countdownRow,
    hint,
    totalTimeEl
  );
  wrap.append(label, enableRow, fields);
  return { el: wrap };
}
