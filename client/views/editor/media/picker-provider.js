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
 * one it opens directly; with more than one it shows a source chooser first,
 * one card per provider with its label and description, the primary source on
 * top. A fork swaps the provider table once (register ImageKit, disable the
 * library), sets a provider's `label`/`description`/`primary` on
 * `openImagePicker.providers`, and inherits every current and future call
 * site without touching the chooser.
 *
 * The normalization also unifies the historical pick shapes (native library
 * item, ImageKit pick, Beeldbank pick) into one contract; `apply-pick.js`
 * flattens it onto the (unchanged) flat `slide.content` storage model.
 */
import { t } from '../../../lib/ui-i18n.js';
import { createQuickModal } from '../../../lib/dom/modal.js';
import { h } from '../../../lib/dom.js';

/**
 * @typedef {Object} PickedImage  Normalized, provider-agnostic pick.
 * @property {string} url                       Required image URL.
 * @property {string} [alt]                     Single alt seed (provider had no per-language map).
 * @property {Object<string,string>} [alts]     Alt text keyed by deck language.
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
 * @property {string} [hint]                One line under the chooser's title saying what the
 *                                          image is for; only shown when there is a chooser.
 */

/**
 * @typedef {Object} PickerProvider
 * @property {string} id
 * @property {string} label                 Human label shown in the source chooser.
 * @property {string} [description]         One line under the label: what this source holds.
 * @property {boolean} [primary]            The source the deployment means as *the* source:
 *                                          listed first, drawn as primary, focused. At most one.
 * @property {(opts: PickerOpts) => void} open
 */

/**
 * Adapter: native image library (local/S3 upload + Unsplash/Giphy).
 * @param {Function} openLibraryRaw - bound `openImageLibraryPicker`
 * @returns {PickerProvider}
 */
