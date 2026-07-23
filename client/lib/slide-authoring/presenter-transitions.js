import { t } from '../ui-i18n.js';

export const PRESENTER_TRANSITION_PRESETS = [
  { value: 'none', label: t('common.none', 'None') },
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'push', label: 'Push' },
  { value: 'morph', label: 'Morph' },
  { value: 'cube', label: '3D (Cube)' },
];

export function normalizePresenterTransitionPreset(v) {
  const raw = String(v || '').trim();
  for (const opt of PRESENTER_TRANSITION_PRESETS) {
    if (opt.value === raw) return raw;
  }
  return 'none';
}
