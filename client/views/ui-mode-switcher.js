import {
  getUiModePreference,
  setUiModePreference,
  subscribeUiMode,
} from '../lib/ui-mode.js';
import { iconUrl } from '../../shared/icon-names.js';
import { t } from '../lib/ui-i18n.js';

function prefLabel(p) {
  if (p === 'light') return t('appearance.light', 'Light');
  if (p === 'dark') return t('appearance.dark', 'Dark');
  return t('appearance.system', 'System');
}

export function createUiModeSwitcher({ h, className = '' } = {}) {
  const wrap = h('div', {
    class: `sb-segmented is-toggle is-compact ui-mode-switcher ${className}`.trim(),
    title: t('appearance.label', 'Appearance'),
    role: 'radiogroup',
    'aria-label': t('appearance.label', 'Appearance'),
  });

  const mkBtn = (value, iconName, ariaLabel) => {
    const btn = h('button', {
      class: 'sb-segmented-btn',
      type: 'button',
      role: 'radio',
      'aria-checked': 'false',
      'aria-label': ariaLabel,
      title: ariaLabel,
      onclick: () => setUiModePreference(value),
    });

    const icon = h('span', {
      class: `ui-mode-icon is-${value}`,
      'aria-hidden': 'true',
      style: `--ui-mode-icon-url: url("${iconUrl(iconName)}");`,
    });
    btn.append(icon);
    return btn;
  };

  const btnSystem = mkBtn('system', 'desktop', t('appearance.system', 'System'));
  const btnLight = mkBtn('light', 'sun', t('appearance.light', 'Light'));
  const btnDark = mkBtn('dark', 'moon', t('appearance.dark', 'Dark'));
  wrap.append(btnSystem, btnLight, btnDark);

  const sync = ({ preference } = {}) => {
    const p = preference || getUiModePreference();
    const s = p === 'system';
    const l = p === 'light';
    const d = p === 'dark';
    btnSystem.classList.toggle('is-active', s);
    btnLight.classList.toggle('is-active', l);
    btnDark.classList.toggle('is-active', d);
    btnSystem.setAttribute('aria-checked', s ? 'true' : 'false');
    btnLight.setAttribute('aria-checked', l ? 'true' : 'false');
    btnDark.setAttribute('aria-checked', d ? 'true' : 'false');
    wrap.title = t('appearance.title', 'Appearance: {mode}', { mode: prefLabel(p) });
  };

  const detach = subscribeUiMode(sync);
  sync({ preference: getUiModePreference() });

  return { el: wrap, detach };
}
