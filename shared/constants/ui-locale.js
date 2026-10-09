/**
 * Shared interface-locale constants.
 * Used by both client (`client/lib/ui-i18n.js`) and server (the default user
 * settings in `server/storage/settings.js`).
 */

/**
 * The interface language when nothing names one: no saved preference, no
 * `?locale=`, no deck language and no browser language the manifest knows.
 *
 * One default for the whole installation (D322). The client used to fall back
 * to `nl` while a new user's server settings said `en`, so the app shell was
 * English and every page without a session (share link, follow, `/go`) was
 * Dutch, whatever the visitor spoke (B615).
 * @type {string}
 */
export const DEFAULT_UI_LOCALE = 'en';
