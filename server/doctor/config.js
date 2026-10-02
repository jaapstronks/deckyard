/**
 * Doctor checks that read configuration only: no network, no database.
 *
 * Each one asks the function boot asks (`authConfigError()`,
 * `storageModeError()`, …), so the doctor and `server.js` cannot disagree
 * about what is fatal. What boot only warns about stays a warning here.
 */

import fs from 'node:fs/promises';

import {
  authConfigError,
  authConfigWarnings,
  devBypassProductionError,
} from '../auth/auth.js';
import { storageModeError } from '../config/database.js';
import { envBool, envStr, getAppBaseUrl } from '../config/utils.js';
import { customDirFor } from '../../shared/custom-root.js';
import { isProduction, ok, warn, fail, skip } from './finding.js';

/** @type {import('./finding.js').DoctorCheck} */
export const authCheck = {
  id: 'auth',
  label: 'Authentication',
  run() {
    const err = devBypassProductionError() || authConfigError();
    if (err) return fail(err);
    const [weak] = authConfigWarnings();
    if (weak) return warn(weak);
    // An explicit opt-out boot accepts (auth in a proxy in front, say); the
    // doctor names it so nobody ships it by accident.
    if (!envBool('AUTH_ENABLED', true)) {
      return warn(
        'AUTH_ENABLED=false: everyone who reaches this URL is admin.',
        'Set AUTH_SECRET (32+ random characters) and remove AUTH_ENABLED=false, unless a proxy in front authenticates.',
      );
    }
    return ok('AUTH_SECRET set, auth enabled');
  },
};

/** @type {import('./finding.js').DoctorCheck} */
export const publicUrlCheck = {
  id: 'public-url',
  label: 'Public URL',
  run() {
    const base = getAppBaseUrl();
    if (!base) {
      const message =
        'Neither APP_URL nor DOMAIN is set; share links, e-mail links and the SSO callback have no origin.';
      const fix =
        'Set APP_URL to the public origin, e.g. https://slides.example.com';
      return isProduction() ? fail(message, fix) : warn(message, fix);
    }
    if (!URL.canParse(base)) {
      return fail(
        `APP_URL="${base}" is not a valid absolute URL.`,
        'Set APP_URL to the public origin, e.g. https://slides.example.com',
      );
    }
    const url = new URL(base);
    const appUrl = envStr('APP_URL');
    const domain = envStr('DOMAIN');
    if (appUrl && domain && url.host !== domain) {
      return fail(
        `APP_URL (${url.host}) and DOMAIN (${domain}) name different hosts; APP_URL wins, so DOMAIN-based config (Caddy, TLS) serves another host than the links point at.`,
        'Make them name the same host, or drop DOMAIN when TLS is terminated elsewhere.',
      );
    }
    if (url.protocol !== 'https:') {
      const message = `${url.origin} is not https; session cookies and SSO need TLS in production.`;
      const fix = 'Serve over TLS and set APP_URL to the https:// origin.';
      return isProduction() ? fail(message, fix) : warn(message, fix);
    }
    return ok(url.origin);
  },
};

/** @type {import('./finding.js').DoctorCheck} */
export const trustProxyCheck = {
  id: 'trust-proxy',
  label: 'Client address',
  run() {
    if (envBool('TRUST_PROXY')) {
      return ok('TRUST_PROXY: the client address comes from X-Forwarded-For');
    }
    // The server speaks no TLS itself, so an https origin means a proxy in
    // front; without TRUST_PROXY every request carries the proxy's address and
    // the login throttle and audit log see one client. A warning, not a
    // failure: the app works, and only the operator knows the proxy is theirs.
    const base = getAppBaseUrl();
    if (!base || !URL.canParse(base) || new URL(base).protocol !== 'https:') {
      return skip('no https origin, so no proxy in front to trust');
    }
    return warn(
      `${new URL(base).origin} is served over https, so through a proxy, but TRUST_PROXY is not set: the login throttle and the audit log see the proxy's address for every user.`,
      'Set TRUST_PROXY=true when the proxy in front is yours and the app port is reachable only through it.',
    );
  },
};

/** @type {import('./finding.js').DoctorCheck} */
export const storageModeCheck = {
  id: 'storage-mode',
  label: 'Storage mode',
  run() {
    const err = storageModeError();
    return err ? fail(err) : ok('postgres');
  },
};

/** @type {import('./finding.js').DoctorCheck} */
export const customDirCheck = {
  id: 'custom-dir',
  label: 'Fork directory',
  /**
   * @param {import('./finding.js').DoctorContext & { customDir?: string, override?: boolean }} ctx
   *   `customDir`/`override` are test seams: the override is fixed at import.
   */
  async run({
    repoRoot,
    customDir = customDirFor(repoRoot),
    override = Boolean(envStr('DECKYARD_CUSTOM_DIR')),
  }) {
    const dir = customDir;
    let stat = null;
    try {
      stat = await fs.stat(dir);
    } catch (err) {
      // Absent is a finding below; anything else (EACCES) is its own.
      if (err.code !== 'ENOENT') return fail(`${dir}: ${err.message}`);
    }
    if (stat?.isDirectory()) return ok(dir);
    if (!override) return skip(`no ${dir}; running core only`);
    return fail(
      stat
        ? `DECKYARD_CUSTOM_DIR=${dir} is not a directory.`
        : `DECKYARD_CUSTOM_DIR=${dir} does not exist; the fork's themes, styles and slide types are not loaded.`,
      'Point DECKYARD_CUSTOM_DIR at the absolute path of the fork directory, or unset it to use ./custom.',
    );
  },
};
