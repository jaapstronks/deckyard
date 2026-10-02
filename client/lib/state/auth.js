import { api } from '../api.js';
import { t } from '../ui-i18n.js';

export async function meWithMeta() {
  try {
    const body = await api('/api/auth/me');
    return {
      user: body?.user || null,
      features: body?.features || null,
    };
  } catch (err) {
    // Signed out is a state, not a failure — and the one place a 401 must
    // not become a toast: the router redirects to /login on a null user.
    if (err?.statusCode === 401) return { user: null, features: null };
    throw err;
  }
}

// Back-compat convenience: most call sites only need the user.
export async function me() {
  const { user } = await meWithMeta();
  return user || null;
}

export async function login(email, password) {
  const body = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return body?.user || null;
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  return true;
}

/** @type {Promise<Object>|null} */
let authConfigRead = null;

/**
 * The instance's public sign-in configuration (`GET /api/auth/config`): which
 * ways in exist and what the SSO button says, plus the instance branding the
 * auth pages show. One reading for every screen that has to name them — the
 * auth pages, and the invite dialog telling an inviter how the new member
 * gets in when no mail went out. The config is fixed per server boot, so one
 * read serves the page; a failed read is not kept.
 *
 * @returns {Promise<{
 *   sso: { enabled: boolean, enforce: boolean, provider: string|null, loginPath: string, buttonLabel: string|null },
 *   branding: { appName: string, helpUrl: string|null, logoUrl: string|null },
 * }>}
 */
export function authConfig() {
  if (!authConfigRead) {
    authConfigRead = api('/api/auth/config').catch((err) => {
      authConfigRead = null;
      throw err;
    });
  }
  return authConfigRead;
}

/**
 * The words on the SSO button: the instance's own (`SSO_BUTTON_LABEL`) or the
 * translated default. The login page and every sentence that points at that
 * button read it here, so they cannot name a button that is not there.
 *
 * @param {{ sso?: { buttonLabel?: string|null } }|null} config - `authConfig()`.
 * @returns {string}
 */
export function ssoButtonLabel(config) {
  const label = config?.sso?.buttonLabel;
  return typeof label === 'string' && label.trim()
    ? label.trim()
    : t('login.ssoSubmit', 'Sign in with SSO');
}
