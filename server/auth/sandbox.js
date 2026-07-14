import crypto from 'node:crypto';
import { parseCookies } from '../utils/cookies.js';
import {
  sandboxCookieMaxAgeDays,
  sandboxEnabled,
} from '../config/sandbox.js';
import { shouldUseSecureCookies } from '../utils/request-url.js';

const COOKIE_NAME = 'sb_sandbox';
const GUEST_EMAIL_DOMAIN = 'sandbox.local';

function normalizeId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  // UUID or "uuid-like" token. We keep it loose but bounded to avoid header abuse.
  if (s.length < 8 || s.length > 80) return null;
  if (!/^[a-z0-9\-_.]+$/i.test(s)) return null;
  return s;
}

export function getSandboxUserFromRequest(req) {
  if (!sandboxEnabled()) return null;
  const cookies = parseCookies(req.headers?.cookie);
  const token = normalizeId(cookies[COOKIE_NAME]);
  if (!token) return null;
  const email = `guest-${token}@${GUEST_EMAIL_DOMAIN}`.toLowerCase();
  return {
    email,
    role: 'user',
    name: 'Guest',
    isAdmin: false,
    isSandboxGuest: true,
    sandboxId: token,
  };
}

export function ensureSandboxUser(req, res) {
  if (!sandboxEnabled()) return null;
  const existing = getSandboxUserFromRequest(req);
  if (existing) return existing;

  const token = crypto.randomUUID();
  const maxAgeDays = sandboxCookieMaxAgeDays();
  const maxAgeSec = maxAgeDays * 24 * 60 * 60;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeSec)}`,
  ];
  if (shouldUseSecureCookies(req)) parts.push('Secure');

  // Preserve any existing Set-Cookie headers (if present).
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', parts.join('; '));
  else if (Array.isArray(prev))
    res.setHeader('Set-Cookie', [...prev, parts.join('; ')]);
  else
    res.setHeader('Set-Cookie', [String(prev), parts.join('; ')]);

  const email = `guest-${token}@${GUEST_EMAIL_DOMAIN}`.toLowerCase();
  return {
    email,
    role: 'user',
    name: 'Guest',
    isAdmin: false,
    isSandboxGuest: true,
    sandboxId: token,
  };
}
