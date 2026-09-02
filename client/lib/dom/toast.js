import { h } from '../dom.js';
import { reportMisuse } from '../util/dev-runtime.js';

const DEFAULT_DURATION_MS = 3200;
const ERROR_DURATION_MS = 5600;
const LEAVE_ANIMATION_MS = 220;
/** Most toasts on screen at once; the oldest is dropped past this. */
const MAX_VISIBLE = 6;

/**
 * The kinds a toast can be — one spelling each. Aliases (`danger`, `fail`,
 * `ok`, `warn`) used to be accepted here while `tests/toast-call-shape.test.js`
 * already forbade the `type:` option that was the only way to reach them: dead
 * tolerance, removed.
 */
const TOAST_TYPES = new Set(['info', 'success', 'warning', 'error']);

/**
 * Which live region announces which kind. Politeness is a property of the
 * kind, not of the call site: a failure interrupts, a confirmation waits.
 */
const POLITENESS = {
  info: 'polite',
  success: 'polite',
  warning: 'assertive',
  error: 'assertive',
};

let stackEl = null;
/** @type {{polite: HTMLElement|null, assertive: HTMLElement|null}} */
const regions = { polite: null, assertive: null };
/** Toasts on screen, oldest first — the cap is chronological, the DOM is not. */
const liveToasts = [];
const byId = new Map();
/** Per-toast timer and interaction bookkeeping. */
const toastState = new WeakMap();

/**
 * Build the stack and its two live regions.
 *
 * Both regions exist before the first toast does. A live region that is
 * created and filled in the same tick is the classic "never announced" case:
 * assistive technology subscribes to an existing region, it does not replay
 * the one that just appeared.
 * @returns {HTMLElement|null} The stack, or null if there is no body yet.
 */
function ensureStack() {
  if (stackEl && document.body && document.body.contains(stackEl)) {
    return stackEl;
  }
  if (!document.body) return null;
  stackEl = h('div', { class: 'toast-stack' });
  // `aria-atomic="false"` is deliberate: `role="status"`/`role="alert"` imply
  // atomic regions, which would re-announce every toast still on screen each
  // time one is added.
  regions.polite = h('div', {
    class: 'toast-region',
    role: 'status',
    'aria-live': 'polite',
    'aria-relevant': 'additions',
    'aria-atomic': 'false',
  });
  regions.assertive = h('div', {
    class: 'toast-region',
    role: 'alert',
    'aria-live': 'assertive',
    'aria-relevant': 'additions',
    'aria-atomic': 'false',
  });
  stackEl.append(regions.polite, regions.assertive);
  document.body.appendChild(stackEl);
  return stackEl;
}

/**
 * The live region a kind belongs in.
 * @param {string} type - A member of TOAST_TYPES.
 * @returns {HTMLElement|null} The region element.
 */
function regionFor(type) {
  ensureStack();
  return POLITENESS[type] === 'assertive' ? regions.assertive : regions.polite;
}

/**
 * Coerce a message to the text a toast shows.
 *
 * A string or an Error are the two supported shapes; the canonical failure
 * form is `catch (e) { toast.error(e, opts) }`, where callers hand over the
 * caught error itself (client/lib/api.js documents the error shape). Anything
 * else is a programming error — this used to `JSON.stringify` it, which is how
 * a DOM element passed to `toast.success` rendered as `{}`.
 * @param {*} v - The message as handed in.
 * @returns {string} Display text.
 */
function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Error) return String(v.message || v);
  reportMisuse(
    `A toast message must be a string or an Error, got ${Object.prototype.toString.call(v)} — ` +
      'pass text (a `t()` call) or the caught error itself. A link or a button ' +
      'belongs in the `action` option, not in the message.',
  );
  return String(v);
}

/**
 * Resolve the kind of a toast.
 * @param {string} [type] - The requested kind.
 * @returns {string} A member of TOAST_TYPES.
 */
function classifyType(type) {
  if (type == null) return 'info';
  const t = String(type);
  if (TOAST_TYPES.has(t)) return t;
  reportMisuse(
    `Unknown toast type ${JSON.stringify(type)} — use one of ` +
      `${[...TOAST_TYPES].join(', ')} via the sugar helpers ` +
      '(toast.info/.success/.warning/.error).',
  );
  return 'info';
}

