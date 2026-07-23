import { t } from '../../../../lib/ui-i18n.js';

const ALLOWED_TRANSITION_PRESETS = new Set([
  'none',
  'fade',
  'slide',
  'push',
  'morph',
  'cube',
]);

/**
 * Presenter slide→slide transition preset.
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ el: HTMLElement }}
 */
export function buildTransitionsSection({ h, pres, markDirty, requestSave }) {
  pres.settings.transitions =
    pres.settings.transitions && typeof pres.settings.transitions === 'object'
      ? pres.settings.transitions
      : {};
  const presetRaw = String(pres.settings.transitions.preset || '').trim();
  const preset = ALLOWED_TRANSITION_PRESETS.has(presetRaw) ? presetRaw : 'none';
  pres.settings.transitions.preset = preset;

  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t(
      'editor.deckSettings.transitions.title',
      'Presenter transition (slide → slide)'
    ),
  });
  const help = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.transitions.help',
      'Presenter only. Editor and follow-along remain static by default.'
    ),
  });
  const sel = h('select', { class: 'form-input' });
  sel.append(
    h('option', { value: 'none', text: t('common.none', 'None') }),
    h('option', { value: 'fade', text: t('editor.transitions.fade', 'Fade') }),
    h('option', {
      value: 'slide',
      text: t('editor.transitions.slide', 'Slide'),
    }),
    h('option', { value: 'push', text: t('editor.transitions.push', 'Push') }),
    h('option', {
      value: 'morph',
      text: t('editor.transitions.morph', 'Morph'),
    }),
    h('option', {
      value: 'cube',
      text: t('editor.transitions.cube', '3D (Cube)'),
    })
  );
  sel.value = preset;
  sel.addEventListener('change', () => {
    const v = String(sel.value || '').trim();
    pres.settings.transitions.preset = ALLOWED_TRANSITION_PRESETS.has(v)
      ? v
      : 'none';
    markDirty?.();
    requestSave?.();
  });
  wrap.append(label, sel, help);
  return { el: wrap };
}
