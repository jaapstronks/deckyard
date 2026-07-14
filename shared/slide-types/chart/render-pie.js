import { esc } from '../helpers.js';
import { svgText } from './svg.js';
import { pieLabelInvertClass } from './palette.js';

function polarToCartesian(cx, cy, r, angle) {
  const a = (angle - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

export function pieEntriesFromDataset({ labels, values }) {
  const nums = (values || []).map((v) => (v == null ? 0 : Math.max(0, v)));
  const total = nums.reduce((a, b) => a + b, 0) || 1;
  return (labels || [])
    .map((label, i) => ({
      label: String(label || '').trim(),
      v: nums[i] || 0,
      frac: (nums[i] || 0) / total,
    }))
    .filter((e) => e.v > 0);
}

export function renderPieSvg(
  { labels, values },
  { showLegend = true, pieLabelMode = 'percent', palette = null } = {}
) {
  void showLegend;

  const W = 1600;
  const H = 620;
  // Center the pie; legend is rendered in HTML above the chart (not inside SVG).
  const cx = 800;
  // Keep geometry safely inside the viewBox so it never clips at the bottom.
  const cy = 310;
  const r = 280;

  const entries = pieEntriesFromDataset({ labels, values });
  const total = entries.reduce((a, b) => a + (b?.v || 0), 0) || 1;

  let angle = 0;
  let frags = '';
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const frac = e.v / total;
    const next = angle + frac * 360;
    const d = describeArc(cx, cy, r, angle, next);

    let frag = `<path class="chart-slice chart-slice-${i % 8}" d="${esc(
      d
    )}"></path>`;
    if (pieLabelMode !== 'none') {
      const mid = angle + (next - angle) / 2;
      const p = polarToCartesian(cx, cy, r * 0.7, mid);
      const pct = Math.round(frac * 100);
      const label =
        pieLabelMode === 'value'
          ? String(e.v)
          : pieLabelMode === 'both'
          ? `${e.v} (${pct}%)`
          : `${pct}%`;
      frag += svgText(p.x, p.y, label, {
        anchor: 'middle',
        cls: `chart-pie-label${pieLabelInvertClass(i, palette)}`,
        size: 34,
        opacity: 1,
      });
    }

    frags += `<g class="chart-frag">${frag}</g>`;
    angle = next;
  }

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pie chart">
      ${frags}
    </svg>
  `;
}
