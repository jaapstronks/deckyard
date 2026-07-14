/**
 * Settings View
 * Re-exports the settings page from the settings module.
 */

import { renderSettingsPage } from './settings/index.js';

export async function renderSettings(root, options) {
  return renderSettingsPage(root, options);
}