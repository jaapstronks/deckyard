import { makeTicks } from './ticks.js';
import { truncateLabel, formatTick } from './strings.js';
import { svgText } from './svg.js';

function prevValidIndex(arr, fromIdx) {
  const a = Array.isArray(arr) ? arr : [];
  for (let j = Number(fromIdx) - 1; j >= 0; j -= 1) {
    const v = a[j];
    if (v != null && Number.isFinite(v)) return j;
  }
  return -1;
}

export function renderLineSvg(
  { x, y1, y2, series1Label, series2Label },
  {
    showValues = false,
    showLegend = false, // kept for API parity even though legend is HTML (rendered above)
    xAxisLabel = '',
    yAxisLabel = '',
  } = {}
) {
  void showLegend;
  void series1Label;
  void series2Label;

  const W = 1600;
  const H = 620;
  const xLab = String(xAxisLabel || '').trim();
  const yLab = String(yAxisLabel || '').trim();
  const margin = {
    l: yLab ? 140 : 110,
    r: 48,
    t: 46,
    // Move chart slightly down on the slide: lower the bottom margin (baseline).
    b: xLab ? 100 : 76,
  };
  const pw = W - margin.l - margin.r;
  const ph = H - margin.t - margin.b;
  const baseY = margin.t + ph;

  const all = [];
  for (const v of y1 || []) if (v != null) all.push(v);
  for (const v of y2 || []) if (v != null) all.push(v);
  const minV = all.length ? Math.min(...all) : 0;
  const maxV = all.length ? Math.max(...all) : 1;
  // IMPORTANT: include 0 in the visible range so the x-axis baseline is at 0,
  // not at the minimum observed value (prevents "floating baseline" bugs).
  let yMin = Math.min(0, minV);
  let yMax = Math.max(0, maxV);
  if (yMax === yMin) {
    yMin -= 0.5;
    yMax += 0.5;
  }
  const range = yMax - yMin || 1;
  const yTicks = makeTicks({
    min: yMin,
    max: yMax,
    desired: 6,
    forceMinZero: yMin >= 0,
  });

  const n = Math.max(2, (x || []).length);
  const step = pw / (n - 1);
  const toX = (i) => margin.l + i * step;
  const toY = (v) =>
    margin.t + ((yMax - v) / (yMax - yMin || range)) * ph;
  const axisY = toY(0);

  // Step-by-step friendly: render per-point fragments (segments + markers + tick label).
  const stride = (x || []).length > 10 ? 2 : 1;
  const valueStride = (x || []).length > 12 ? 2 : 1;
  let frags = '';
  for (let i = 0; i < (x || []).length; i += 1) {
    let frag = '';

    const v1 = y1?.[i];
    const v2 = y2?.[i];
    const has1 = v1 != null && Number.isFinite(v1);
    const has2 = v2 != null && Number.isFinite(v2);
    if (!has1 && !has2) continue;

    // X tick label appears with the point(s).
    if (i % stride === 0 || i === (x || []).length - 1) {
      frag += svgText(toX(i), axisY + 44, truncateLabel(x[i], 10), {
        anchor: 'middle',
        cls: 'chart-axis-label',
        size: 22,
        opacity: 0.85,
      });
    }

    if (has1) {
      const p = prevValidIndex(y1, i);
      if (p >= 0) {
        frag += `<path class="chart-line chart-line-1" d="M ${toX(
          p
        )} ${toY(y1[p])} L ${toX(i)} ${toY(v1)}" fill="none"></path>`;
      }
      frag += `<circle class="chart-point chart-point-1" cx="${toX(
        i
      )}" cy="${toY(v1)}" r="6"></circle>`;
      if (showValues && (i % valueStride === 0 || i === (x || []).length - 1)) {
        frag += svgText(toX(i), toY(v1) - 14, String(v1), {
          anchor: 'middle',
          cls: 'chart-value',
          size: 20,
          opacity: 0.9,
        });
      }
    }
    if (has2) {
      const p = prevValidIndex(y2, i);
      if (p >= 0) {
        frag += `<path class="chart-line chart-line-2" d="M ${toX(
          p
        )} ${toY(y2[p])} L ${toX(i)} ${toY(v2)}" fill="none"></path>`;
      }
      frag += `<circle class="chart-point chart-point-2" cx="${toX(
        i
      )}" cy="${toY(v2)}" r="6"></circle>`;
      if (showValues && (i % valueStride === 0 || i === (x || []).length - 1)) {
        frag += svgText(toX(i), toY(v2) + 26, String(v2), {
          anchor: 'middle',
          cls: 'chart-value',
          size: 20,
          opacity: 0.9,
        });
      }
    }

    frags += `<g class="chart-frag">${frag}</g>`;
  }

  const axes = `
    ${yTicks
      .map((tv) => {
        const y = toY(tv);
        return `
          <line x1="${margin.l}" y1="${y}" x2="${W - margin.r}" y2="${y}" class="chart-grid"></line>
          ${svgText(margin.l - 14, y + 7, formatTick(tv), {
            anchor: 'end',
            cls: 'chart-axis-label',
            size: 22,
            opacity: 0.78,
          })}
        `;
      })
      .join('')}
    <line x1="${margin.l}" y1="${axisY}" x2="${W - margin.r}" y2="${axisY}" class="chart-axis"></line>
    <line x1="${margin.l}" y1="${margin.t}" x2="${margin.l}" y2="${baseY}" class="chart-axis"></line>
  `;

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
        ? svgText(margin.l - 92, margin.t + ph / 2, yLab, {
            anchor: 'middle',
            cls: 'chart-axis-title',
            size: 24,
            opacity: 0.85,
            transform: `rotate(-90 ${margin.l - 92} ${margin.t + ph / 2})`,
          })
        : ''
    }
  `;

  return `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">
      ${axes}
      ${frags}
      ${axisTitles}
    </svg>
  `;
}
