/**
 * Shared scaffolding for the four auth views (login, magic-login,
 * forgot-password, reset-password): the `auth-shell > auth-card > auth-header`
 * skeleton they all build identically. The form content stays per view.
 *
 * The returned `title` and `subtitle` elements are live references — views
 * update their `textContent` as async state changes (token validation,
 * verification progress).
 *
 * The header carries the instance logo (`APP_LOGO_URL`) above the title when
 * one is configured, read from the public sign-in config; without one the
 * card shows no logo.
 */

import { h } from '../lib/dom.js';
import { authConfig } from '../lib/user/auth.js';
import { debugLog } from '../lib/util/debug.js';

/**
 * Build the auth-view scaffolding: shell, card and header with title/subtitle.
 * The card already contains the header; append view content after it, then
 * mount with `root.append(shell)`.
 *
 * @param {Object} options
 * @param {string} options.title heading text
 * @param {string} options.subtitle sub-heading text
 * @param {boolean} [options.centered=false] add `is-centered` to the card
 * @returns {{ shell: HTMLElement, card: HTMLElement, header: HTMLElement,
 *   title: HTMLElement, subtitle: HTMLElement }}
 */
export function authShell({ title, subtitle, centered = false } = {}) {
  const shell = h('div', { class: 'auth-shell' });
  const card = h('div', {
    class: centered ? 'auth-card is-centered' : 'auth-card',
  });
  const header = h('div', { class: 'auth-header' });
  const titleEl = h('h1', { class: 'auth-title', text: title });
  const subtitleEl = h('p', { class: 'auth-subtitle', text: subtitle });
  header.append(titleEl, subtitleEl);
  card.append(header);
  shell.append(card);
  authConfig()
    .then((cfg) => {
      const logo = authLogo(cfg?.branding);
      if (logo) header.prepend(logo);
    })
    .catch((err) => {
      // No config, no logo: the card reads fine without one.
      debugLog('[auth-shell] sign-in config unreadable, no logo', err);
    });
  return { shell, card, header, title: titleEl, subtitle: subtitleEl };
}

/**
 * The instance logo for the auth header, or null when none is configured.
 *
 * @param {{ appName?: string, logoUrl?: string|null }|undefined} branding -
 *   `authConfig().branding`.
 * @returns {HTMLElement|null}
 */
export function authLogo(branding) {
  const src = branding?.logoUrl;
  if (typeof src !== 'string' || !src) return null;
  return h('img', {
    class: 'auth-logo',
    src,
    alt: branding.appName || '',
  });
}