/**
 * Render a toast's inner content: the message text plus an optional action
 * button. Replaces any prior content so it is safe to call on reused toasts.
 * @param {HTMLElement} el - The toast element
 * @param {*} message - Message (coerced to text)
 * @param {{label: string, onClick: Function}} [action] - Optional action button
 */
function renderToastContent(el, message, action) {
  el.textContent = '';
  const text = h('span', { class: 'toast-text', text: toText(message) });
  el.append(text);
  if (hasAction(action)) {
    const btn = h('button', {
      type: 'button',
      class: 'toast-action',
      text: String(action.label),
    });
    btn.addEventListener('click', (e) => {
      // Don't let the row's click-to-dismiss swallow the action.
      e.stopPropagation();
      try {
        action.onClick();
      } finally {
        dismissEl(el);
      }
    });
    el.append(btn);
  }
}

/**
 * Whether an `action` option is usable.
 * @param {*} action - The action option as handed in.
 * @returns {boolean} True when it can be rendered as a button.
 */
function hasAction(action) {
  return Boolean(
    action && typeof action.onClick === 'function' && action.label,
  );
}

/**
 * Keyboard handling for a focused toast: Escape dismisses it, and so do
 * Enter/Space on the row itself (WCAG 1.4.13 — a message that appears on
 * screen must be dismissable without a pointer). Inside the action button the
 * browser's own activation wins.
 * @param {KeyboardEvent} e - The keydown event.
 */
function onToastKeydown(e) {
  const el = /** @type {HTMLElement} */ (e.currentTarget);
  if (e.key === 'Escape') {
    // A toast is not a dialog: closing it must not also close what is behind it.
    e.stopPropagation();
    dismissEl(el, { moveFocus: true });
    return;
  }
  if (e.target !== el) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    dismissEl(el, { moveFocus: true });
  }
}

/**
 * Start (or restart) the auto-dismiss timer for a toast.
 * @param {HTMLElement} el - The toast element.
 */
function startTimer(el) {
  const st = toastState.get(el);
  // A toast carrying an action never expires on its own (WCAG 2.2.1): it goes
  // when the action is used or the toast is dismissed.
  if (!st || st.remainingMs == null) return;
  if (st.paused.hovered || st.paused.focused) return;
  st.startedAt = Date.now();
  st.timerId = window.setTimeout(() => dismissEl(el), st.remainingMs);
}

/**
 * Halt the auto-dismiss timer, banking the time left.
 * @param {HTMLElement} el - The toast element.
 */
function stopTimer(el) {
  const st = toastState.get(el);
  if (!st?.timerId) return;
  window.clearTimeout(st.timerId);
  st.timerId = 0;
  st.remainingMs = Math.max(0, st.remainingMs - (Date.now() - st.startedAt));
}

/**
 * Pause or resume a toast because the pointer or focus entered or left it.
 * @param {HTMLElement} el - The toast element.
 * @param {'hovered'|'focused'} which - Which interaction changed.
 * @param {boolean} value - Whether that interaction is now active.
 */
function setPaused(el, which, value) {
  const st = toastState.get(el);
  if (!st || st.paused[which] === value) return;
  st.paused[which] = value;
  if (value) stopTimer(el);
  else startTimer(el);
}

/**
 * Build a toast element with its interaction handlers wired.
 * @param {*} message - Message (coerced to text)
 * @param {{type: string, action?: {label: string, onClick: Function}}} opts - Kind and optional action.
 * @returns {HTMLElement} The toast element.
 */
function makeToastEl(message, { type, action }) {
  // No live role here: the region announces, one subscription per politeness.
  const el = h('div', { class: `toast toast-${type}` });
  el.tabIndex = 0;
  renderToastContent(el, message, action);
  el.addEventListener('click', () => dismissEl(el));
  el.addEventListener('keydown', onToastKeydown);
  el.addEventListener('mouseenter', () => setPaused(el, 'hovered', true));
  el.addEventListener('mouseleave', () => setPaused(el, 'hovered', false));
  el.addEventListener('focusin', () => setPaused(el, 'focused', true));
  el.addEventListener('focusout', () => setPaused(el, 'focused', false));
  return el;
}

/**
 * Take a toast off screen.
 * @param {HTMLElement} el - The toast element.
 * @param {{moveFocus?: boolean}} [opts] - Move focus to the next toast when the
 *   dismissal came from the keyboard, so the tab position is not lost.
 */
