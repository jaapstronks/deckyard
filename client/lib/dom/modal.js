import { t } from '../ui-i18n.js';
import { h, createFocusTrap } from '../dom.js';
import { icon } from './icons.js';
export { createBusyManager } from './busy.js';

/**
 * Marks a backdrop as an open overlay. Escape belongs to the overlay on top,
 * and topness is read straight off the DOM: overlays mount in open order, so
 * the last marked backdrop in document order is the one on top.
 *
 * This marker survived A7.33 PR 4 rather than being absorbed into the closer
 * register below, because the two answer different questions. Topness is an
 * *ordering* question and the DOM already holds the order; the register is an
 * unordered Set and could not answer it without becoming a stack that has to
 * stay in sync with mount order. Keeping the marker leaves the register with
 * exactly one job — close everything open in this document — and leaves Escape
 * with no state of its own at all.
 */
const OPEN_OVERLAY_ATTR = 'data-overlay-open';

/**
 * Every open overlay's `close`, keyed by the document it is mounted in.
 *
 * A view tears down by closing whatever it left open (`closeAllOverlays`), and
 * until A7.33 PR 4 the Set for that travelled from the view root down to every
 * modal call site as an optional 4th positional argument — ~200 pass-through
 * lines across 55 files, where forgetting one silently dropped that overlay out
 * of close-all. Registration now happens inside `createOverlay`, where it
 * cannot be forgotten, and no caller passes anything.
 *
 * Keyed on `Document`, not a bare module singleton: the presenter's projector
 * runs in a second window with its own document, and a jsdom test builds one
 * document per case. `WeakMap` so a discarded document takes its Set with it
 * (D44, docs/plans/briefs/ambient-parameter-threading.md).
 *
 * @type {WeakMap<Document, Set<Function>>}
 */
const overlayClosersByDocument = new WeakMap();

/**
 * Registers an overlay's close function against its document.
 *
 * Call this with an element that is already mounted — `ownerDocument` is the
 * key, and appending into another document adopts the node, so registering
 * before the append would file it under the wrong document.
 *
 * @param {HTMLElement} el - A mounted element belonging to the overlay
 * @param {Function} close - The overlay's close function
 * @returns {Function} Unregister; safe to call more than once
 */
export function registerOverlayCloser(el, close) {
  const doc = el?.ownerDocument;
  if (!doc || typeof close !== 'function') return () => {};
  let closers = overlayClosersByDocument.get(doc);
  if (!closers) {
    closers = new Set();
    overlayClosersByDocument.set(doc, closers);
  }
  closers.add(close);
  return () => closers.delete(close);
}

/**
 * Closes every overlay currently open in `doc`.
 *
 * The teardown path of a view: whatever it left open goes with it. Each
 * `close` deregisters itself, so the Set empties as it drains; the explicit
 * clear at the end covers a closer that threw before reaching its `finally`.
 *
 * @param {Document} [doc=document] - Document whose overlays should close
 */
export function closeAllOverlays(doc = document) {
  const closers = overlayClosersByDocument.get(doc);
  if (!closers) return;
  for (const close of Array.from(closers)) {
    try {
      close();
    } catch {
      // One overlay's failure must not strand the ones behind it.
    }
  }
  closers.clear();
}

/**
 * Whether `backdrop` is the topmost open overlay in its document.
 * A hidden backdrop (see `hide()`) has stepped aside and is skipped.
 * @param {HTMLElement} backdrop - The overlay backdrop element
 * @returns {boolean}
 */
function isTopmostOverlay(backdrop) {
  if (backdrop.style.display === 'none') return false;
  const doc = backdrop.ownerDocument;
  if (!doc) return true;
  const open = doc.querySelectorAll(`[${OPEN_OVERLAY_ATTR}]`);
  for (let i = open.length - 1; i >= 0; i--) {
    if (open[i].style.display === 'none') continue;
    return open[i] === backdrop;
  }
  return true;
}

