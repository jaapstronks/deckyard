import { t } from '../../lib/ui-i18n.js';

/**
 * Read-only state for the editor shell.
 *
 * The one source that locks the whole editor is the server being in
 * maintenance (every save is refused with a 503 while it lasts). Slide-level
 * locks never make the editor read-only — they gate individual slides and live
 * in slide-lock-manager.js.
 *
 * The controller owns the flag plus the derived state and mirrors it onto the
 * shell (`is-read-only` class + the `--read-only-banner-text` caption), so the
 * rest of the editor only ever asks `isReadOnly()`.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.shell - the editor shell element to reflect state on.
 * @returns {{
 *   isReadOnly: () => boolean,
 *   setMaintenanceReadOnly: (v: boolean) => void,
 * }}
 */
export function createReadOnlyController({ shell } = {}) {
  let readOnlyMode = false;

  /** Reflect the read-only state in the shell. */
  const apply = () => {
    shell.classList.toggle('is-read-only', readOnlyMode);
    if (!readOnlyMode) return;
    const bannerText = t(
      'maintenance.readOnly.banner',
      'Paused for maintenance - your work is kept',
    );
    shell.style.setProperty('--read-only-banner-text', `"${bannerText}"`);
  };

  return {
    isReadOnly: () => readOnlyMode,
    setMaintenanceReadOnly: (v) => {
      readOnlyMode = !!v;
      apply();
    },
  };
}
