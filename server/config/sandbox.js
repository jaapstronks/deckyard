import { truthy } from './utils.js';

export function sandboxEnabled() {
  return truthy(process.env.SANDBOX_MODE);
}

export function sandboxTtlHours() {
  const raw = process.env.SANDBOX_TTL_HOURS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 24;
}

export function sandboxTtlMs() {
  return sandboxTtlHours() * 60 * 60 * 1000;
}

export function sandboxDefaultThemeId() {
  // Keep it explicit so sandbox instances look neutral/non-branded by default.
  const id = String(process.env.SANDBOX_DEFAULT_THEME || '').trim();
  if (id) return id;
  return 'sandbox-sage';
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
