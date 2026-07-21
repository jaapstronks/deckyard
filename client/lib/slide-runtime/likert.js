const NS = 'http://www.w3.org/2000/svg';
import { newId } from '../util/id.js';
import { t } from '../ui-i18n.js';

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function catmullRomPath(points) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const p = points;
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 0; i < p.length - 1; i += 1) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;

    // Catmull-Rom to cubic Bezier conversion
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    el.setAttribute(k, String(v));
  }
  return el;
}

export function mountLikertHill(container, { optionCount = 5 } = {}) {
  const n = clamp(Math.floor(Number(optionCount || 0) || 0), 2, 10);
  container.innerHTML = '';

  const W = 1000;
  const H = 240;
  const padX = 84;
  const padTop = 18;
  const padBottom = 32;
  const baseline = H - padBottom;
  const innerW = W - padX * 2;
  const step = n > 1 ? innerW / (n - 1) : innerW;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': t('likert.distributionAria', 'Distribution'),
    preserveAspectRatio: 'none',
  });

  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', {
    id: `likert-grad-${newId()}`,
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
  });
  grad.append(
    svgEl('stop', { offset: '0%', 'stop-color': 'currentColor', 'stop-opacity': '0.40' }),
    svgEl('stop', { offset: '100%', 'stop-color': 'currentColor', 'stop-opacity': '0.08' })
  );
  defs.append(grad);
  svg.append(defs);

  const grid = svgEl('path', {
    d: `M ${padX} ${baseline} H ${W - padX}`,
    class: 'likert-hill-baseline',
  });

  const fill = svgEl('path', {
    class: 'likert-hill-fill',
    fill: `url(#${grad.id})`,
  });
  const stroke = svgEl('path', {
    class: 'likert-hill-stroke',
    fill: 'none',
  });

  svg.append(grid, fill, stroke);
  container.append(svg);

  const update = ({ counts = [], total = 0 } = {}) => {
    const t = Math.max(0, Number(total || 0) || 0);
    const maxY = baseline - padTop;
    const pts = [];

    // Phantom endpoints beyond the visible range, anchored on the baseline.
    pts.push({ x: padX - step, y: baseline });

    for (let i = 0; i < n; i += 1) {
      const c = Math.max(0, Number(counts?.[i] || 0) || 0);
      const pct = t > 0 ? c / t : 0;
      const x = padX + step * i;
      const y = baseline - clamp(pct, 0, 1) * maxY;
      pts.push({ x, y });
    }

    pts.push({ x: W - padX + step, y: baseline });

    const lineD = catmullRomPath(pts);
    if (!lineD) return;
    fill.setAttribute('d', `${lineD} Z`);
    stroke.setAttribute('d', lineD);
  };

  update({ counts: [], total: 0 });
  return { update };
}
