/**
 * Backward-compatibility shim.
 *
 * All new code should import from './icon-names.js' directly.
 * This file re-exports under the old names so existing imports
 * (especially in downstream repos) keep working during migration.
 */
import { ICON_NAMES, iconUrl } from './icon-names.js';

export const PHOSPHOR_ICON_NAMES = ICON_NAMES;
export const phosphorIconUrl = iconUrl;
