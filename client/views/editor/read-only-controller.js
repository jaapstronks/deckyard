import { t } from '../../lib/ui-i18n.js';

/**
 * Read-only state for the editor shell.
 *
 * Two independent sources can lock the editor and they must not clobber each
 * other: another user holding the presentation lock, and the server being in
 * maintenance. The effective read-only state is the OR of the two — without this
 * split, a lock released during a deploy would hand editing back while every save
 * is still being refused with a 503.
 *
 * The controller owns those two flags plus the derived state and mirrors it onto
 * the shell (`is-read-only` class + the `--read-only-banner-text` caption). The
 * banner caption is derived here rather than set at each source, because both can
 * be up at once: maintenance wins while it lasts, but the lock text has to come
 * back when it ends — otherwise a deploy that overlaps someone else's lock leaves
 * the editor read-only under a "paused for maintenance" caption that is no longer
 * true.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.shell - the editor shell element to reflect state on.
 * @returns {{
 *   isReadOnly: () => boolean,
 *   setLockReadOnly: (v: boolean) => void,
 *   setMaintenanceReadOnly: (v: boolean) => void,
 * }}
 */
export function createReadOnlyController({ shell } = {}) {
  let readOnlyMode = false;
  let lockReadOnly = false;
  let maintenanceReadOnly = false;

  /** Recompute read-only state from both sources and reflect it in the shell. */
  const apply = () => {
    readOnlyMode = lockReadOnly || maintenanceReadOnly;
    shell.classList.toggle('is-read-only', readOnlyMode);
    if (!readOnlyMode) return;
    const bannerText = maintenanceReadOnly
      ? t(
          'maintenance.readOnly.banner',
          'Paused for maintenance - your work is kept',
        )
      : t('editor.readOnly.banner', 'View only - someone else is editing');
    shell.style.setProperty('--read-only-banner-text', `"${bannerText}"`);
  };

  return {
    isReadOnly: () => readOnlyMode,
    setLockReadOnly: (v) => {
      lockReadOnly = !!v;
      apply();
    },
    setMaintenanceReadOnly: (v) => {
      maintenanceReadOnly = !!v;
      apply();
    },
  };
}
