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

export function makeTicks({
  min,
  max,
  desired = 6,
  forceMinZero = false,
} = {}) {
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
  for (let v = start; v <= end + step * 0.5; v += step)
    ticks.push(v);
  return ticks;
}