function dismissEl(el, { moveFocus = false } = {}) {
  if (!el || !el.parentNode) return;
  const st = toastState.get(el);
  if (st?.leaveTimerId) return; // already on its way out
  stopTimer(el);
  const id = el.dataset.toastId || '';
  if (id && byId.get(id) === el) byId.delete(id);
  const at = liveToasts.indexOf(el);
  if (at >= 0) liveToasts.splice(at, 1);
  el.classList.add('is-leaving');
  const leaveTimerId = window.setTimeout(() => {
    try {
      el.remove();
    } catch {
      // ignore
    }
  }, LEAVE_ANIMATION_MS);
  if (st) st.leaveTimerId = leaveTimerId;
  if (moveFocus) liveToasts[liveToasts.length - 1]?.focus();
}

/**
 * Show a toast.
 *
 * Prefer the sugar helpers (`toast.info/.success/.warning/.error`) — the base
 * form is for an info toast that needs options
 * (`tests/toast-call-shape.test.js` pins that).
 * @param {string|Error} message - Text, or the caught error itself.
 * @param {{id?: string, durationMs?: number, type?: string,
 *   action?: {label: string, onClick: Function}}} [opts] - Options.
 * @returns {{dismiss: Function}} Handle to take it off screen early.
 */
export function toast(message, opts = {}) {
  const stack = ensureStack();
  if (!stack) return { dismiss: () => {} };
  const id = opts?.id ? String(opts.id) : '';
  const type = classifyType(opts?.type);
  const action = opts?.action;
  const durationMs = hasAction(action)
    ? null
    : typeof opts?.durationMs === 'number'
      ? opts.durationMs
      : DEFAULT_DURATION_MS;

  // A dismissed toast leaves `byId` at once, so anything found here is still
  // on screen and is updated rather than stacked on top of itself.
  const existing = id ? byId.get(id) : null;
  if (existing) {
    stopTimer(existing);
    existing.className = `toast toast-${type}`;
    renderToastContent(existing, message, action);
    // Re-append rather than update in place: with `aria-relevant="additions"`
    // a text change inside the region is not announced, and an updated toast
    // ("Saving…" → "Saved") is exactly the case that must be. This also moves
    // it to the region its new kind belongs to.
    regionFor(type).appendChild(existing);
    // An updated toast under the pointer stays paused: the hover did not end.
    resetState(existing, durationMs, toastState.get(existing)?.paused);
    startTimer(existing);
    return { dismiss: () => dismissEl(existing) };
  }

  const el = makeToastEl(message, { type, action });
  if (id) {
    el.dataset.toastId = id;
    byId.set(id, el);
  }
  resetState(el, durationMs);
  regionFor(type).appendChild(el);
  liveToasts.push(el);
  // Cap stack size to avoid runaway spam.
  while (liveToasts.length > MAX_VISIBLE) dismissEl(liveToasts[0]);
  startTimer(el);
  return { dismiss: () => dismissEl(el) };
}

/**
 * Give a toast a fresh timer budget.
 * @param {HTMLElement} el - The toast element.
 * @param {number|null} durationMs - Lifetime, or null for "does not expire".
 * @param {{hovered: boolean, focused: boolean}} [paused] - Interactions still
 *   in progress, carried over when a toast is reused.
 */
function resetState(el, durationMs, paused) {
  toastState.set(el, {
    remainingMs: durationMs,
    startedAt: 0,
    timerId: 0,
    leaveTimerId: 0,
    paused: { hovered: false, focused: false, ...paused },
  });
}

toast.info = (message, opts = {}) => toast(message, { ...opts, type: 'info' });
toast.success = (message, opts = {}) =>
  toast(message, { ...opts, type: 'success' });
toast.error = (message, opts = {}) =>
  toast(message, {
    ...opts,
    type: 'error',
    durationMs: opts?.durationMs ?? ERROR_DURATION_MS,
  });
toast.warning = (message, opts = {}) =>
  toast(message, { ...opts, type: 'warning' });

// The regions must outlive the first toast, so build them at import — the
// module is pulled in by the app shell long before anything fires.
if (typeof document !== 'undefined') {
  if (document.body) ensureStack();
  else
    document.addEventListener('DOMContentLoaded', () => ensureStack(), {
      once: true,
    });
}
