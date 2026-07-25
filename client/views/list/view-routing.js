/**
 * Persisted view routing for the presentation list.
 *
 * Owns which "tab" (home / presentations / slideLibrary / activity / trash) the
 * list opens on, including fresh-login reset and redirection of legacy keys.
 */

import { storage } from '../../lib/storage.js';

export const LOCAL_STORAGE_KEY_VIEW = 'ps:presentation-list-view';
const SESSION_KEY_FRESH_LOGIN = 'ps:fresh-login-pending';
export const VALID_VIEWS = ['home', 'presentations', 'slideLibrary', 'activity', 'trash'];

// Legacy per-source view keys now fold into the unified "presentations" view.
// Redirect stale persisted values (and any old deep link) so returning users
// don't land on a dead key.
const LEGACY_VIEW_REDIRECT = {
  recent: 'presentations',
  workspace: 'presentations',
  myPresentations: 'presentations',
  sharedWithMe: 'presentations',
  private: 'presentations',
};

/**
 * Resolve the view to open on. A fresh login resets to 'home'; otherwise the
 * last persisted view is restored (redirecting legacy keys, falling back to
 * 'home' for anything unknown).
 * @returns {string}
 */
export function resolveInitialView() {
  // Check if this is a fresh login session - if so, reset to 'home'
  try {
    const freshLogin = sessionStorage.getItem(SESSION_KEY_FRESH_LOGIN);
    if (freshLogin === '1') {
      sessionStorage.removeItem(SESSION_KEY_FRESH_LOGIN);
      storage.remove(LOCAL_STORAGE_KEY_VIEW);
      return 'home';
    }
  } catch { /* sessionStorage may not be available */ }

  const raw = storage.get(LOCAL_STORAGE_KEY_VIEW, '').trim();
  const redirected = LEGACY_VIEW_REDIRECT[raw] || raw;
  return VALID_VIEWS.includes(redirected) ? redirected : 'home';
}
