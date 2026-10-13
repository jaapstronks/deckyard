/** Normalize token-bucket parameters identically for every backend. */
export function normalizeRateLimitOptions({ capacity, refillPerSec }) {
  return {
    capacity: Math.max(1, Number(capacity || 0) || 1),
    refillPerSec: Math.max(0.001, Number(refillPerSec || 0) || 1),
  };
}
