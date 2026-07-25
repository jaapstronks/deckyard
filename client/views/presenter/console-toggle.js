import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';

const CONSOLE_PREF_KEY = 'deckyard:presenterConsole';

/**
 * Presenter console toggle ("stage only" vs "console" with notes/next/timer).
 *
 * Windowed-mode aid on the presenter's own screen; the preference persists
 * across sessions. `updateConsole` is read through a getter because the
 * orchestrator reassigns it once the deck exists.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.shell - presenter shell (gets the `is-console` class).
 * @param {() => (() => void)} opts.getUpdateConsole - live console-refresh fn.
 * @returns {{
 *   el: HTMLElement,
 *   setConsoleMode: (on: boolean) => void,
 *   restorePreference: () => void,
 * }}
 */
export function createPresenterConsoleToggle({ shell, getUpdateConsole }) {
  const consoleToggleInput = h('input', {
    type: 'checkbox',
    'aria-label': t('presenter.console.toggle', 'Console'),
  });
  const consoleToggle = h(
    'label',
    {
      class: 'presenter-toggle',
      title: t(
        'presenter.console.toggleTitle',
        'Presenter console: notes, next slide and elapsed time on your own screen'
      ),
    },
    [
      consoleToggleInput,
      h('span', { text: t('presenter.console.toggle', 'Console') }),
    ]
  );
  const setConsoleMode = (on) => {
    const enabled = !!on;
    shell.classList.toggle('is-console', enabled);
    consoleToggleInput.checked = enabled;
    try {
      localStorage.setItem(CONSOLE_PREF_KEY, enabled ? '1' : '0');
    } catch {
      // ignore storage failures
    }
    if (enabled) getUpdateConsole()?.();
  };
  consoleToggleInput.addEventListener('change', () => {
    setConsoleMode(consoleToggleInput.checked);
  });

  const restorePreference = () => {
    // Restore the presenter's console preference (opt-in, off by default).
    try {
      if (localStorage.getItem(CONSOLE_PREF_KEY) === '1') setConsoleMode(true);
    } catch {
      // ignore storage failures
    }
  };

  return { el: consoleToggle, setConsoleMode, restorePreference };
}
