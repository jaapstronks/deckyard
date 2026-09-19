import { sandboxEnabled, sandboxTtlMs } from '../../config/sandbox.js';
import { isSandboxGuestEmail } from '../../auth/sandbox.js';

function safeIsoToMs(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function isSandboxEphemeralPresentation(pres) {
  if (!sandboxEnabled()) return false;
  if (!pres || typeof pres !== 'object') return false;
  // Only guest work expires; organization-visible decks are curated seed decks,
  // and a deck a real user owns is never the sandbox's to delete. Mirrors the
  // SQL filter in jobs/sandbox-cleanup.js.
  if (!isSandboxGuestEmail(pres.ownerEmail)) return false;
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
