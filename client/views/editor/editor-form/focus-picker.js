import { t } from '../../../lib/ui-i18n.js';

function toNumberOrNull(v) {
  if (v == null) return null;
  if (typeof v === 'string' && !v.trim()) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n;
}

function nearest(v, opts) {
  const n = toNumberOrNull(v);
  if (n == null) return null;
  let best = opts?.[0] ?? null;
  let bestD = best == null ? Infinity : Math.abs(n - best);
  for (const o of opts || []) {
    const d = Math.abs(n - o);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

function posLabelFor(x, y) {
  const vx = Number(x);
  const vy = Number(y);
  const row =
    vy === 0 ? 'Top' : vy === 50 ? 'Middle' : vy === 100 ? 'Bottom' : 'Center';
  const col =
    vx === 0 ? 'left' : vx === 50 ? 'center' : vx === 100 ? 'right' : 'center';
  return `${row} ${col}`;
}

export function renderFocusGridField({
  h,
  label = t('editor.imagePosition.cropLabel', 'Image focus (crop)'),
  helpText = 'Pick what should stay visible when the image is cropped (cover).',
  focusX,
  focusY,
  disabled = false,
  onChange,
} = {}) {
  const opts = [0, 50, 100];
  const activeX = nearest(focusX, opts) ?? 50;
  const activeY = nearest(focusY, opts) ?? 50;

  const wrap = h('div', { class: 'stack is-field' });
  wrap.append(h('div', { class: 'field-label', text: label }));

  const grid = h('div', {
    class: `sb-focus-grid${disabled ? ' is-disabled' : ''}`,
    role: 'radiogroup',
    'aria-label': label,
  });

  const setActive = ({ x, y }) => {
    for (const child of grid.children) {
      const is =
        child?.dataset?.x != null &&
        child?.dataset?.y != null &&
        Number(child.dataset.x) === Number(x) &&
        Number(child.dataset.y) === Number(y);
      child.classList.toggle('is-active', !!is);
      child.setAttribute('aria-pressed', is ? 'true' : 'false');
    }
  };

  for (const y of opts) {
    for (const x of opts) {
      const btn = h('button', {
        type: 'button',
        class: 'sb-focus-btn',
        title: posLabelFor(x, y),
        'aria-label': posLabelFor(x, y),
        'aria-pressed':
          Number(activeX) === Number(x) && Number(activeY) === Number(y)
            ? 'true'
            : 'false',
        disabled,
        onclick: () => {
          if (disabled) return;
          setActive({ x, y });
          onChange?.({ focusX: x, focusY: y });
        },
      });
      btn.dataset.x = String(x);
      btn.dataset.y = String(y);
      if (Number(activeX) === Number(x) && Number(activeY) === Number(y))
        btn.classList.add('is-active');
      btn.append(h('span', { class: 'sb-focus-dot', 'aria-hidden': 'true' }));
      grid.append(btn);
    }
  }

  const actions = h('div', { class: 'row sb-focus-actions' });
  const resetBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary is-compact-sm',
    text: t('editor.focusPicker.center', 'Center'),
    disabled,
    title: t('editor.focusPicker.reset', 'Reset focus to center'),
    onclick: () => {
      if (disabled) return;
      setActive({ x: 50, y: 50 });
      onChange?.({ focusX: 50, focusY: 50 });
    },
  });
  actions.append(resetBtn);

  wrap.append(grid, actions, helpText ? h('div', { class: 'help', text: helpText }) : null);
  return wrap;
}
