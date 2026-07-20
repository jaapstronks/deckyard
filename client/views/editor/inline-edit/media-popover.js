/**
 * Inline media popover for the WYSIWYG editor.
 *
 * Opens next to a clicked item photo (e.g. a team-cards member block) and lets
 * the user set the image, alt text, and any extra per-item fields (a LinkedIn
 * URL) without leaving the slide view. The image button goes through the shared
 * `openImagePicker` seam, so uploads / library browsing / ImageKit / the source
 * chooser behave exactly like the side form — the inline editor can no longer
 * diverge into a native-only path.
 *
 * Positioning: the popover is `position: fixed` and measured against the clicked
 * element's viewport rect, so it stays put even though the slide itself is
 * transform-scaled. Dismiss-on-outside is suppressed while a full modal (the
 * library picker) is open above it, so choosing an image doesn't close it.
 */
import { t } from '../../../lib/ui-i18n.js';
import { installDismissOnOutside } from '../../../lib/dom.js';

/**
 * @param {Object} opts
 * @param {Function} opts.h - DOM helper
 * @param {HTMLElement} opts.host - element to append the popover into
 * @param {HTMLElement} opts.anchorEl - the clicked photo element (positioning)
 * @param {Object} opts.member - the item object to mutate in place
 * @param {Object} opts.slide - the current slide (for picker context)
 * @param {{imageField:string, altField:string, extraFields?:Array, title?:string}} opts.config
 * @param {Function} opts.openImagePicker
 * @param {Object} opts.pres
 * @param {Function} opts.normalizeLang
 * @param {Function} opts.onChange - after a text/url edit: markDirty + save + form sync
 * @param {Function} opts.onVisualChange - after a change with visual effect (image
 *   set/clear, LinkedIn committed): full preview relayout
 * @param {Function} opts.onClose
 * @returns {{ close: Function, reposition: Function }}
 */
