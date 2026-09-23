import { envBool, envInt } from './utils.js';

export function sandboxEnabled() {
  return envBool('SANDBOX_MODE');
}

/** Hours a sandbox deck lives before the cleanup job deletes it. */
const DEFAULT_SANDBOX_TTL_HOURS = 24;

/**
 * The sandbox deck lifetime, in whole hours (at least 1). The one reading of
 * `SANDBOX_TTL_HOURS`: the cleanup job deletes on it and the sandbox banner
 * states it (via `sandboxTtlHours` in the feature snapshot), so the copy and
 * the sweep cannot promise different numbers.
 * @returns {number}
 */
export function sandboxTtlHours() {
  return envInt('SANDBOX_TTL_HOURS', DEFAULT_SANDBOX_TTL_HOURS, { min: 1 });
}

export function sandboxTtlMs() {
  return sandboxTtlHours() * 60 * 60 * 1000;
}

export function sandboxDefaultThemeId() {
  // Keep it explicit so sandbox instances look neutral/non-branded by default.
  const id = String(process.env.SANDBOX_DEFAULT_THEME || '').trim();
  if (id) return id;
  return 'editorial';
}

export function sandboxCookieMaxAgeDays() {
  const raw = process.env.SANDBOX_COOKIE_DAYS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.min(365, Math.floor(n));
  return 30;
}

export function sandboxWatermarkText() {
  const txt = String(process.env.SANDBOX_WATERMARK || '').trim();
  if (txt) return txt;
  return 'Sandbox export • Created by an anonymous user';
}
