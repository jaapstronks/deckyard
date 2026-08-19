import { sandboxEnabled, sandboxTtlMs } from '../../config/sandbox.js';

function safeIsoToMs(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function isSandboxEphemeralPresentation(pres) {
  if (!sandboxEnabled()) return false;
  if (!pres || typeof pres !== 'object') return false;
  // Treat organization-visible decks as curated seed decks that should not expire.
  return String(pres.visibility || 'private') !== 'organization';
}

export function attachSandboxMeta(pres) {
  if (!isSandboxEphemeralPresentation(pres)) return pres;
  const createdMs = safeIsoToMs(pres?.created) || Date.now();
  const expires = new Date(createdMs + sandboxTtlMs()).toISOString();
  pres.sandbox =
    pres?.sandbox && typeof pres.sandbox === 'object' ? pres.sandbox : {};
  pres.sandbox.enabled = true;
  pres.sandbox.expires = expires;
  return pres;
}
