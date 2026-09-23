import { envBool, envInt } from './utils.js';

export function sandboxEnabled() {
  return envBool('SANDBOX_MODE');
}

/**
 * Whether the people on this instance can reach each other: find one another
 * in user search, open a deck to the whole organization, invite someone onto a
 * deck, hand a deck over, and put slides or collections on the shared Team
 * shelf. The sandbox declares it off (D181): its guests are anonymous
 * strangers on a public URL, so anything one of them shares lands in front of
 * the next visitor. The one reading of that stance — the server gates
 * (`server/sandbox/sharing.js`) and the client (`enableSharing` in the feature
 * snapshot) both ask here, never `sandboxEnabled()` for it.
 * @returns {boolean}
 */
export function sharingEnabled() {
  return !sandboxEnabled();
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
