/**
 * Maintenance banner — "we're right back, your work is saved".
 *
 * Mounted once on `document.body`, outside the SPA view root (which is cleared
 * on every route render), and kept in sync with the maintenance state. Modelled
 * on `sandbox-banner.js`, which solves the same "notice that must outlive the
 * view" problem.
 *
 * The reassurance is the point. During a deploy the user's saves start failing;
 * without this they see errors and assume their work is gone. It stays in the
 * browser and saves as soon as the server is back, and the banner is the only
 * place that says so.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import {
  isMaintenanceActive,
  onMaintenanceChange,
} from '../../lib/state/maintenance.js';

let bannerEl = null;
let unsubscribe = null;

function bannerText() {
  return t(
    'maintenance.banner.text',
    'Deckyard is briefly unavailable for maintenance. Your work is kept here and saves as soon as it is back.',
  );
}

function buildBanner() {
  return h(
    'div',
    {
      class: 'maintenance-banner',
      // `alert` rather than `status`: this interrupts what the user is doing
      // (their edits stop being saved), so it warrants an assertive
      // announcement rather than waiting for a pause in screen-reader output.
      role: 'alert',
      'aria-live': 'assertive',
    },
    [
      h('span', { class: 'maintenance-banner-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'maintenance-banner-text', text: bannerText() }),
    ],
  );
}

/**
 * Mount or unmount the banner to match the current maintenance state.
 * Safe to call repeatedly.
 */
export function syncMaintenanceBanner() {
  if (typeof document === 'undefined') return;
  const active = isMaintenanceActive();

  if (active && !bannerEl) {
    bannerEl = buildBanner();
    document.body.appendChild(bannerEl);
  } else if (active && bannerEl) {
    // Locale may have changed since it was built; refresh the copy in place.
    const textEl = bannerEl.querySelector('.maintenance-banner-text');
    if (textEl) textEl.textContent = bannerText();
  } else if (!active && bannerEl) {
    bannerEl.remove();
    bannerEl = null;
  }
}

/**
 * Start keeping the banner in sync with maintenance transitions.
 * Idempotent — a second call does not add a second subscription.
 *
 * @returns {() => void} Stop syncing and remove the banner.
 */
export function startMaintenanceBanner() {
  if (!unsubscribe) unsubscribe = onMaintenanceChange(syncMaintenanceBanner);
  syncMaintenanceBanner();
  return () => {
    unsubscribe?.();
    unsubscribe = null;
    bannerEl?.remove();
    bannerEl = null;
  };
}
