import { makeTicks } from './ticks.js';
import { truncateLabel, formatTick } from './strings.js';
import { svgText } from './svg.js';

export function renderBarSvg(
  { labels, values },
  { showValues = false, xAxisLabel = '', yAxisLabel = '' } = {}
) {
  const W = 1600;
  const H = 620;
  const xLab = String(xAxisLabel || '').trim();
  const yLab = String(yAxisLabel || '').trim();
  const margin = {
    l: yLab ? 132 : 96,
    r: 40,
    t: 40,
    // Move chart slightly down on the slide: lower the bottom margin (baseline).
    b: xLab ? 100 : 76,
  };
  const pw = W - margin.l - margin.r;
  const ph = H - margin.t - margin.b;
  const baseY = margin.t + ph;

  const nums = values.map((v) => (v == null ? 0 : v));
  const maxV = Math.max(1, ...nums.filter((n) => Number.isFinite(n)));
  const ticks = makeTicks({
    min: 0,
    max: maxV,
    desired: 6,
    forceMinZero: true,
  });

  const n = labels.length || 1;
  // Prevent small bar charts (2–4) from stretching too wide: cap plot width and center it.
  const capPlotW = n <= 4 ? Math.min(pw, n * 260) : pw;
  const plotX = margin.l + (pw - capPlotW) / 2;
  const plotW = capPlotW;

  const step = plotW / n;
  const barW = step * 0.7;
  const x0 = plotX + (step - barW) / 2;

  let bars = '';
  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    const val = v == null ? 0 : v;
    const h = (val / maxV) * ph;
    const x = x0 + i * step;
    const y = baseY - h;
    const xLabel = svgText(
      x + barW / 2,
      baseY + 40,
      truncateLabel(labels[i], 14),
      {
        anchor: 'middle',
        cls: 'chart-axis-label',
        size: 22,
        opacity: 0.85,
      }
    );
    const vLabel = showValues
      ? svgText(x + barW / 2, y - 10, v == null ? '' : String(v), {
          anchor: 'middle',
          cls: 'chart-value',
          size: 20,
          opacity: 0.9,
        })
      : '';
    bars += `
      <g class="chart-frag">
        <rect class="chart-bar chart-slice-${i % 8}" x="${x}" y="${y}" width="${barW}" height="${h}"></rect>
        ${xLabel}
        ${vLabel}
      </g>
    `;
  }

  // Y ticks + faint gridlines
  let yTicks = '';
  for (const tv of ticks) {
    const y =
      baseY -
      (tv / (ticks[ticks.length - 1] || maxV || 1)) * ph;
    yTicks += `
      <line x1="${plotX}" y1="${y}" x2="${plotX + plotW}" y2="${y}" class="chart-grid"></line>
      ${svgText(plotX - 12, y + 7, formatTick(tv), {
        anchor: 'end',
        cls: 'chart-axis-label',
        size: 22,
        opacity: 0.78,
      })}
    `;
  }

  const axes = `
    ${yTicks}
    <line x1="${plotX}" y1="${baseY}" x2="${plotX + plotW}" y2="${baseY}" class="chart-axis"></line>
    <line x1="${plotX}" y1="${margin.t}" x2="${plotX}" y2="${baseY}" class="chart-axis"></line>
  `;

  const yTitleX = plotX - 78;
  const axisTitles = `
    ${
      xLab
        ? svgText(W / 2, H - 26, xLab, {
            anchor: 'middle',
            cls: 'chart-axis-title',
            size: 24,
            opacity: 0.85,
          })
        : ''
    }
    ${
      yLab
        ? svgText(yTitleX, margin.t + ph / 2, yLab, {
            anchor: 'middle',
            cls: 'chart-axis-title',
            size: 24,
            opacity: 0.85,
            transform: `rotate(-90 ${yTitleX} ${margin.t + ph / 2})`,
          })
        : ''
    }
  `;

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">
      ${axes}
      ${bars}
      ${axisTitles}
    </svg>
  `;
}
