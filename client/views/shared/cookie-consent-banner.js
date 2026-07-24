/**
 * Cookie consent banner component.
 * Shows a banner for users to accept/manage cookie preferences.
 */

import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import {
  getConsentState,
  setConsentState,
  acceptAllCookies,
  acceptNecessaryOnly,
  shouldShowConsentBanner,
} from '../../lib/util/cookie-consent.js';

/**
 * Create and mount the cookie consent banner.
 * @param {Object} options
 * @param {boolean} [options.isAuthenticated] - Whether user is authenticated
 * @param {HTMLElement} [options.container] - Container to mount to (default: document.body)
 * @returns {{ show: Function, hide: Function, destroy: Function, el: HTMLElement }}
 */
export function createCookieConsentBanner({ isAuthenticated = false, container = document.body } = {}) {
  let bannerEl = null;
  let settingsEl = null;
  let isVisible = false;

  // Check if banner should be shown
  const shouldShow = shouldShowConsentBanner(isAuthenticated);

  // Build the banner element
  function buildBanner() {
    const banner = h('div', { class: 'cookie-consent-banner', role: 'dialog', 'aria-label': t('cookies.bannerLabel', 'Cookie consent') }, [
      h('div', { class: 'cookie-consent-content' }, [
        h('div', { class: 'cookie-consent-text' }, [
          h('p', { class: 'cookie-consent-title', text: t('cookies.title', 'We use cookies') }),
          h('p', { class: 'cookie-consent-description', text: t('cookies.description', 'We use cookies to improve your experience and analyze site usage. You can manage your preferences below.') }),
        ]),
        h('div', { class: 'cookie-consent-actions' }, [
          h('button', {
            class: 'btn btn-secondary cookie-consent-btn-settings',
            text: t('cookies.manage', 'Manage preferences'),
            onclick: () => showSettings(),
          }),
          h('button', {
            class: 'btn btn-secondary cookie-consent-btn-necessary',
            text: t('cookies.acceptNecessary', 'Necessary only'),
            onclick: () => handleAcceptNecessary(),
          }),
          h('button', {
            class: 'btn btn-primary cookie-consent-btn-accept',
            text: t('cookies.acceptAll', 'Accept all'),
            onclick: () => handleAcceptAll(),
          }),
        ]),
      ]),
    ]);

    return banner;
  }

  // Build the settings modal
  function buildSettings() {
    const currentState = getConsentState();

    const settings = h('div', { class: 'cookie-consent-settings-overlay', onclick: (e) => {
      if (e.target === settings) hideSettings();
    } }, [
      h('div', { class: 'cookie-consent-settings', role: 'dialog', 'aria-label': t('cookies.settingsLabel', 'Cookie preferences') }, [
        h('div', { class: 'cookie-consent-settings-header' }, [
          h('h2', { class: 'cookie-consent-settings-title', text: t('cookies.settingsTitle', 'Cookie preferences') }),
          h('button', {
            class: 'cookie-consent-settings-close',
            'aria-label': t('common.close', 'Close'),
            onclick: () => hideSettings(),
          }, [h('span', { text: '\u00D7' })]),
        ]),
        h('div', { class: 'cookie-consent-settings-body' }, [
          // Necessary cookies (always on)
          h('div', { class: 'cookie-consent-category' }, [
            h('div', { class: 'cookie-consent-category-header' }, [
              h('div', { class: 'cookie-consent-category-info' }, [
                h('h3', { class: 'cookie-consent-category-title', text: t('cookies.necessary.title', 'Necessary') }),
                h('p', { class: 'cookie-consent-category-description', text: t('cookies.necessary.description', 'Essential for the website to function. Cannot be disabled.') }),
              ]),
              h('label', { class: 'cookie-consent-toggle cookie-consent-toggle-disabled' }, [
                h('input', { type: 'checkbox', checked: true, disabled: true }),
                h('span', { class: 'cookie-consent-toggle-slider' }),
              ]),
            ]),
          ]),
          // Analytics cookies
          h('div', { class: 'cookie-consent-category' }, [
            h('div', { class: 'cookie-consent-category-header' }, [
              h('div', { class: 'cookie-consent-category-info' }, [
                h('h3', { class: 'cookie-consent-category-title', text: t('cookies.analytics.title', 'Analytics') }),
                h('p', { class: 'cookie-consent-category-description', text: t('cookies.analytics.description', 'Help us understand how visitors interact with our website.') }),
              ]),
              h('label', { class: 'cookie-consent-toggle' }, [
                h('input', {
                  type: 'checkbox',
                  id: 'cookie-consent-analytics',
                  checked: currentState.analytics,
                }),
                h('span', { class: 'cookie-consent-toggle-slider' }),
              ]),
            ]),
          ]),
          // Marketing cookies
          h('div', { class: 'cookie-consent-category' }, [
            h('div', { class: 'cookie-consent-category-header' }, [
              h('div', { class: 'cookie-consent-category-info' }, [
                h('h3', { class: 'cookie-consent-category-title', text: t('cookies.marketing.title', 'Marketing') }),
                h('p', { class: 'cookie-consent-category-description', text: t('cookies.marketing.description', 'Used for lead capture forms and personalized content.') }),
              ]),
              h('label', { class: 'cookie-consent-toggle' }, [
                h('input', {
                  type: 'checkbox',
                  id: 'cookie-consent-marketing',
                  checked: currentState.marketing,
                }),
                h('span', { class: 'cookie-consent-toggle-slider' }),
              ]),
            ]),
          ]),
        ]),
        h('div', { class: 'cookie-consent-settings-footer' }, [
          h('button', {
            class: 'btn btn-secondary',
            text: t('common.cancel', 'Cancel'),
            onclick: () => hideSettings(),
          }),
          h('button', {
            class: 'btn btn-primary',
            text: t('cookies.savePreferences', 'Save preferences'),
            onclick: () => handleSavePreferences(),
          }),
        ]),
      ]),
    ]);

    return settings;
  }

  function handleAcceptAll() {
    acceptAllCookies();
    hide();
  }

  function handleAcceptNecessary() {
    acceptNecessaryOnly();
    hide();
  }

  function handleSavePreferences() {
    const analyticsCheckbox = settingsEl?.querySelector('#cookie-consent-analytics');
    const marketingCheckbox = settingsEl?.querySelector('#cookie-consent-marketing');

    setConsentState({
      analytics: analyticsCheckbox?.checked || false,
      marketing: marketingCheckbox?.checked || false,
    });

    hideSettings();
    hide();
  }

  function show() {
    if (isVisible || bannerEl) return;

    bannerEl = buildBanner();
    container.appendChild(bannerEl);
    isVisible = true;

    // Animate in
    requestAnimationFrame(() => {
      bannerEl?.classList.add('cookie-consent-banner-visible');
    });
  }

  function hide() {
    if (!bannerEl) return;

    bannerEl.classList.remove('cookie-consent-banner-visible');

    // Wait for animation
    setTimeout(() => {
      bannerEl?.remove();
      bannerEl = null;
      isVisible = false;
    }, 300);

    hideSettings();
  }

  function showSettings() {
    if (settingsEl) return;

    settingsEl = buildSettings();
    container.appendChild(settingsEl);

    // Animate in
    requestAnimationFrame(() => {
      settingsEl?.classList.add('cookie-consent-settings-visible');
    });
  }

  function hideSettings() {
    if (!settingsEl) return;

    settingsEl.classList.remove('cookie-consent-settings-visible');

    setTimeout(() => {
      settingsEl?.remove();
      settingsEl = null;
    }, 300);
  }

  function destroy() {
    hide();
    hideSettings();
  }

  // Auto-show if needed
  if (shouldShow) {
    // Delay slightly to let the page load
    setTimeout(() => show(), 500);
  }

  return {
    show,
    hide,
    destroy,
    el: bannerEl,
    shouldShow,
  };
}

/**
 * Initialize cookie consent banner on public views.
 * Call this on page load for public/embed views.
 * @param {Object} options
 * @param {boolean} [options.isAuthenticated] - Whether user is authenticated
 */
export function initCookieConsent({ isAuthenticated = false } = {}) {
  // Only init if DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createCookieConsentBanner({ isAuthenticated });
    });
  } else {
    createCookieConsentBanner({ isAuthenticated });
  }
}
