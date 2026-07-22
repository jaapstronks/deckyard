import { openImageLibraryPicker } from './image-library-picker.js';
import { openImageKitPicker } from './imagekit-picker.js';
import { createImagePickerSeam } from './media/picker-provider.js';

/**
 * Build the pluggable image-picker seam that the editor's field renderers and
 * inline WYSIWYG popover both call. It wraps the raw image-library and ImageKit
 * pickers so every image entry point goes through one provider-aware seam — a
 * new call site can no longer silently forget a provider (the bug that let the
 * inline popover ignore ImageKit). See media/picker-provider.js.
 *
 * @param {object} ctx
 * @param {Function} ctx.h - hyperscript DOM helper
 * @param {HTMLElement} ctx.root - editor root (overlay mount host)
 * @param {object} ctx.user - current user (image-library scoping)
 * @param {object} ctx.api - API client
 * @param {object} ctx.features - feature flags
 * @param {Function} ctx.openOverlayClosers - overlay registry closer collector
 * @returns {{ openImagePicker: Function }} the single seam every call site uses
 */
export function createImagePickers({ h, root, user, api, features, openOverlayClosers }) {
  const openImageLibrary = (opts) =>
    openImageLibraryPicker({
      ...opts,
      user,
      api,
      h,
      root,
      openOverlayClosers,
      features,
    });

  const openImageKit = (opts) =>
    openImageKitPicker({
      ...opts,
      api,
      h,
      root,
      openOverlayClosers,
    });

  const openImagePicker = createImagePickerSeam({
    h,
    root,
    features,
    openImageLibrary,
    openImageKit,
  });

  return { openImagePicker };
}
