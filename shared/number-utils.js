/**
 * Shared number utilities
 */

/**
 * Constrain a number to the closed range [min, max].
 * @param {number} n - Value to constrain
 * @param {number} min - Lower bound
 * @param {number} max - Upper bound
 * @returns {number} `n`, or the bound it crossed
 */
export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