/**
 * Creates a bare modal overlay: all behaviour, no imposed chrome.
 *
 * This is the behaviour layer under `createModal` (A7.16 cluster 1). It owns
 * the backdrop element, focus trap, Escape handling, `role`/`aria-modal` on
 * the surface, focus restore, busy/dirty close guarding, and overlay-closers
 * registration. What goes *inside* the overlay — header, title, close button,
 * content — is entirely the caller's (or `createModal`'s) business.
 *
 * Use this directly only for chrome-less overlays (lightbox, peek); dialogs
 * with a title/close affordance go through `createModal`.
 *
 * @param {Object} options - Overlay options
 * @param {string} [options.backdropClass='modal-backdrop'] - Backdrop CSS class
 * @param {HTMLElement} [options.surface] - Dialog surface element; appended to
 *   the backdrop on show. Gets `role="dialog"` and `aria-modal="true"` unless
 *   it already carries those attributes, and hosts the focus trap. Without a
 *   surface the trap covers the backdrop itself.
 * @param {boolean} [options.closeOnBackdrop=true] - Close when clicking backdrop
 * @param {boolean} [options.closeOnEscape=true] - Close on Escape key. Only the
 *   topmost open overlay reacts, so Escape peels one layer at a time.
 * @param {Function} [options.onClose] - Callback when overlay closes
 * @param {Function} [options.isDirty] - Function returning true if the overlay has unsaved changes
 * @param {string} [options.confirmMessage] - Confirmation message for dirty close
 * @returns {Object} Overlay API object
 */
export function createOverlay(options = {}) {
  const {
    backdropClass = 'modal-backdrop',
    surface = null,
    closeOnBackdrop = true,
    closeOnEscape = true,
    onClose,
    isDirty,
    confirmMessage,
  } = options;

  const backdrop = h('div', { class: backdropClass });

  // Deregisters this overlay from its document's closer set; set on show.
  let unregisterCloser = null;
  let open = false;
  let busy = false;
  let confirmingClose = false;
  let detachFocusTrap = null;
  let previousActiveElement = null;

  const onKey = (e) => {
    if (!closeOnEscape || e.key !== 'Escape' || busy) return;
    // Stacked overlays all listen on `document`; only the top one may close.
    if (!isTopmostOverlay(backdrop)) return;
    requestClose();
  };

  /**
   * Close the overlay and clean up (bypasses dirty check)
   * @param {Object} [result] - Optional result to pass to onClose
   */
  function close(result) {
    if (!open) return;
    open = false;
    try {
      detachFocusTrap?.();
      detachFocusTrap = null;
      document.removeEventListener('keydown', onKey);
      backdrop.removeAttribute(OPEN_OVERLAY_ATTR);
      backdrop.remove();
      // Restore focus to previously focused element
      try {
        previousActiveElement?.focus?.();
      } catch {
        // ignore
      }
      previousActiveElement = null;
    } finally {
      unregisterCloser?.();
      unregisterCloser = null;
      onClose?.(result);
    }
  }

  /**
   * Request to close the overlay (respects busy state and dirty check).
   * When the overlay is dirty, an accessible confirm dialog is shown; this is
   * async, and the reentrancy guard stops the still-attached Escape handler
   * from stacking a second confirm on top of the first.
   * @param {Object} [result] - Optional result to pass to onClose
   */
  async function requestClose(result) {
    if (busy || confirmingClose) return;
    if (isDirty?.() && confirmMessage) {
      confirmingClose = true;
      let ok;
      try {
        ok = await confirmModal(document.body, {
          title: t('common.unsavedChanges', 'Unsaved changes'),
          message: confirmMessage,
          confirmLabel: t('common.discardChanges', 'Discard changes'),
          cancelLabel: t('common.keepEditing', 'Keep editing'),
          danger: true,
        });
      } finally {
        confirmingClose = false;
      }
      if (!ok) return;
    }
    close(result);
  }

  /**
   * Set busy state (prevents close)
   * @param {boolean} value - Whether the overlay is busy
   */
  function setBusy(value) {
    busy = !!value;
  }

  /**
   * Get busy state
   * @returns {boolean}
   */
  function isBusy() {
    return busy;
  }

  /**
   * Whether the overlay is currently shown
   * @returns {boolean}
   */
  function isOpen() {
    return open;
  }

  if (closeOnBackdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) requestClose();
    });
  }

  /**
   * Show the overlay
   * @param {HTMLElement} root - Element to append the overlay to
   */
  function show(root) {
    if (open) return;
    open = true;

    // Save currently focused element to restore later
    previousActiveElement = document.activeElement;

    if (surface) {
      // Idempotent aria defaults: a surface built with its own role/aria
      // (createModal's dialog) keeps its attributes byte-for-byte.
      if (!surface.hasAttribute('role')) surface.setAttribute('role', 'dialog');
      if (!surface.hasAttribute('aria-modal'))
        surface.setAttribute('aria-modal', 'true');
      if (surface.parentNode !== backdrop) backdrop.append(surface);
    }
    backdrop.setAttribute(OPEN_OVERLAY_ATTR, '');
    root.append(backdrop);

    // After the append: the backdrop's `ownerDocument` is the register's key,
    // and appending into another document adopts the node.
    unregisterCloser = registerOverlayCloser(backdrop, close);
    document.addEventListener('keydown', onKey);

    // Activate focus trap
    detachFocusTrap = createFocusTrap(surface || backdrop);
  }

  /**
   * Hide the backdrop (useful when showing loading modal)
   */
  function hide() {
    backdrop.style.display = 'none';
  }

  /**
   * Unhide the backdrop
   */
  function unhide() {
    backdrop.style.display = '';
  }

  return {
    backdrop,
    surface,
    show,
    close,
    requestClose,
    setBusy,
    isBusy,
    isOpen,
    hide,
    unhide,
  };
}

