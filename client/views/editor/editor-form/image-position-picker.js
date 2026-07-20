import { renderFocusGridField } from './focus-picker.js';
import { t } from '../../../lib/ui-i18n.js';

const imgSizeCache = new Map();

function loadImageSize(src) {
  const url = String(src || '').trim();
  if (!url) return Promise.resolve(null);
  if (imgSizeCache.has(url)) return imgSizeCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () =>
      resolve({
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0,
      });
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imgSizeCache.set(url, p);
  return p;
}

function clamp01(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function nearestSnap(v, opts) {
  const n = Number(v);
  if (Number.isNaN(n)) return null;
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

function measureContainerAspect(containerSelector) {
  const el = document.querySelector(containerSelector);
  if (!el) return null;
  const w = el.clientWidth || 0;
  const h = el.clientHeight || 0;
  if (w <= 0 || h <= 0) return null;
  return { w, h, aspect: w / h };
}

function containAxis({ imgAspect, containerAspect } = {}) {
  if (!imgAspect || !containerAspect) return null;
  const eps = 0.02;
  const diff = imgAspect - containerAspect;
  if (Math.abs(diff) < eps) return 'none';
  // In contain mode:
  // - If image is wider than the box => it fills width, leaving vertical letterbox => Y matters.
  // - If image is taller than the box => it fills height, leaving horizontal letterbox => X matters.
  return diff > 0 ? 'y' : 'x';
}

function segmented({ h, label, options, value, disabled, onChange }) {
  const group = h('div', {
    class: 'sb-segmented is-toggle',
    role: 'radiogroup',
    'aria-label': label,
  });

  const setActive = (v) => {
    for (const child of group.children) {
      const is =
        child?.dataset?.value != null && child.dataset.value === String(v);
      child.classList.toggle('is-active', !!is);
      child.setAttribute('aria-pressed', is ? 'true' : 'false');
    }
  };

  for (const opt of options || []) {
    const btn = h('button', {
      type: 'button',
      class: 'sb-segmented-btn',
      disabled,
      title: opt.title || opt.label,
      'aria-label': opt.ariaLabel || opt.label,
      'aria-pressed': String(value) === String(opt.value) ? 'true' : 'false',
      onclick: () => {
        if (disabled) return;
        setActive(opt.value);
        onChange?.(opt.value);
      },
    });
    btn.dataset.value = String(opt.value);
    if (String(value) === String(opt.value)) btn.classList.add('is-active');
    btn.append(h('span', { text: opt.label }));
    group.append(btn);
  }
  return group;
}

export function renderImagePositionPicker({
  h,
  mode, // 'cover' | 'contain'
  imageUrl,
  containerSelector,
  focusX,
  focusY,
  onChange,
} = {}) {
  const wrap = h('div', { class: 'stack is-field' });
  const url = String(imageUrl || '').trim();
  if (!url) return null;

  const snap = [0, 50, 100];
  const activeX = nearestSnap(focusX, snap) ?? 50;
  const activeY = nearestSnap(focusY, snap) ?? 50;

  if (mode === 'cover') {
    return renderFocusGridField({
      h,
      label: t('editor.imagePosition.cropLabel', 'Image focus (crop)'),
      helpText: t('editor.imagePosition.cropHelp', 'Pick what should stay visible when the image is cropped.'),
      focusX: activeX,
      focusY: activeY,
      disabled: false,
      onChange,
    });
  }

  // Contain mode: determine whether X or Y alignment is meaningful.
  wrap.append(
    h('div', { class: 'field-label', text: t('editor.imagePosition.alignmentLabel', 'Image alignment (fit)') })
  );
  const mount = h('div', { class: 'stack' });
  const help = h('div', {
    class: 'help',
    text: t('editor.imagePosition.analyzing', 'Analyzing image...'),
  });
  wrap.append(mount, help);

  const renderAxis = ({ axis } = {}) => {
    mount.innerHTML = '';
    if (axis === 'none') {
      help.textContent = t('editor.imagePosition.noExtraSpace', 'No extra space: alignment has no effect.');
      return;
    }
    if (axis === 'x') {
      help.textContent = t('editor.imagePosition.tallerThanBox', 'Image is taller than the box: choose left/center/right.');
      const opts = [
        { value: 0, label: t('editor.imagePosition.left', 'Left') },
        { value: 50, label: t('editor.imagePosition.center', 'Center') },
        { value: 100, label: t('editor.imagePosition.right', 'Right') },
      ];
      mount.append(
        segmented({
          h,
          label: t('editor.imagePosition.horizontalAlignment', 'Horizontal alignment'),
          options: opts,
          value: clamp01(activeX, 0, 100),
          disabled: false,
          onChange: (x) => onChange?.({ focusX: Number(x), focusY: 50 }),
        })
      );
      return;
    }
    if (axis === 'y') {
      help.textContent = t('editor.imagePosition.widerThanBox', 'Image is wider than the box: choose top/center/bottom.');
      const opts = [
        { value: 0, label: t('editor.imagePosition.top', 'Top') },
        { value: 50, label: t('editor.imagePosition.center', 'Center') },
        { value: 100, label: t('editor.imagePosition.bottom', 'Bottom') },
      ];
      mount.append(
        segmented({
          h,
          label: t('editor.imagePosition.verticalAlignment', 'Vertical alignment'),
          options: opts,
          value: clamp01(activeY, 0, 100),
          disabled: false,
          onChange: (y) => onChange?.({ focusX: 50, focusY: Number(y) }),
        })
      );
      return;
    }
    help.textContent = t('editor.imagePosition.alignmentAvailable', 'Alignment available.');
  };

  // Async compute and render.
  (async () => {
    try {
      const size = await loadImageSize(url);
      const box = measureContainerAspect(containerSelector);
      const imgAspect =
        size?.width > 0 && size?.height > 0 ? size.width / size.height : null;
      const axis = containAxis({ imgAspect, containerAspect: box?.aspect });
      renderAxis({ axis });
    } catch {
      renderAxis({ axis: null });
      help.textContent = t('editor.imagePosition.couldNotAnalyze', 'Could not analyze image.');
    }
  })();

  return wrap;
}
