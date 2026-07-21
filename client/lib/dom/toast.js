const DEFAULT_DURATION_MS = 3200;

let stackEl = null;
let byId = new Map();

function ensureStack() {
  if (stackEl && document.body.contains(stackEl)) return stackEl;
  stackEl = document.createElement('div');
  stackEl.className = 'toast-stack';
  stackEl.setAttribute('aria-live', 'polite');
  stackEl.setAttribute('aria-relevant', 'additions');
  document.body.appendChild(stackEl);
  return stackEl;
}

function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function classifyType(type) {
  const t = String(type || 'info').toLowerCase();
  if (t === 'success' || t === 'ok') return 'success';
  if (t === 'error' || t === 'danger' || t === 'fail') return 'error';
  if (t === 'warning' || t === 'warn') return 'warning';
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
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = toText(message);
  el.append(text);
  if (action && typeof action.onClick === 'function' && action.label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = String(action.label);
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

function makeToastEl(message, { type, action }) {
  const el = document.createElement('div');
  el.className = `toast toast-${classifyType(type)}`;
  el.setAttribute('role', 'status');
  el.tabIndex = 0;
  renderToastContent(el, message, action);
  el.addEventListener('click', () => dismissEl(el));
  return el;
}

function dismissEl(el) {
  if (!el || !el.parentNode) return;
  el.classList.add('is-leaving');
  const id = el.dataset.toastId || '';
  if (id && byId.get(id) === el) byId.delete(id);
  const t = Number(el.dataset.toastTimer || 0);
  if (t) clearTimeout(t);
  window.setTimeout(() => {
    try {
      el.remove();
    } catch {
      // ignore
    }
  }, 220);
}

function setTimer(el, durationMs) {
  const t = window.setTimeout(() => dismissEl(el), durationMs);
  el.dataset.toastTimer = String(t);
}

export function toast(message, opts = {}) {
  const stack = ensureStack();
  const id = opts?.id ? String(opts.id) : '';
  const durationMs =
    typeof opts?.durationMs === 'number'
      ? opts.durationMs
      : DEFAULT_DURATION_MS;
  const type = classifyType(opts?.type);
  const action = opts?.action;

  if (id && byId.has(id)) {
    const existing = byId.get(id);
    existing.className = `toast toast-${type}`;
    renderToastContent(existing, message, action);
    existing.classList.remove('is-leaving');
    const oldT = Number(existing.dataset.toastTimer || 0);
    if (oldT) clearTimeout(oldT);
    setTimer(existing, durationMs);
    return { dismiss: () => dismissEl(existing) };
  }

  const el = makeToastEl(message, { type, action });
  if (id) {
    el.dataset.toastId = id;
    byId.set(id, el);
  }

  stack.appendChild(el);
  // Cap stack size to avoid runaway spam.
  const max = 6;
  while (stack.children.length > max) {
    dismissEl(stack.firstElementChild);
  }
  setTimer(el, durationMs);
  return { dismiss: () => dismissEl(el) };
}

toast.info = (message, opts = {}) =>
  toast(message, { ...opts, type: 'info' });
toast.success = (message, opts = {}) =>
  toast(message, { ...opts, type: 'success' });
toast.error = (message, opts = {}) =>
  toast(message, { ...opts, type: 'error', durationMs: opts?.durationMs ?? 5600 });
toast.warning = (message, opts = {}) =>
  toast(message, { ...opts, type: 'warning' });
