/**
 * The vertical axis of a cartesian chart: one tick ladder and the one
 * value→pixel mapping that every mark on the plot uses.
 *
 * Ticks and scale are deliberately not separable. Bar drew its bars on the data
 * maximum and its gridlines on the top tick, so the tallest bar always touched
 * the plot top while its own gridline sat lower (a bar of 7 read as 8 on a
 * 0–8 ladder). Line shared one mapping but derived it from the data extent, so
 * a tick above the maximum was drawn above the plot — off-canvas at y=-135 for
 * a 0–1.5 ladder over data topping out at 1.1. Both are the same defect: two
 * domains for one axis. {@link makeAxis} hands out the ticks and the mapping
 * together, from a single domain, so the two cannot drift apart again.
 */

function niceStep(raw) {
  const x = Math.abs(Number(raw) || 0);
  if (!x || !Number.isFinite(x)) return 1;
  const pow10 = 10 ** Math.floor(Math.log10(x));
  const f = x / pow10;
  let nf = 1;
  if (f <= 1) nf = 1;
  else if (f <= 2) nf = 2;
  else if (f <= 5) nf = 5;
  else nf = 10;
  return nf * pow10;
}

function makeTicks({ min, max, desired = 6, forceMinZero = false } = {}) {
  let mn = Number(min);
  let mx = Number(max);
  if (!Number.isFinite(mn)) mn = 0;
  if (!Number.isFinite(mx)) mx = 1;
  if (forceMinZero) mn = 0;
  if (mx === mn) mx = mn + 1;

  const step = niceStep((mx - mn) / Math.max(2, desired - 1));
  const start = forceMinZero ? 0 : Math.floor(mn / step) * step;
  const end = Math.ceil(mx / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 0.5; v += step) ticks.push(v);
  return ticks;
}

/**
 * Build the vertical axis for a plot rectangle.
 *
 * The domain is the tick ladder itself — from the first tick to the last — so
 * every gridline lands inside `[top, top + height]` and no value can be drawn
 * past the tick that labels it.
 *
 * @param {Object} spec
 * @param {number} spec.min Smallest value that must fit.
 * @param {number} spec.max Largest value that must fit.
 * @param {number} spec.top Pixel y of the plot top.
 * @param {number} spec.height Plot height in pixels.
 * @param {number} [spec.desired=6] Preferred number of ticks.
 * @param {boolean} [spec.forceMinZero=false] Pin the ladder's foot at zero.
 * @returns {{ ticks: number[], toY: (v: number) => number, domainMin: number, domainMax: number }}
 */
export function makeAxis({
  min,
  max,
  top,
  height,
  desired = 6,
  forceMinZero = false,
}) {
  const ticks = makeTicks({ min, max, desired, forceMinZero });
  const domainMin = ticks[0];
  const domainMax = ticks[ticks.length - 1];
  const span = domainMax - domainMin || 1;
  const toY = (v) => top + ((domainMax - Number(v)) / span) * height;
  return { ticks, toY, domainMin, domainMax };
}
