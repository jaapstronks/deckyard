/**
 * Pluggable image-picker seam.
 *
 * Deckyard historically injected TWO picker functions — the native image
 * library (`openImageLibrary`) and ImageKit (`openImageKit`) — that every image
 * call site had to wire and duck-type separately. New entry points kept
 * forgetting one: the inline WYSIWYG media popover silently dropped ImageKit,
 * so in an ImageKit-only deployment the in-canvas "change image" button ignored
 * the configured provider entirely.
 *
 * This module collapses the two into ONE `openImagePicker(opts)` seam. Call
 * sites pass a normalized `onPick(picked)` and never learn which provider backs
 * it. The seam resolves the enabled providers from feature flags: with exactly
 * one it opens directly; with more than one it shows a lightweight source
 * chooser first. A fork swaps the provider table once (register ImageKit,
 * disable the library) and inherits every current and future call site.
 *
 * The normalization also unifies three historical pick shapes (native library
 * item, ImageKit pick, Beeldbank pick) into one contract; `apply-pick.js`
 * flattens it onto the (unchanged) flat `slide.content` storage model.
 */
import { t } from '../../../lib/ui-i18n.js';
import { createQuickModal } from '../../../lib/modal.js';

/**
 * @typedef {Object} PickedImage  Normalized, provider-agnostic pick.
 * @property {string} url                       Required image URL.
 * @property {string} [alt]                     Single alt seed (provider had no per-language map).
 * @property {Object<string,string>} [alts]     Per-language alt map (e.g. { nl, 'en-GB' }).
 * @property {string} [caption]                 Resolved caption/credit string, if any.
 * @property {string[]} [tags]                  Free-form tags.
 * @property {string} [providerId]              Opaque provider file id (e.g. ImageKit fileId).
 * @property {Object} [meta]                    Provider extras (photographer, source, …).
 */

/**
 * @typedef {Object} PickerOpts
 * @property {(picked: PickedImage) => void} onPick   Required; receives the normalized pick.
 * @property {string} [title]
 * @property {Object} [context]              Slide context forwarded to the underlying picker.
 * @property {string} [docId]               Presentation id (ImageKit tagging context).
 * @property {boolean} [allowCaptionCredit] Enable the library's "add photo credit" affordance.
 */

/**
 * @typedef {Object} PickerProvider
 * @property {string} id
 * @property {string} label                 Human label shown in the source chooser.
 * @property {(opts: PickerOpts) => void} open
 */

/**
 * Adapter: native image library (local/Scaleway upload + Unsplash/Giphy).
 * @param {Function} openLibraryRaw - bound `openImageLibraryPicker`
 * @returns {PickerProvider}
 */
function libraryProvider(openLibraryRaw) {
  return {
    id: 'local-library',
    label: t('editor.image.source.library', 'Image library'),
    open(opts) {
      openLibraryRaw({
        title: opts.title,
        allowCaptionCredit: !!opts.allowCaptionCredit,
        context: opts.context,
        onPick: (it, { applyCaptionCredit } = {}) => {
          const url = typeof it?.url === 'string' ? it.url.trim() : '';
          if (!url) return;
          const photographer =
            typeof it?.photographer === 'string' ? it.photographer.trim() : '';
          opts.onPick?.({
            url,
            alts: it?.alts && typeof it.alts === 'object' ? it.alts : undefined,
            tags: Array.isArray(it?.tags) ? it.tags : undefined,
            caption:
              applyCaptionCredit && photographer
                ? `${t('editor.image.photoCreditPrefix', 'Photo:')} ${photographer}`
                : undefined,
            meta: {
              photographer: photographer || undefined,
              source: it?.source,
              sourceUrl: it?.sourceUrl,
              id: it?.id,
              description: it?.description,
            },
          });
        },
      });
    },
  };
}

/**
 * Adapter: ImageKit DAM picker.
 * @param {Function} openImageKitRaw - bound `openImageKitPicker`
 * @returns {PickerProvider}
 */
function imagekitProvider(openImageKitRaw) {
  return {
    id: 'imagekit',
    label: t('editor.image.source.imagekit', 'ImageKit'),
    open(opts) {
      openImageKitRaw({
        title: opts.title,
        docId: opts.docId,
        context: opts.context,
        onPick: (picked) => {
          const url = typeof picked?.url === 'string' ? picked.url.trim() : '';
          if (!url) return;
          opts.onPick?.({
            url,
            alt: typeof picked?.altSeed === 'string' ? picked.altSeed : undefined,
            tags: Array.isArray(picked?.tags) ? picked.tags : undefined,
            providerId: picked?.fileId || undefined,
          });
        },
      });
    },
  };
}

/**
 * Lightweight modal asking the user which source to pick from, shown only when
 * more than one provider is enabled.
 * @param {Object} args
 * @param {Function} args.h
 * @param {HTMLElement} args.root
 * @param {PickerProvider[]} args.providers
 * @param {(p: PickerProvider) => void} args.onChoose
 */
function openSourceChooser({ h, root, providers, onChoose }) {
  const modal = createQuickModal({
    h,
    root: root || document.body,
    title: t('editor.image.source.title', 'Choose image source'),
    className: 'image-source-chooser',
  });

  const list = h('div', { class: 'stack image-source-list' });
  for (const p of providers) {
    list.append(
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: p.label,
        onclick: () => {
          modal.close();
          onChoose(p);
        },
      })
    );
  }
  modal.append(list);
  list.querySelector('button')?.focus();
}

/**
 * Build the single `openImagePicker` seam from the available raw openers.
 *
 * Enablement mirrors the historical per-call-site gating so no deployment loses
 * a source it had before:
 * - the native library is enabled unless `features.disableImageLibrary`
 *   (which `IMAGEKIT_ONLY` already forces);
 * - ImageKit is enabled whenever its raw opener is provided.
 *
 * @param {Object} args
 * @param {Function} args.h
 * @param {HTMLElement} args.root
 * @param {Object} [args.features]
 * @param {Function} [args.openImageLibrary] - bound `openImageLibraryPicker`
 * @param {Function} [args.openImageKit]     - bound `openImageKitPicker`
 * @returns {((opts: PickerOpts) => void) & { providers: PickerProvider[] }}
 */
export function createImagePickerSeam({
  h,
  root,
  features = {},
  openImageLibrary,
  openImageKit,
} = {}) {
  const flags = features && typeof features === 'object' ? features : {};
  const providers = [];
  if (!flags.disableImageLibrary && typeof openImageLibrary === 'function') {
    providers.push(libraryProvider(openImageLibrary));
  }
  if (typeof openImageKit === 'function') {
    providers.push(imagekitProvider(openImageKit));
  }

  /** @param {PickerOpts} opts */
  function openImagePicker(opts = {}) {
    if (!providers.length) return;
    if (providers.length === 1) {
      providers[0].open(opts);
      return;
    }
    openSourceChooser({ h, root, providers, onChoose: (p) => p.open(opts) });
  }

  openImagePicker.providers = providers;
  return openImagePicker;
}
