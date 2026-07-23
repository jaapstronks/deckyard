/**
 * Lead capture slide runtime.
 * Handles form submission and displays thank you message without redirect.
 */

import { hasMarketingConsent } from '../util/cookie-consent.js';
import { t } from '../ui-i18n.js';

/**
 * Initialize lead capture slides within a root element.
 * @param {HTMLElement} rootEl - Root element to search for lead capture slides
 * @param {Object} options
 * @param {boolean} [options.interactive=true] - Enable form submission (false for thumbnails)
 * @returns {Function} Cleanup function
 */
export function initLeadCaptureSlides(rootEl, { interactive = true } = {}) {
  if (!rootEl) return () => {};

  const slides = rootEl.querySelectorAll('.slide-lead-capture[data-interaction="lead-capture"]');
  if (!slides.length) return () => {};

  const controllers = [];

  for (const slide of slides) {
    const controller = initLeadCaptureSlide(slide, { interactive });
    if (controller) controllers.push(controller);
  }

  return () => {
    for (const controller of controllers) {
      controller.cleanup?.();
    }
  };
}

/**
 * Initialize a single lead capture slide.
 * @param {HTMLElement} slideEl - The slide element
 * @param {Object} options
 * @returns {Object|null} Controller object with cleanup method
 */
function initLeadCaptureSlide(slideEl, { interactive }) {
  const form = slideEl.querySelector('[data-lead-form="1"]');
  const formState = slideEl.querySelector('[data-lead-state="form"]');
  const thankYouState = slideEl.querySelector('[data-lead-state="thankyou"]');
  const errorEl = slideEl.querySelector('[data-lead-error="1"]');
  const cookieNotice = slideEl.querySelector('[data-lead-cookie-notice="1"]');

  if (!form || !formState || !thankYouState) return null;

  const slideId = slideEl.dataset.slideId || '';

  // Read i18n error messages from data attributes (with fallbacks)
  const i18n = {
    acceptCookies: slideEl.dataset.errorAcceptCookies || 'Please accept marketing cookies to submit this form.',
    enterName: slideEl.dataset.errorEnterName || 'Please enter your name.',
    validEmail: slideEl.dataset.errorValidEmail || 'Please enter a valid email address.',
    acceptTerms: slideEl.dataset.errorAcceptTerms || 'Please accept the privacy terms.',
    generic: slideEl.dataset.errorGeneric || 'Something went wrong. Please try again.',
  };

  // Check if already submitted (from localStorage)
  const storageKey = `lead_submitted_${slideId}`;
  if (localStorage.getItem(storageKey) === 'true') {
    showThankYouState();
    return { cleanup: () => {} };
  }

  // Check cookie consent
  function checkCookieConsent() {
    const hasConsent = hasMarketingConsent();
    if (!hasConsent) {
      form.classList.add('is-disabled');
      if (cookieNotice) cookieNotice.hidden = false;
      return false;
    }
    form.classList.remove('is-disabled');
    if (cookieNotice) cookieNotice.hidden = true;
    return true;
  }

  // Initial consent check
  checkCookieConsent();

  // Listen for consent changes
  function handleStorageChange(e) {
    if (e.key === 'cookie_consent') {
      checkCookieConsent();
    }
  }
  window.addEventListener('storage', handleStorageChange);

  // Also check on visibility change (user might have accepted in another tab)
  function handleVisibilityChange() {
    if (!document.hidden) {
      checkCookieConsent();
    }
  }
  document.addEventListener('visibilitychange', handleVisibilityChange);

  if (!interactive) {
    return {
      cleanup: () => {
        window.removeEventListener('storage', handleStorageChange);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      },
    };
  }

  // Form submission handler
  async function handleSubmit(e) {
    e.preventDefault();

    // Re-check consent before submission
    if (!hasMarketingConsent()) {
      showError(i18n.acceptCookies);
      return;
    }

    const formData = new FormData(form);
    const name = (formData.get('name') || '').trim();
    const email = (formData.get('email') || '').trim();
    const consentChecked = form.querySelector('input[name="consent"]')?.checked;
    const consentText = formData.get('consentText') || '';
    const privacyUrl = formData.get('privacyUrl') || '';

    // Basic validation
    if (!name) {
      showError(i18n.enterName);
      return;
    }
    if (!email || !isValidEmail(email)) {
      showError(i18n.validEmail);
      return;
    }
    if (!consentChecked) {
      showError(i18n.acceptTerms);
      return;
    }

    clearError();
    form.classList.add('is-submitting');

    try {
      // Get presentation ID from the page context
      const presentationId = getPresentationId();
      if (!presentationId) {
        throw new Error(
          t('leadCapture.error.noPresentationId', 'Could not determine presentation ID')
        );
      }

      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presentationId,
          slideId,
          name,
          email,
          consentGiven: true,
          consentText,
          privacyUrl,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.message || t('leadCapture.error.submitFailed', 'Submission failed')
        );
      }

      // Mark as submitted
      localStorage.setItem(storageKey, 'true');

      // Show thank you state
      showThankYouState();
    } catch (err) {
      showError(err.message || i18n.generic);
    } finally {
      form.classList.remove('is-submitting');
    }
  }

  form.addEventListener('submit', handleSubmit);

  function showThankYouState() {
    formState.hidden = true;
    thankYouState.hidden = false;
  }

  function showError(message) {
    if (errorEl) {
      errorEl.textContent = message;
    }
  }

  function clearError() {
    if (errorEl) {
      errorEl.textContent = '';
    }
  }

  return {
    cleanup: () => {
      form.removeEventListener('submit', handleSubmit);
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    },
  };
}

/**
 * Simple email validation.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Try to get the presentation ID from various sources.
 */
function getPresentationId() {
  // Check data attribute on body or root element
  const rootAttr = document.body.dataset.presentationId ||
    document.querySelector('[data-presentation-id]')?.dataset.presentationId;
  if (rootAttr) return rootAttr;

  // Check URL path for /p/:id pattern
  const pathMatch = window.location.pathname.match(/\/p\/([a-f0-9-]+)/i);
  if (pathMatch) return pathMatch[1];

  // Check URL path for /share/:token pattern - need to extract from API state
  // This requires the share viewer to set the presentation ID somewhere

  // Check for a global app state
  if (typeof window.__PRESENTATION_ID__ === 'string') {
    return window.__PRESENTATION_ID__;
  }

  // Check closest slide element for presentation context
  const slideEl = document.querySelector('.slide-lead-capture');
  const deckEl = slideEl?.closest('[data-presentation-id]');
  if (deckEl) return deckEl.dataset.presentationId;

  return null;
}
