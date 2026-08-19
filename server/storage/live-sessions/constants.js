import { envInt } from '../../config/utils.js';

export const TTL_MS = 24 * 60 * 60 * 1000; // ~1 day
export const LIVE_WINDOW_MS = Math.max(
  60_000,
  envInt('PRESENT_LIVE_WINDOW_MS', 15 * 60 * 1000, { min: 1 }),
); // considered "live" if presenter updated recently
