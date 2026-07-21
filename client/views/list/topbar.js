/**
 * List Topbar Component
 * Creates the topbar for the presentation list view
 */

import { t } from '../../lib/ui-i18n.js';
import { getAppName } from '../../lib/theme/branding.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { createUiModeSwitcher } from '../ui-mode-switcher.js';
import { createNotificationBell } from '../../lib/user/notification-bell.js';
import { createUserMenu } from '../../lib/user/user-menu.js';

/**
 * Create the topbar for the presentation list view
 * @param {object} options
 * @param {Function} options.h - DOM helper function
 * @param {object} options.features - Feature flags
 * @param {Function} options.api - API client
 * @param {Function} options.nav - Navigation function
 * @param {object} options.user - Current user
 * @param {Array} options.detachers - Array to push cleanup functions
 * @param {Function} options.onSearch - Search callback
 * @returns {object} { el, searchInput }
 */
export function createTopbar({
  h,
  features,
  api,
  nav,
  user,
  detachers,
  onSearch,
}) {
  const isSandbox = !!features?.sandboxMode;
  const brandLogo = isSandbox
    ? '/assets/images/deckyard-mark.svg'
    : '/assets/images/logo.svg';
  const brandAlt = getAppName();

  // Brand section
  const brandSection = h('div', { class: 'presentation-topbar-brand' });
  const brand = h('div', { class: 'presentation-brand' });
  brand.append(
    h('img', {
      class: 'presentation-brand-logo',
      src: brandLogo,
      alt: brandAlt,
    })
  );
  brandSection.append(brand);

  // Search input
  const searchWrapper = h('div', { class: 'topbar-search-wrapper' });
  const searchIcon = h('img', { class: 'topbar-search-icon', src: iconUrl('search'), alt: '', 'aria-hidden': 'true' });
  const searchInput = h('input', {
    type: 'search',
    class: 'topbar-search-input',
    placeholder: t('list.search.placeholder', 'Search presentations…'),
    'aria-label': t('list.search.aria', 'Search presentations'),
  });
  searchInput.addEventListener('input', (e) => {
    onSearch?.(e.target.value);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchInput.blur();
      onSearch?.('');
    }
  });
  searchWrapper.append(searchIcon, searchInput);

  // Topbar content (right side)
  const topbarContent = h('div', { class: 'presentation-topbar-content' });

  // UI mode switcher (dark/light mode)
  const uiMode = createUiModeSwitcher({ h });
  detachers.push(uiMode.detach);

  // Notification bell
  const notificationBell = createNotificationBell({
    api,
    onNavigate: (path) => nav?.(path),
  });
  detachers.push(notificationBell.detach);

  // User menu (settings + sign out)
  const userMenu = createUserMenu({ h, user, nav });
  detachers.push(userMenu.detach);

  topbarContent.append(
    searchWrapper,
    uiMode.el,
    notificationBell.el,
    userMenu.el
  );

  return {
    el: h('header', { class: 'topbar presentation-topbar', role: 'banner' }, [
      brandSection,
      topbarContent,
    ]),
    searchInput,
  };
}