/**
 * Whether the user prefers reduced motion.
 *
 * Guarded so it can't throw in environments without `matchMedia`; returns
 * `false` (motion allowed) when it can't be determined. Shared by the animation
 * surfaces (KPI counters, presenter slide animations, morph transitions) so the
 * check lives in one place.
 *
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  try {
    return (
      globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ===
      true
    );
  } catch {
    return false;
  }
}
