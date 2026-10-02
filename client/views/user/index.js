/**
 * User - the feature's public seam, shared by the list and editor topbars,
 * presence, settings and the share dialog: the avatar, the user menu with its
 * organization switcher, the notification bell, the user autocomplete and the
 * profile cache behind them.
 */

export { createAvatar, updateAvatar } from './avatar.js';
export { createNotificationBell } from './notification-bell.js';
export { createUserAutocomplete } from './user-autocomplete.js';
export { createUserMenu } from './user-menu.js';
export {
  getUserProfile,
  getUserProfileAsync,
  invalidateProfile,
} from './user-profiles.js';
