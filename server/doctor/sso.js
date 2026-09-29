/**
 * Doctor checks for single sign-on: the config boot accepts, the callback
 * the IdP must know, and whether the issuer answers at all.
 *
 * Boot never contacts the IdP, so an unreachable or mistyped issuer shows only
 * at the first login. That is the one check here that boot has no twin for.
 */

import { envBool } from '../config/utils.js';
import {
  checkOidcRedirectUri,
  getOidcConfig,
  ssoConfigError,
} from '../config/sso.js';
import { ok, warn, fail, skip } from './finding.js';

/** How long the issuer gets to answer its discovery document. */
const DISCOVERY_TIMEOUT_MS = 5000;

/** @type {import('./finding.js').DoctorCheck} */
export const ssoConfigCheck = {
  id: 'sso-config',
  label: 'SSO config',
  run() {
    if (!envBool('SSO_ENABLED')) return skip('SSO_ENABLED is not set');
    const err = ssoConfigError();
    if (err) return fail(err);
    // A warning, as at boot: a reverse proxy may rewrite the callback.
    const redirect = checkOidcRedirectUri();
    if (!redirect.ok) return warn(redirect.message);
    return ok(`callback ${redirect.expected}`);
  },
};

/**
 * @typedef {import('./finding.js').DoctorContext & {
 *   fetch?: typeof globalThis.fetch,
 * }} SsoContext
 */

/** @type {import('./finding.js').DoctorCheck} */
export const oidcDiscoveryCheck = {
  id: 'oidc-discovery',
  label: 'OIDC issuer',
  /** @param {SsoContext} ctx */
  async run({ results, fetch = globalThis.fetch }) {
    if (results.get('sso-config')?.status === 'skip') {
      return skip('SSO_ENABLED is not set');
    }
    if (results.get('sso-config')?.status === 'fail') {
      return skip('SSO config is incomplete');
    }
    const issuer = getOidcConfig().issuerUrl.replace(/\/+$/, '');
    const url = `${issuer}/.well-known/openid-configuration`;
    const fix =
      'Check OIDC_ISSUER_URL: it is the issuer itself (ZITADEL: the instance URL, Keycloak: …/realms/<realm>), and this host must reach it.';
    let doc;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) return fail(`${url} answered HTTP ${res.status}.`, fix);
      doc = await res.json();
    } catch (err) {
      const cause = err?.cause?.code || err?.cause?.message;
      return fail(
        `${url} did not answer: ${err?.message || err}${cause ? ` (${cause})` : ''}.`,
        fix,
      );
    }
    const announced = String(doc?.issuer || '').replace(/\/+$/, '');
    if (announced !== issuer) {
      return fail(
        `The discovery document names issuer "${doc?.issuer ?? ''}", not OIDC_ISSUER_URL "${issuer}"; token validation would refuse every login.`,
        'Set OIDC_ISSUER_URL to exactly the issuer the document names.',
      );
    }
    return ok(issuer);
  },
};
