/**
 * Sandbox banner.
 *
 * A small, always-visible notice that tells the user they are in a temporary
 * throwaway sandbox whose data is wiped after the TTL, with the two ways out
 * (A4): install Deckyard yourself, the main route, or ask us to host it. Mounted
 * once on document.body (outside the SPA view root, which is cleared on every
 * route render) and kept in sync with the `sandboxMode` feature flag.
 */

import { h } from './index.js';
import { t } from '../ui-i18n.js';
import { getFeatures } from '../state/features.js';
import { route } from '../state/router.js';

let bannerEl = null;

/** Where "install it yourself" lands: the self-host quickstart on deckyard.eu. */
export const SELF_HOST_URL = 'https://deckyard.eu/docs/deployment/quickstart/';

/** The hosted contact, the same address and subject deckyard.eu/hosting uses. */
export const HOSTED_CONTACT_URL =
  'mailto:jaap@jaapstronks.nl?subject=Deckyard%20hosting';

/**
 * Routes whose screen the audience sees: the presenter (and its projector
 * window) goes on the beamer, follow-along is on the audience's phones. The
 * banner warns the person working in the sandbox; the editor around a
 * presentation already carries it, so these screens stay clean (B357).
 */
const AUDIENCE_ROUTES = new Set(['present', 'presentWindow', 'follow']);

/**
 * The banner copy. The hours come from the server's `SANDBOX_TTL_HOURS` (the
 * `sandboxTtlHours` feature flag), the number the cleanup job deletes on; the
 * banner is only mounted in sandbox mode, where the server always sends it.
 */
function bannerText() {
  return t(
    'sandbox.banner.text',
    'Temporary Deckyard sandbox - your work is deleted after {hours} hours.',
    { hours: getFeatures()?.sandboxTtlHours },
  );
}

function selfHostLabel() {
  return t('sandbox.banner.selfHost', 'Install Deckyard yourself');
}

function hostedLabel() {
  return t('sandbox.banner.hosted', 'Or let us host it for you');
}

/** Each copy-carrying element of the banner, with the copy it shows. */
const BANNER_COPY = [
  ['.sandbox-banner-text', bannerText],
  ['.sandbox-banner-self-host', selfHostLabel],
  ['.sandbox-banner-hosted', hostedLabel],
];

function buildBanner() {
  return h('div', { class: 'sandbox-banner' }, [
    h('p', { class: 'sandbox-banner-line', role: 'status' }, [
      h('span', { class: 'sandbox-banner-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'sandbox-banner-text', text: bannerText() }),
    ]),
    h('div', { class: 'sandbox-banner-exits' }, [
      h('a', {
        class: 'sandbox-banner-link sandbox-banner-self-host',
        href: SELF_HOST_URL,
        target: '_blank',
        rel: 'noopener',
        text: selfHostLabel(),
      }),
      h('a', {
        class: 'sandbox-banner-link sandbox-banner-hosted',
        href: HOSTED_CONTACT_URL,
        text: hostedLabel(),
      }),
    ]),
  ]);
}

/**
 * Mount or unmount the sandbox banner to match the current feature flags and
 * route. Safe to call repeatedly (after every feature-flag refresh, on every
 * route render).
 *
 * @param {string} [routeName] - The route being shown; defaults to the
 *   router's current route.
 */
export function syncSandboxBanner(routeName = route().name) {
  if (typeof document === 'undefined') return;
  const active =
    !!getFeatures()?.sandboxMode && !AUDIENCE_ROUTES.has(routeName);

  if (active && !bannerEl) {
    bannerEl = buildBanner();
    document.body.appendChild(bannerEl);
  } else if (active && bannerEl) {
    // Locale may have changed since it was built; refresh the copy in place.
    for (const [selector, copy] of BANNER_COPY) {
      const el = bannerEl.querySelector(selector);
      if (el) el.textContent = copy();
    }
  } else if (!active && bannerEl) {
    bannerEl.remove();
    bannerEl = null;
  }
}