/**
 * Creates a modal dialog with standard structure and lifecycle management.
 *
 * Built on `createOverlay` (which owns backdrop, focus trap, Escape, aria,
 * focus restore and closers); this layer adds the dialog chrome: header with
 * title and close button, optional hint, and the content area.
 *
 * @param {Object} options - Modal options
 * @param {string} options.title - Modal title text
 * @param {string} [options.hint] - Optional hint text below title
 * @param {string} [options.modalClass] - Additional CSS class for the modal
 * @param {true|false|HTMLElement} [options.header=true] - `true` builds the
 *   standard header (title + close button); `false` renders no header (the
 *   title, when given, becomes the dialog's `aria-label`); an element is used
 *   as a caller-supplied header row (close wiring is the caller's, via
 *   `requestClose`).
 * @param {'text'|'icon'|false} [options.closeButton='text'] - Close affordance
 *   in the built header: the standard text button, an icon-X, or none.
 * @param {string} [options.closeLabel] - Custom close button label (the
 *   `aria-label` for the icon variant)
 * @param {boolean} [options.closeOnBackdrop=true] - Close when clicking backdrop
 * @param {boolean} [options.closeOnEscape=true] - Close on Escape key (topmost
 *   overlay only)
 * @param {Function} [options.onClose] - Callback when modal closes
 * @param {Function} [options.isDirty] - Function returning true if modal has unsaved changes
 * @param {string} [options.confirmMessage] - Confirmation message for dirty close
 * @returns {Object} Modal API object
 */