function libraryProvider(openLibraryRaw) {
  return {
    id: 'local-library',
    label: t('editor.image.source.library', 'Image library'),
    description: t(
      'editor.image.source.library.description',
      'Uploaded images and stock photos',
    ),
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
                ? t('editor.image.photoCredit', 'Photo: {photographer}', {
                    photographer,
                  })
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
 * Adapter: bundled gradient library (static assets shipped with the app).
 * @param {Function} openBundledRaw - bound `openBundledGradientPicker`
 * @returns {PickerProvider}
 */
function bundledGradientsProvider(openBundledRaw) {
  return {
    id: 'bundled',
    label: t('editor.image.source.bundled', 'Gradients'),
    description: t(
      'editor.image.source.bundled.description',
      'Gradients that come with the app',
    ),
    open(opts) {
      // Deliberately not forwarding `opts.title`: call sites name the *field*
      // ("Library: choose an image"), which is the wrong heading once the user
      // has already chosen a source. The picker's own title names the source.
      openBundledRaw({
        // Already normalized at the source: the manifest is ours, so the
        // adapter has nothing to reshape.
        onPick: (picked) => opts.onPick?.(picked),
      });
    },
  };
}

/**
 * Adapter: ImageKit DAM picker.
 *
 * Copy into own media before notifying the caller. Refusals propagate to the
 * picker so it can keep the dialog open without mutating the slide.
 *
 * @param {Function} openImageKitRaw - bound `openImageKitPicker`
 * @param {((pick: {fileId: string, url: string}) => Promise<{url: string}>)} [importToOwnMedia]
 * @returns {PickerProvider}
 */
function imagekitProvider(openImageKitRaw, importToOwnMedia) {
  const canCopy = typeof importToOwnMedia === 'function';
  const unavailableMessage = canCopy
    ? ''
    : t(
        'editor.image.imagekit.noCopyNote',
        'This image cannot be used because copying it into your own media requires image uploads to be enabled.',
      );
  return {
    id: 'imagekit',
    label: t('editor.image.source.imagekit', 'ImageKit'),
    description: t(
      'editor.image.source.imagekit.description',
      "Your organisation's photo archive",
    ),
    // A deployment that connects a DAM means it as the source; the provider
    // only exists once ImageKit is configured.
    primary: true,
    open(opts) {
      openImageKitRaw({
        title: opts.title,
        docId: opts.docId,
        context: opts.context,
        note: unavailableMessage,
        onPick: async (picked) => {
          const url = typeof picked?.url === 'string' ? picked.url.trim() : '';
          if (!url) return;
          const fileId = picked?.fileId || undefined;

          if (!canCopy) throw new Error(unavailableMessage);
          const stored = await importToOwnMedia({ fileId, url });
          const copied =
            typeof stored?.url === 'string' ? stored.url.trim() : '';
          if (!copied) {
            throw new Error(
              t(
                'editor.image.imagekit.copyFailed',
                'Copying this image into your own media did not return a URL.',
              ),
            );
          }

          opts.onPick?.({
            url: copied,
            alt:
              typeof picked?.altSeed === 'string' ? picked.altSeed : undefined,
            tags: Array.isArray(picked?.tags) ? picked.tags : undefined,
            providerId: fileId,
          });
        },
      });
    },
  };
}

/**
 * Put the primary provider first, keeping the declared order otherwise. Runs
 * on the live table each time the picker opens, so a fork that sets `primary`
 * after the seam is built gets its order without patching anything.
 *
 * @param {PickerProvider[]} providers - sorted in place
 * @returns {PickerProvider[]} the same array
 * @throws {Error} when more than one provider declares `primary`
 */
function orderProviders(providers) {
  const primaries = providers.filter((p) => p.primary === true);
  if (primaries.length > 1) {
    throw new Error(
      `image picker: at most one primary source, got ${primaries.map((p) => p.id).join(', ')}`,
    );
  }
  // Array.prototype.sort is stable, so the other sources keep their order.
  return providers.sort(
    (a, b) => Number(b.primary === true) - Number(a.primary === true),
  );
}

/**
 * The modal asking which source to pick from, shown only when more than one
 * provider is enabled: one card per source (label + description), the primary
 * one drawn as primary and focused.
 * @param {Object} args
 * @param {HTMLElement} args.root
 * @param {PickerProvider[]} args.providers - already ordered
 * @param {string} [args.hint]
 * @param {(p: PickerProvider) => void} args.onChoose
 */
function openSourceChooser({ root, providers, hint, onChoose }) {
  const modal = createQuickModal({
    root: root || document.body,
    title: t('editor.image.source.title', 'Choose image source'),
    className: 'image-source-chooser',
  });

  if (hint) {
    modal.append(h('p', { class: 'help image-source-hint', text: hint }));
  }

  const list = h('div', { class: 'stack image-source-list' });
  for (const p of providers) {
    list.append(
      h(
        'button',
        {
          class: `btn ${p.primary ? 'btn-primary' : 'btn-secondary'} image-source-card`,
          type: 'button',
          'data-source-id': p.id,
          onclick: () => {
            modal.close();
            onChoose(p);
          },
        },
        [
          h('span', { class: 'image-source-card-label', text: p.label }),
          p.description
            ? h('span', {
                class: 'image-source-card-description',
                text: p.description,
              })
            : null,
        ],
      ),
    );
  }
  modal.append(list);
  // The overlay's focus trap focuses the first focusable (the close button)
  // in a frame of its own; the top card claims focus after it.
  const first = list.querySelector('button');
  requestAnimationFrame(() => first?.focus());
}

/**
 * Build the single `openImagePicker` seam from the available raw openers.
 *
 * Enablement mirrors the historical per-call-site gating so no deployment loses
 * a source it had before:
 * - the native library is enabled when `features.enableImageLibrary`
 *   (which `IMAGEKIT_ONLY` already forces);
 * - the bundled gradients are enabled whenever their raw opener is provided
 *   (the caller resolves the `stockMedia.bundled.enabled` toggle);
 * - ImageKit is enabled whenever its raw opener is provided, and is primary.
 *
 * `providers` is the live table: its order is the chooser's order, with the
 * primary source first.
 *
 * @param {Object} args
 * @param {HTMLElement} args.root
 * @param {Object} [args.features]
 * @param {Function} [args.openImageLibrary]     - bound `openImageLibraryPicker`
 * @param {Function} [args.openBundledGradients] - bound `openBundledGradientPicker`
 * @param {Function} [args.openImageKit]         - bound `openImageKitPicker`
 * @param {Function} [args.importImageKitToOwnMedia] - copies a picked ImageKit
 *   asset into own media; absent when this deployment has no own media.
 * @returns {((opts: PickerOpts) => void) & { providers: PickerProvider[] }}
 */
export function createImagePickerSeam({
  root,
  features = {},
  openImageLibrary,
  openBundledGradients,
  openImageKit,
  importImageKitToOwnMedia,
} = {}) {
  const flags = features && typeof features === 'object' ? features : {};
  const providers = [];
  if (flags.enableImageLibrary && typeof openImageLibrary === 'function') {
    providers.push(libraryProvider(openImageLibrary));
  }
  if (typeof openBundledGradients === 'function') {
    providers.push(bundledGradientsProvider(openBundledGradients));
  }
  if (typeof openImageKit === 'function') {
    providers.push(imagekitProvider(openImageKit, importImageKitToOwnMedia));
  }
  orderProviders(providers);

  /** @param {PickerOpts} opts */
  function openImagePicker(opts = {}) {
    if (!providers.length) return;
    if (providers.length === 1) {
      providers[0].open(opts);
      return;
    }
    openSourceChooser({
      root,
      providers: orderProviders(providers),
      hint: opts.hint,
      onChoose: (p) => p.open(opts),
    });
  }

  openImagePicker.providers = providers;
  return openImagePicker;
}
