export const TTL_MS = 24 * 60 * 60 * 1000; // ~1 day
export const HEARTBEAT_MS = 15 * 1000;
export const LIVE_WINDOW_MS = Math.max(
  60_000,
  Number(process.env.PRESENT_LIVE_WINDOW_MS || 0) || 15 * 60 * 1000
); // considered "live" if presenter updated recently
