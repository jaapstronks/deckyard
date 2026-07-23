/**
 * Sandbox banner.
 *
 * A small, always-visible notice that tells the user they are in a temporary
 * throwaway sandbox whose data is wiped after the TTL (default 24h). Mounted
 * once on document.body (outside the SPA view root, which is cleared on every
 * route render) and kept in sync with the `sandboxMode` feature flag.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { getFeatures } from '../../lib/state/features.js';

let bannerEl = null;

function buildBanner() {
  return h(
    'div',
    {
      class: 'sandbox-banner',
      role: 'status',
      'aria-live': 'polite',
    },
    [
      h('span', { class: 'sandbox-banner-dot', 'aria-hidden': 'true' }),
      h('span', {
        class: 'sandbox-banner-text',
        text: t(
          'sandbox.banner.text',
          'Temporary Deckyard sandbox - your work is deleted after 24 hours.'
        ),
      }),
    ]
  );
}

/**
 * Mount or unmount the sandbox banner to match the current feature flags.
 * Safe to call repeatedly (e.g. after every feature-flag refresh).
 */
export function syncSandboxBanner() {
  if (typeof document === 'undefined') return;
  const active = !!getFeatures()?.sandboxMode;

  if (active && !bannerEl) {
    bannerEl = buildBanner();
    document.body.appendChild(bannerEl);
  } else if (active && bannerEl) {
    // Locale may have changed since it was built; refresh the copy in place.
    const textEl = bannerEl.querySelector('.sandbox-banner-text');
    if (textEl) {
      textEl.textContent = t(
        'sandbox.banner.text',
        'Temporary Deckyard sandbox - your work is deleted after 24 hours.'
      );
    }
  } else if (!active && bannerEl) {
    bannerEl.remove();
    bannerEl = null;
  }
}