export function openMediaPopover({
  h,
  host,
  anchorEl,
  member,
  slide,
  config = {},
  openImagePicker,
  pres,
  normalizeLang,
  onChange,
  onVisualChange,
  onClose,
} = {}) {
  const imageKey = config.imageField || 'image';
  const altKey = config.altField || 'alt';
  const extras = Array.isArray(config.extraFields) ? config.extraFields : [];

  const panel = h('div', {
    class: 'ie-media-popover',
    role: 'dialog',
    'aria-label': config.title || t('editor.inline.media.title', 'Image'),
  });

  // ---- Header ----
  const header = h('div', { class: 'ie-media-header row spread' }, [
    h('div', { class: 'ie-media-title', text: config.title || t('editor.inline.media.title', 'Image') }),
    h('button', {
      class: 'ie-md-close',
      type: 'button',
      title: t('common.close', 'Close'),
      text: '×',
      onclick: () => close(),
    }),
  ]);

  // ---- Image preview + choose / remove ----
  const previewWrap = h('div', { class: 'ie-media-preview' });
  const removeBtn = h('button', {
    class: 'btn btn-danger btn-sm',
    type: 'button',
    text: t('common.delete', 'Delete'),
    onclick: () => {
      member[imageKey] = '';
      refreshImageRow();
      onVisualChange?.();
    },
  });

  function refreshImageRow() {
    const hasImage = !!member[imageKey];
    // Preview and alt describe an image, so they only make sense once there
    // is one. On an empty slot they used to render anyway: an empty grey box
    // and an enabled "describe the image" field for an image that does not
    // exist. Choosing one reveals both.
    previewWrap.replaceChildren(
      hasImage ? h('img', { src: member[imageKey], alt: '', class: 'ie-media-thumb' }) : ''
    );
    previewWrap.style.display = hasImage ? '' : 'none';
    altField.style.display = hasImage ? '' : 'none';
    removeBtn.style.display = hasImage ? '' : 'none';
  }

  const chooseBtn = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    text: t('editor.image.chooseOrUpload', 'Choose / upload…'),
    onclick: () => {
      const activeLang = normalizeLang?.(pres?.i18n?.active) || 'nl';
      openImagePicker?.({
        title: t('editor.image.libraryTitle', 'Images'),
        docId: pres?.id || '',
        context: {
          presentationTitle: typeof pres?.title === 'string' ? pres.title : '',
          slideId: slide?.id || '',
          slideType: slide?.type || '',
          slideTitle:
            slide?.content && typeof slide.content.title === 'string' ? slide.content.title : '',
        },
        onPick: (picked) => {
          member[imageKey] = picked?.url || '';
          // Keep the provider id in lock-step with the URL (see applyPickMeta).
          if (picked?.providerId) member.imagekitFileId = picked.providerId;
          else delete member.imagekitFileId;
          // Seed alt from the pick's active-language metadata (or single seed),
          // but never clobber an alt the user already wrote.
          const alts = picked?.alts && typeof picked.alts === 'object' ? picked.alts : null;
          const seed = (alts ? alts[activeLang] : picked?.alt) || '';
          if (!String(member[altKey] || '').trim() && seed) {
            member[altKey] = seed;
            if (document.activeElement !== altInput) altInput.value = member[altKey];
          }
          refreshImageRow();
          onVisualChange?.();
        },
      });
    },
  });

  const imageRow = h('div', { class: 'row is-wrap ie-media-actions' }, [chooseBtn, removeBtn]);

  // ---- Alt text ----
  const altInput = h('input', {
    type: 'text',
    class: 'form-input',
    maxlength: 180,
    value: member[altKey] || '',
    placeholder: t('editor.inline.media.altPlaceholder', 'Describe the image'),
  });
  altInput.addEventListener('input', () => {
    member[altKey] = altInput.value;
    onChange?.();
  });
  const altField = h('div', { class: 'stack ie-media-field' }, [
    h('label', { class: 'field-label', text: t('editor.inline.media.alt', 'Alt text (optional)') }),
    altInput,
  ]);

  // ---- Extra per-item fields (e.g. LinkedIn URL) ----
  const extraEls = extras.map((f) => {
    const input = h('input', {
      type: f.type === 'url' ? 'url' : 'text',
      class: 'form-input',
      value: member[f.key] || '',
      placeholder: f.placeholder || '',
    });
    input.addEventListener('input', () => {
      member[f.key] = input.value;
      onChange?.();
    });
    // Extra fields (LinkedIn) render as slide content (an icon link), so relayout
    // the preview once the value settles rather than on every keystroke.
    input.addEventListener('change', () => onVisualChange?.());
    return h('div', { class: 'stack ie-media-field' }, [
      h('label', { class: 'field-label', text: t(f.i18nKey, f.label) }),
      input,
    ]);
  });

  panel.append(header, previewWrap, imageRow, altField, ...extraEls);
  refreshImageRow();

  host.append(panel);

  // ---- Positioning ----
  function reposition(newAnchor) {
    const target = newAnchor || anchorEl;
    if (!target || !target.isConnected) return;
    const r = target.getBoundingClientRect();
    const pw = panel.offsetWidth || 260;
    const ph = panel.offsetHeight || 200;
    const margin = 8;
    let left = r.left;
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
    if (left < margin) left = margin;
    let top = r.bottom + margin;
    if (top + ph > window.innerHeight - margin) {
      const above = r.top - ph - margin;
      top = above > margin ? above : Math.max(margin, window.innerHeight - ph - margin);
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }
  reposition();

  const onWinChange = () => reposition();
  window.addEventListener('resize', onWinChange);
  window.addEventListener('scroll', onWinChange, true);

  // Dismiss on outside click / Escape — but stay open while a full modal (the
  // library picker) sits above us, so choosing an image doesn't close the popover.
  const detach = installDismissOnOutside({
    rootEl: panel,
    isOpen: () => !document.querySelector('.modal-backdrop'),
    close: () => close(),
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    detach?.();
    window.removeEventListener('resize', onWinChange);
    window.removeEventListener('scroll', onWinChange, true);
    panel.remove();
    onClose?.();
  }

  // On an empty slot the alt field is hidden, and picking an image is the
  // only thing to do — so focus that instead of an input the user cannot see.
  if (member[imageKey]) altInput.focus();
  else chooseBtn.focus();

  return { close, reposition };
}
