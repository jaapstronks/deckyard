import { prefersReducedMotion } from './motion.js';

/**
 * Parse a KPI value string and extract the numeric part along with
 * any prefix and suffix text. This unified function handles separator
 * detection consistently for both number parsing and decimal inference.
 *
 * @param {string} raw - The raw value string (e.g., "€ 5.000", "35%", "ca. 1.200")
 * @returns {{ number: number, prefix: string, suffix: string, decimals: number } | null}
 */
function parseKpiValue(raw) {
  const s0 = String(raw || '').trim();
  if (!s0) return null;

  // Find the first "number-ish" run (including negative sign)
  const match = s0.match(/-?[\d\s.,]+/);
  if (!match?.[0]) return null;

  const numRun = match[0];
  const matchIndex = match.index;

  // Extract prefix (everything before the number)
  const prefix = s0.slice(0, matchIndex);

  // Extract suffix (everything after the number)
  const suffix = s0.slice(matchIndex + numRun.length);

  // Normalize the number run (remove spaces)
  const s = numRun.replace(/\s+/g, '');

  // Decide decimal separator by last occurrence
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  let normalized = s;
  let decimals = 0;

  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: the one that comes last is the decimal separator
    if (lastDot > lastComma) {
      // Dot is decimal, comma is thousands
      normalized = s.split(',').join('');
      decimals = s.length - lastDot - 1;
    } else {
      // Comma is decimal, dot is thousands
      normalized = s.split('.').join('').replace(',', '.');
      decimals = s.length - lastComma - 1;
    }
  } else if (lastComma !== -1) {
    // Only commas
    const digitsAfter = s.length - lastComma - 1;
    const commaCount = (s.match(/,/g) || []).length;

    if (commaCount > 1) {
      // Multiple commas => thousands separators
      normalized = s.split(',').join('');
      decimals = 0;
    } else if (digitsAfter === 3 && lastComma > 0) {
      // Single comma with 3 digits after => thousands separator
      normalized = s.split(',').join('');
      decimals = 0;
    } else if (digitsAfter > 0 && digitsAfter <= 6) {
      // Decimal comma (e.g., 1,2 or 1,25)
      normalized = s.replace(',', '.');
      decimals = digitsAfter;
    } else {
      normalized = s.split(',').join('');
      decimals = 0;
    }
  } else if (lastDot !== -1) {
    // Only dots
    const dotCount = (s.match(/\./g) || []).length;
    const digitsAfter = s.length - lastDot - 1;

    if (dotCount > 1) {
      // Multiple dots => thousands separators (e.g., 1.234.567)
      normalized = s.split('.').join('');
      decimals = 0;
    } else if (digitsAfter === 3 && lastDot > 0) {
      // Single dot with 3 digits after => thousands separator (e.g., 36.000)
      normalized = s.split('.').join('');
      decimals = 0;
    } else {
      // Decimal dot
      normalized = s;
      decimals = digitsAfter;
    }
  }

  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return null;

  // Ensure decimals is reasonable
  if (decimals < 0 || decimals > 6) decimals = 0;

  return {
    number: n,
    prefix: prefix,
    suffix: suffix,
    decimals: decimals,
  };
}

function formatNumber(n, decimals) {
  try {
    // Force European-style separators regardless of browser locale.
    return new Intl.NumberFormat('nl-NL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    return decimals ? n.toFixed(decimals) : String(Math.round(n));
  }
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function initCountUpForMetric(metricEl, valueNumEl) {
  const original = String(valueNumEl.textContent || '').trim();
  const parsed = parseKpiValue(original);
  if (parsed == null) return () => {};

  const { number: target, prefix, suffix, decimals } = parsed;
  let raf = 0;
  let running = false;

  // Helper to build the full display string with prefix and suffix preserved
  const buildDisplay = (n) => prefix + formatNumber(n, decimals) + suffix;

  // Keep original in dataset for safety.
  valueNumEl.dataset.kpiTargetText = original;
  valueNumEl.dataset.kpiTargetNumber = String(target);

  const startIfVisible = () => {
    // Presenter renders the whole deck at once. Only animate when this metric is on the
    // active slide; otherwise it may animate off-screen and appear "broken".
    const deckSection = metricEl.closest?.('section.deck-slide');
    if (deckSection && !deckSection.classList.contains('is-active')) return;
    if (metricEl.classList.contains('sb-step-hidden')) return;
    if (valueNumEl.dataset.kpiAnimated === '1') return;
    if (running) return;

    running = true;
    // Only when we actually start do we reset to 0 (avoid weird "all zeros" states).
    valueNumEl.textContent = buildDisplay(0);
    const start = performance.now();
    const duration = 1400;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const v = target * easeOutCubic(t);
      valueNumEl.textContent = buildDisplay(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        valueNumEl.textContent = buildDisplay(target);
        valueNumEl.dataset.kpiAnimated = '1';
        running = false;
      }
    };
    raf = requestAnimationFrame(tick);
  };

  // React to presenter step mode toggling visibility via class changes.
  const mo = new MutationObserver(() => startIfVisible());
  try {
    mo.observe(metricEl, {
      attributes: true,
      attributeFilter: ['class'],
    });
  } catch {
    // ignore
  }

  // React to presenter activation changes (slide becoming active).
  const deckSection = metricEl.closest?.('section.deck-slide');
  const mo2 =
    deckSection && deckSection.querySelector
      ? new MutationObserver(() => startIfVisible())
      : null;
  if (mo2 && deckSection) {
    try {
      mo2.observe(deckSection, {
        attributes: true,
        attributeFilter: ['class'],
      });
    } catch {
      // ignore
    }
  }

  // Fallback: start when the element actually becomes visible in the viewport.
  const io =
    globalThis.IntersectionObserver && metricEl?.getBoundingClientRect
      ? new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) startIfVisible();
          },
          { threshold: 0.15 }
        )
      : null;
  try {
    io?.observe?.(metricEl);
  } catch {
    // ignore
  }

  // Also attempt on init (non-step mode, or first visible metric).
  // Defer to next frame to ensure step visibility classes have been applied first.
  requestAnimationFrame(() => startIfVisible());

  return () => {
    try {
      mo.disconnect();
    } catch {
      // ignore
    }
    try {
      mo2?.disconnect?.();
    } catch {
      // ignore
    }
    try {
      io?.disconnect?.();
    } catch {
      // ignore
    }
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}

export function initKpiMetricsSlides(rootEl) {
  if (!rootEl?.querySelectorAll) return () => {};
  if (prefersReducedMotion()) return () => {};

  const selector = '.slide-kpi-metrics[data-count-up="1"]';
  // Note: in most callers `rootEl` *is* the slide element; querySelectorAll() won't include
  // the root element itself, so we must handle that explicitly.
  const slides = [
    ...(rootEl.matches?.(selector) ? [rootEl] : []),
    ...Array.from(rootEl.querySelectorAll(selector)),
  ];
  if (!slides.length) return () => {};

  const cleanups = [];
  for (const slideEl of slides) {
    const metrics = Array.from(
      slideEl.querySelectorAll(
        '.kpi-metric:not(.is-empty) .kpi-value-num[data-kpi-countup="1"]'
      )
    );
    for (const valueNumEl of metrics) {
      const metricEl = valueNumEl.closest('.kpi-metric');
      if (!metricEl) continue;
      cleanups.push(initCountUpForMetric(metricEl, valueNumEl));
    }
  }

  return () => {
    for (const fn of cleanups) {
      try {
        fn?.();
      } catch {
        // ignore
      }
    }
    cleanups.length = 0;
  };
}
