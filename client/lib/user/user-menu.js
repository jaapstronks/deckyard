/**
 * User menu dropdown component.
 *
 * Displays a user avatar that opens a dropdown with Settings and Sign out options.
 */

import { h as defaultH } from '../dom.js';
import { installDismissOnOutside } from '../dom.js';
import { createAvatar, updateAvatar } from './avatar.js';
import { getUserProfileAsync } from './user-profiles.js';
import { displayNameFromEmail } from './user-format.js';
import { logout } from './auth.js';
import { storage } from '../storage.js';
import { t } from '../ui-i18n.js';
import { getHelpUrl } from '../theme/branding.js';

/**
 * Create a user menu dropdown.
 *
 * @param {Object} options
 * @param {Function} [options.h] - DOM helper function
 * @param {Object} options.user - Current user object { email, name? }
 * @param {Function} options.nav - Navigation function
 * @param {Function} [options.onLogout] - Optional custom logout handler
 * @returns {{ el: HTMLElement, detach: Function }}
 */
export function createUserMenu({ h = defaultH, user, nav, onLogout } = {}) {
  const detachers = [];

  const email = user?.email || '';
  const isAnonymous = email === 'anonymous';
  const displayName = user?.name || displayNameFromEmail(email);

  // Create avatar
  const avatar = createAvatar({
    email,
    name: user?.name || '',
    size: 'sm',
    className: 'user-menu-avatar',
  });

  // Fetch profile and update avatar with image if available
  if (email && !isAnonymous) {
    getUserProfileAsync(email)
      .then((profile) => {
        if (profile?.imageUrl) {
          updateAvatar(avatar, { imageUrl: profile.imageUrl });
        }
        if (profile?.name) {
          updateAvatar(avatar, { name: profile.name });
        }
      })
      .catch(() => {
        // Keep initial values on error
      });
  }

  // Create dropdown
  const details = h('details', { class: 'dropdown user-menu' });
  const summary = h(
    'summary',
    {
      class: 'user-menu-trigger dropdown-trigger',
      title: displayName,
      'aria-label': t('common.userMenu', 'User menu'),
    },
    [avatar]
  );

  // Menu items
  const menuItems = [];

  // User info header
  const userInfo = h('div', { class: 'user-menu-header' }, [
    h('div', { class: 'user-menu-name', text: displayName }),
    email && !isAnonymous
      ? h('div', { class: 'user-menu-email', text: email })
      : null,
  ].filter(Boolean));
  menuItems.push(userInfo);

  // Separator
  menuItems.push(h('div', { class: 'dropdown-sep' }));

  // Settings
  const btnSettings = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('common.settings', 'Settings'),
    onclick: () => {
      details.open = false;
      nav?.('/settings');
    },
  });
  menuItems.push(btnSettings);

  // Help / docs (only when a docs URL is configured)
  const helpUrl = getHelpUrl();
  if (helpUrl) {
    const linkHelp = h('a', {
      class: 'dropdown-item',
      href: helpUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: t('common.help', 'Help & docs'),
      onclick: () => {
        details.open = false;
      },
    });
    menuItems.push(linkHelp);
  }

  // Sign out (only for authenticated users)
  if (!isAnonymous) {
    menuItems.push(h('div', { class: 'dropdown-sep' }));

    const btnLogout = h('button', {
      class: 'dropdown-item is-danger',
      type: 'button',
      text: t('common.signOut', 'Sign out'),
      onclick: async () => {
        details.open = false;
        try {
          if (onLogout) {
            await onLogout();
          } else {
            await logout();
          }
        } catch (e) {
          console.error('Logout failed:', e);
        }
        // Clear view preference so next login starts fresh on 'home'
        storage.remove('ps:presentation-list-view');
        nav?.('/login');
      },
    });
    menuItems.push(btnLogout);
  }

  const menu = h('div', { class: 'dropdown-menu dropdown-menu-right' }, menuItems);
  details.append(summary, menu);

  // Close on outside click / Escape
  detachers.push(
    installDismissOnOutside({
      rootEl: details,
      isOpen: () => !!details.open,
      close: () => {
        details.open = false;
      },
    })
  );

  return {
    el: details,
    detach: () => {
      for (const d of detachers) {
        try {
          if (typeof d === 'function') d();
        } catch {
          // ignore
        }
      }
    },
  };
}