export function createModal(options = {}) {
  const {
    title: titleText,
    hint: hintText,
    modalClass,
    header: headerOption = true,
    closeButton = 'text',
    closeLabel = t('common.close', 'Close'),
    closeOnBackdrop = true,
    closeOnEscape = true,
    onClose,
    isDirty,
    confirmMessage,
  } = options;

  const modalClasses = ['modal', modalClass].filter(Boolean).join(' ');
  const modalId = `modal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const builtHeader = headerOption === true;
  const modalAttrs = {
    class: modalClasses,
    role: 'dialog',
    'aria-modal': 'true',
  };
  if (builtHeader) {
    modalAttrs['aria-labelledby'] = `${modalId}-title`;
  } else if (titleText) {
    // No title element to point aria-labelledby at, so label directly.
    modalAttrs['aria-label'] = titleText;
  }
  const modal = h('div', modalAttrs);

  const overlay = createOverlay({
    surface: modal,
    closeOnBackdrop,
    closeOnEscape,
    onClose,
    isDirty,
    confirmMessage,
  });
  const { backdrop, close, requestClose, setBusy, isBusy, hide, unhide } =
    overlay;

  // Header with title and close button
  let header = null;
  let title = null;
  let closeBtn = null;
  if (builtHeader) {
    header = h('div', { class: 'row spread' });
    title = h('h2', { id: `${modalId}-title`, text: titleText || '' });
    if (closeButton === 'icon') {
      closeBtn = h(
        'button',
        {
          class: 'btn btn-secondary btn-icon ps-modal-close',
          type: 'button',
          'aria-label': closeLabel,
          // Same guarded path as Esc/backdrop: respects busy and the dirty check.
          onclick: () => requestClose(),
        },
        [icon('x', { size: 16 })],
      );
    } else if (closeButton !== false) {
      closeBtn = h('button', {
        class: 'btn btn-secondary',
        text: closeLabel,
        // Same guarded path as Esc/backdrop: respects busy and the dirty check.
        onclick: () => requestClose(),
      });
    }
    header.append(...[title, closeBtn].filter(Boolean));
  } else if (headerOption) {
    header = headerOption;
  }

  // Optional hint
  let hint = null;
  if (hintText) {
    hint = h('div', { class: 'help modal-hint', text: hintText });
  }

  // Content area for custom content
  const content = h('div', { class: 'modal-content' });

  /**
   * Show the modal
   * @param {HTMLElement} root - Element to append modal to
   */
  function show(root) {
    if (overlay.isOpen()) return;

    // Build modal structure
    modal.innerHTML = '';
    if (header) modal.append(header);
    if (hint) modal.append(hint);
    modal.append(content);

    overlay.show(root);
  }

  /**
   * Update the title text
   * @param {string} text - New title text
   */
  function setTitle(text) {
    if (title) {
      title.textContent = text || '';
    } else {
      modal.setAttribute('aria-label', text || '');
    }
  }

  /**
   * Update the hint text
   * @param {string} text - New hint text
   */
  function setHint(text) {
    if (!hint) {
      hint = h('div', { class: 'help modal-hint', text: text || '' });
      // Insert before the content area if the modal is already built
      if (content.parentNode === modal) {
        content.before(hint);
      }
    } else {
      hint.textContent = text || '';
    }
  }

  /**
   * Append elements to modal content area
   * @param {...HTMLElement} elements - Elements to append
   */
  function append(...elements) {
    content.append(...elements);
  }

  return {
    backdrop,
    modal,
    header,
    title,
    closeBtn,
    hint,
    content,
    close,
    requestClose,
    show,
    setTitle,
    setHint,
    setBusy,
    isBusy,
    hide,
    unhide,
    append,
  };
}

/**
 * Creates and immediately shows a simple modal.
 * Shorthand for createModal + show.
 *
 * @param {HTMLElement} root - Element to append modal to
 * @param {Object} options - Modal options (see createModal)
 * @returns {Object} Modal API object
 */
export function openModal(root, options = {}) {
  const modalApi = createModal(options);
  modalApi.show(root);
  return modalApi;
}

/**
 * Creates a confirmation modal with Cancel/Confirm buttons.
 *
 * @param {HTMLElement} root - Element to append modal to
 * @param {Object} options - Modal options
 * @param {string} options.title - Modal title
 * @param {string} options.message - Confirmation message
 * @param {string} [options.confirmLabel] - Confirm button label
 * @param {string} [options.cancelLabel] - Cancel button label
 * @param {boolean} [options.danger=false] - Use danger styling for confirm
 * @returns {Promise<boolean>} Resolves true if confirmed, false if cancelled
 */
export function confirmModal(root, options = {}) {
  const {
    title: titleText,
    message,
    confirmLabel = t('common.confirm', 'Confirm'),
    cancelLabel = t('common.cancel', 'Cancel'),
    danger = false,
  } = options;

  return new Promise((resolve) => {
    const modalApi = createModal({
      title: titleText,
      closeOnBackdrop: false,
      onClose: (result) => resolve(result?.confirmed === true),
    });

    const messageEl = h('div', { class: 'help', text: message || '' });

    const actions = h('div', { class: 'row is-end is-mt-8 modal-actions' });
    const btnCancel = h('button', {
      class: 'btn btn-secondary',
      text: cancelLabel,
      onclick: () => modalApi.close({ confirmed: false }),
    });
    const btnConfirm = h('button', {
      class: danger ? 'btn btn-danger' : 'btn btn-primary',
      text: confirmLabel,
      onclick: () => modalApi.close({ confirmed: true }),
    });
    actions.append(btnCancel, btnConfirm);

    modalApi.content.append(messageEl, actions);
    modalApi.show(root);
  });
}

/**
 * Creates a text-prompt modal with a labelled input and Cancel/Confirm buttons.
 * Accessible replacement for the native `prompt()`.
 *
 * @param {HTMLElement} root - Element to append modal to
 * @param {Object} options - Modal options
 * @param {string} options.title - Modal title
 * @param {string} [options.message] - Help text shown above the input
 * @param {string} [options.value] - Initial input value
 * @param {string} [options.placeholder] - Input placeholder
 * @param {string} [options.confirmLabel] - Confirm button label
 * @param {string} [options.cancelLabel] - Cancel button label
 * @param {Function} [options.validate] - Validation fn (value) => errorMessage|null
 * @returns {Promise<string|null>} Resolves to the entered value, or null if cancelled
 */
export function promptModal(root, options = {}) {
  const {
    title: titleText,
    message,
    value = '',
    placeholder = '',
    confirmLabel = t('common.ok', 'OK'),
    cancelLabel = t('common.cancel', 'Cancel'),
    validate,
  } = options;

  return new Promise((resolve) => {
    const modalApi = createModal({
      title: titleText,
      closeOnBackdrop: false,
      onClose: (result) =>
        resolve(typeof result?.value === 'string' ? result.value : null),
    });

    const field = createTextInput({ value, placeholder, validate });

    const submit = () => {
      if (typeof field.validate === 'function' && !field.validate()) return;
      modalApi.close({ value: field.getValue() });
    };
    field.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    const actions = h('div', { class: 'row is-end is-mt-8 modal-actions' });
    const btnCancel = h('button', {
      class: 'btn btn-secondary',
      text: cancelLabel,
      onclick: () => modalApi.close(),
    });
    const btnConfirm = h('button', {
      class: 'btn btn-primary',
      text: confirmLabel,
      onclick: submit,
    });
    actions.append(btnCancel, btnConfirm);

    const children = [];
    if (message) children.push(h('div', { class: 'help', text: message }));
    children.push(field.wrap, actions);
    modalApi.content.append(...children);
    modalApi.show(root);
    // The field carries an `autofocus` attribute, but that only applies to
    // markup present at page load, so the prompt opened with focus on its
    // first focusable element — the Cancel button. Typing went nowhere and
    // Enter cancelled the dialog.
    //
    // The focus trap claims focus in a requestAnimationFrame of its own
    // (createFocusTrap), so this has to be queued after it: same frame,
    // registered later, therefore last writer wins.
    requestAnimationFrame(() => field.focus());
  });
}

/**
 * Creates a modal that returns a Promise, resolving when closed.
 * Useful for modals that need to return data.
 *
 * @param {Object} options - Modal options (see createModal)
 * @returns {Object} Modal API with additional `promise` property
 */
export function createPromiseModal(options = {}) {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });

  const originalOnClose = options.onClose;
  const modalApi = createModal({
    ...options,
    onClose: (result) => {
      originalOnClose?.(result);
      resolvePromise(result);
    },
  });

  return {
    ...modalApi,
    promise,
  };
}

/**
 * Creates a modal and immediately shows it.
 * Compatibility wrapper for the old create-modal.js API.
 *
 * @param {Object} options - Modal options with root included
 * @param {HTMLElement} options.root - Root element to append modal to
 * @param {string} [options.title] - Modal title
 * @param {string} [options.className] - Additional CSS class (maps to modalClass)
 * @param {boolean} [options.closeOnBackdrop=true] - Close when clicking backdrop
 * @param {boolean} [options.closeOnEscape=true] - Close on Escape key
 * @param {Function} [options.onClose] - Callback when modal closes
 * @param {Function} [options.isDirty] - Function returning true if modal has unsaved changes
 * @param {string} [options.confirmMessage] - Confirmation message for dirty close
 * @returns {Object} Modal API object (already shown)
 */
export function createQuickModal({
  root,
  title,
  className,
  closeOnBackdrop = true,
  closeOnEscape = true,
  onClose,
  isDirty,
  confirmMessage,
} = {}) {
  const modalApi = createModal({
    title,
    modalClass: className,
    closeOnBackdrop,
    closeOnEscape,
    onClose,
    isDirty,
    confirmMessage,
  });
  modalApi.show(root);
  return modalApi;
}

/**
 * Create action buttons for modal footer
 *
 * @param {Object} options - Button options
 * @param {Function} [options.onCancel] - Cancel button handler
 * @param {Function} [options.onAction] - Primary action handler
 * @param {string} [options.cancelText] - Cancel button text
 * @param {string} [options.actionText] - Action button text
 * @returns {Object} { wrap, cancel, action, setActionText, setDisabled }
 */
export function createModalActions({
  onCancel,
  onAction,
  cancelText = t('common.cancel', 'Cancel'),
  actionText = t('common.create', 'Create'),
} = {}) {
  const wrap = h('div', { class: 'row is-end modal-actions' });

  const cancel = h('button', {
    class: 'btn btn-secondary',
    text: cancelText,
    onclick: onCancel,
  });

  const action = h('button', {
    class: 'btn btn-primary',
    text: actionText,
    onclick: onAction,
  });

  wrap.append(cancel, action);

  return {
    wrap,
    cancel,
    action,
    setActionText: (text) => {
      action.textContent = text;
    },
    setDisabled: (disabled) => {
      cancel.disabled = disabled;
      action.disabled = disabled;
    },
  };
}

// createBusyManager now lives in ./busy.js (single implementation). Re-exported
// below so existing `import { createBusyManager } from '.../modal.js'` keeps working.

/**
 * Internal helper to create a form element (input or textarea) with validation.
 * Extracts shared logic between createTextInput and createTextArea.
 */
function createFormElement(
  elementType,
  elementAttrs,
  wrapperClass,
  { validate, onChange } = {},
) {
  const el = h(elementType, elementAttrs);
  const status = h('div', { class: 'help modal-status', text: '' });

  const doValidate = () => {
    const v = String(el.value || '').trim();
    const error = validate?.(v);
    status.textContent = error || '';
    return !error;
  };

  el.addEventListener('input', () => {
    doValidate();
    onChange?.(el.value);
  });

  const wrap = h('div', { class: wrapperClass });
  wrap.append(el, status);

  return {
    wrap,
    el,
    status,
    getValue: () => String(el.value || '').trim(),
    setValue: (v) => {
      el.value = v;
      doValidate();
    },
    validate: doValidate,
    focus: () => {
      try {
        el.focus();
        el.select();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Create a text input with validation and status display.
 *
 * @param {Object} options - Input options
 * @param {string} [options.value] - Initial value
 * @param {string} [options.placeholder] - Placeholder text
 * @param {Function} [options.validate] - Validation function (value) => errorMessage|null
 * @param {Function} [options.onChange] - Change handler (value) => void
 * @param {boolean} [options.autoFocus=true] - Auto-focus the input
 * @returns {Object} { wrap, input, status, getValue, validate, focus }
 */
export function createTextInput({
  value = '',
  placeholder = '',
  validate,
  onChange,
  autoFocus = true,
} = {}) {
  const result = createFormElement(
    'input',
    {
      class: 'form-input',
      value,
      placeholder,
      autocomplete: 'off',
      autofocus: autoFocus,
    },
    'modal-text-input',
    { validate, onChange },
  );
  // Alias `el` as `input` — the historical name at these call sites.
  return { ...result, input: result.el };
}

/**
 * Create a textarea with validation and status display.
 *
 * @param {Object} options - Textarea options
 * @param {string} [options.value] - Initial value
 * @param {string} [options.placeholder] - Placeholder text
 * @param {string} [options.minHeight='120px'] - Minimum height
 * @param {Function} [options.validate] - Validation function (value) => errorMessage|null
 * @param {Function} [options.onChange] - Change handler (value) => void
 * @param {boolean} [options.autoFocus=true] - Auto-focus the textarea
 * @returns {Object} { wrap, textarea, status, getValue, validate, focus }
 */
export function createTextArea({
  value = '',
  placeholder = '',
  minHeight = '120px',
  validate,
  onChange,
  autoFocus = true,
} = {}) {
  const result = createFormElement(
    'textarea',
    {
      class: 'form-input',
      style: `min-height:${minHeight};`,
      value,
      placeholder,
      autofocus: autoFocus,
    },
    'modal-textarea',
    { validate, onChange },
  );
  // Alias `el` as `textarea` — the historical name at these call sites.
  return { ...result, textarea: result.el };
}
