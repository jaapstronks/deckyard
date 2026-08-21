import { openImageLibraryPicker } from './image-library-picker.js';
import { openImageKitPicker } from './imagekit-picker.js';
import { openBundledGradientPicker } from './bundled-gradients/picker.js';
import { createImagePickerSeam } from './media/picker-provider.js';
import {
  fetchStockMediaStatus,
  isStockSourceAvailable,
} from '../../lib/net/stock-media.js';

/**
 * Build the pluggable image-picker seam that the editor's field renderers and
 * inline WYSIWYG popover both call. It wraps the raw image-library, gradient
 * and ImageKit pickers so every image entry point goes through one
 * provider-aware seam — a new call site can no longer silently forget a
 * provider (the bug that let the inline popover ignore ImageKit). See
 * media/picker-provider.js.
 *
 * Async because one of the three sources is an admin setting rather than an
 * env flag: `stockMedia.bundled.enabled` lives in app settings, so the seam
 * cannot be assembled until the status is in. The fetch is memoised in
 * lib/net/stock-media.js and shared with the image library, so this costs one
 * small request per session, not per editor.
 *
 * @param {object} ctx
 * @param {HTMLElement} ctx.root - editor root (overlay mount host)
 * @param {object} ctx.user - current user (image-library scoping)
 * @param {object} ctx.api - API client
 * @param {object} ctx.features - feature flags
 * @param {Function} ctx.openOverlayClosers - overlay registry closer collector
 * @returns {Promise<{ openImagePicker: Function }>} the single seam every call site uses
 */
export async function createImagePickers({
  root,
  user,
  api,
  features,
  openOverlayClosers,
}) {
  const openImageLibrary = (opts) =>
    openImageLibraryPicker({
      ...opts,
      user,
      api,
      root,
      openOverlayClosers,
      features,
    });

  // Only offer ImageKit as a source when the server reports it's actually
  // configured — otherwise the chooser shows an "ImageKit" button that leads
  // straight to a "not configured" error. Undefined keeps ImageKit off.
  const openImageKit = features?.imagekitConfigured
    ? (opts) =>
        openImageKitPicker({
          ...opts,
          api,
          root,
          openOverlayClosers,
        })
    : undefined;

  // Same rule as ImageKit: only offer a source the server says is usable, so
  // the chooser never shows a button that leads to a "not available" error.
  const stockMedia = await fetchStockMediaStatus();
  const openBundledGradients = isStockSourceAvailable(stockMedia, 'bundled')
    ? (opts) =>
        openBundledGradientPicker({
          ...opts,
          root,
          openOverlayClosers,
        })
    : undefined;

  const openImagePicker = createImagePickerSeam({
    root,
    features,
    openImageLibrary,
    openBundledGradients,
    openImageKit,
  });

  return { openImagePicker };
}
