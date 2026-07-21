/**
 * Cookie consent state management.
 * Handles storing and retrieving user consent preferences for different cookie categories.
 */

const STORAGE_KEY = 'cookie_consent';
const CONSENT_DURATION_DAYS = 365;

// Consent categories
export const CONSENT_CATEGORIES = {
  NECESSARY: 'necessary', // Always on - session, auth
  ANALYTICS: 'analytics', // View tracking
  MARKETING: 'marketing', // Lead capture forms
};

/**
 * Default consent state (before user makes a choice).
 * Necessary cookies are always enabled.
 */
const DEFAULT_CONSENT = {
  [CONSENT_CATEGORIES.NECESSARY]: true,
  [CONSENT_CATEGORIES.ANALYTICS]: false,
  [CONSENT_CATEGORIES.MARKETING]: false,
  timestamp: null,
};

/**
 * Get the current consent state from localStorage.
 * @returns {{ necessary: boolean, analytics: boolean, marketing: boolean, timestamp: string|null }}
 */
export function getConsentState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_CONSENT };

    const parsed = JSON.parse(stored);
    return {
      [CONSENT_CATEGORIES.NECESSARY]: true, // Always true
      [CONSENT_CATEGORIES.ANALYTICS]: parsed[CONSENT_CATEGORIES.ANALYTICS] === true,
      [CONSENT_CATEGORIES.MARKETING]: parsed[CONSENT_CATEGORIES.MARKETING] === true,
      timestamp: parsed.timestamp || null,
    };
  } catch {
    return { ...DEFAULT_CONSENT };
  }
}

/**
 * Save consent state to localStorage.
 * @param {{ analytics: boolean, marketing: boolean }} consent - Consent preferences
 */
export function setConsentState({ analytics = false, marketing = false }) {
  try {
    const state = {
      [CONSENT_CATEGORIES.NECESSARY]: true,
      [CONSENT_CATEGORIES.ANALYTICS]: analytics === true,
      [CONSENT_CATEGORIES.MARKETING]: marketing === true,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    // Dispatch event for other components to react
    window.dispatchEvent(new CustomEvent('cookieConsentChanged', { detail: state }));

    return state;
  } catch {
    return null;
  }
}

/**
 * Accept all cookies.
 * @returns {{ necessary: boolean, analytics: boolean, marketing: boolean, timestamp: string }}
 */
export function acceptAllCookies() {
  return setConsentState({ analytics: true, marketing: true });
}

/**
 * Accept only necessary cookies (reject analytics and marketing).
 * @returns {{ necessary: boolean, analytics: boolean, marketing: boolean, timestamp: string }}
 */
export function acceptNecessaryOnly() {
  return setConsentState({ analytics: false, marketing: false });
}

/**
 * Check if user has made a consent choice.
 * @returns {boolean}
 */
export function hasConsentChoice() {
  const state = getConsentState();
  return state.timestamp !== null;
}

/**
 * Check if analytics consent is given.
 * @returns {boolean}
 */
export function hasAnalyticsConsent() {
  return getConsentState()[CONSENT_CATEGORIES.ANALYTICS] === true;
}

/**
 * Check if marketing consent is given.
 * @returns {boolean}
 */
export function hasMarketingConsent() {
  return getConsentState()[CONSENT_CATEGORIES.MARKETING] === true;
}

/**
 * Clear consent state (for testing or user request).
 */
export function clearConsentState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('cookieConsentChanged', { detail: DEFAULT_CONSENT }));
  } catch {
    // Ignore
  }
}

/**
 * Check if consent is still valid (not expired).
 * @returns {boolean}
 */
export function isConsentValid() {
  const state = getConsentState();
  if (!state.timestamp) return false;

  const consentDate = new Date(state.timestamp);
  const expiryDate = new Date(consentDate);
  expiryDate.setDate(expiryDate.getDate() + CONSENT_DURATION_DAYS);

  return new Date() < expiryDate;
}

/**
 * Check if consent banner should be shown.
 * Shows banner on public/embed views if no valid consent stored.
 * @param {boolean} isAuthenticated - Whether user is authenticated
 * @returns {boolean}
 */
export function shouldShowConsentBanner(isAuthenticated = false) {
  // Don't show on authenticated internal views
  if (isAuthenticated) return false;

  // Show if no consent choice or expired
  return !hasConsentChoice() || !isConsentValid();
}
