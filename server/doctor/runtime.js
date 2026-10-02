/**
 * Doctor checks for what the running server leans on beyond its config:
 * a browser for exports, somewhere to write uploads, a way to send mail.
 */

import { envBool, envStr } from '../config/utils.js';
import { isUploadsEnabled } from '../config/features.js';
import { isSsoEnforced } from '../config/sso.js';
import { privateMediaDir, uploadsDir } from '../config/storage-paths.js';
import {
  getEffectiveMediaProvider,
  mediaConfigWarnings,
} from '../media/config.js';
import { resolveChromeExecutablePath } from '../utils/puppeteer-browser.js';
import { ok, warn, fail, skip } from './finding.js';

/**
 * @typedef {import('./finding.js').DoctorContext & {
 *   importPuppeteer?: () => Promise<unknown>,
 *   resolveChrome?: () => Promise<string>,
 * }} ChromiumContext
 */

/** @type {import('./finding.js').DoctorCheck} */
export const chromiumCheck = {
  id: 'chromium',
  label: 'Export browser',
  /** @param {ChromiumContext} ctx */
  async run({
    importPuppeteer = () => import('puppeteer-core'),
    resolveChrome = resolveChromeExecutablePath,
  }) {
    try {
      await importPuppeteer();
    } catch {
      return fail(
        'puppeteer-core is not installed; PDF, PNG and thumbnail exports fail.',
        'Install optional dependencies (npm ci without --omit=optional).',
      );
    }
    const path = await resolveChrome();
    if (!path) {
      return fail(
        'No Chrome or Chromium found; PDF, PNG and thumbnail exports fail.',
        'Install Chromium (the Docker image has it), or set PUPPETEER_EXECUTABLE_PATH.',
      );
    }
    // The resolver falls back to the usual install paths, so a configured
    // path that is not there only shows as a different browser than meant.
    const configured =
      envStr('PUPPETEER_EXECUTABLE_PATH') || envStr('CHROME_BIN');
    if (configured && configured !== path) {
      return warn(
        `${configured} is not an executable; exports use ${path} instead.`,
        'Fix PUPPETEER_EXECUTABLE_PATH (or CHROME_BIN), or unset it.',
      );
    }
    return ok(path);
  },
};

/** One transparent pixel: the smallest body every provider accepts. */
const PROBE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * The two places a provider writes, each probed on its own: on the local
 * provider they are two directories (`uploadsDir()` for images every deck
 * links, `<DATA_DIR>/private-media` for font variants), so a writable volume
 * on one says nothing about the other. The public probe is one transparent
 * pixel at an unguessable key, deleted again straight after.
 * @type {readonly { name: string, dir: (repoRoot: string) => string,
 *   write: (provider: import('../media/interface.js').MediaProvider) => Promise<{ key: string }> }[]}
 */
const UPLOAD_PROBES = Object.freeze([
  {
    name: 'uploads',
    dir: uploadsDir,
    write: (provider) =>
      provider.uploadBuffer({
        buffer: PROBE_PNG,
        filename: 'doctor-probe',
        contentType: 'image/png',
        optimize: false,
      }),
  },
  {
    name: 'private media',
    dir: privateMediaDir,
    write: (provider) =>
      provider.uploadPrivateBuffer({
        buffer: PROBE_PNG,
        filename: 'doctor-probe',
        contentType: 'image/png',
        folder: 'doctor',
      }),
  },
]);

/**
 * Write, read back and delete one probe.
 * @param {(typeof UPLOAD_PROBES)[number]} probe
 * @param {import('../media/interface.js').MediaProvider} provider
 * @param {string} mode
 * @param {string} repoRoot
 * @returns {Promise<import('./finding.js').DoctorFinding|null>} null when it round-trips
 */
async function runUploadProbe(probe, provider, mode, repoRoot) {
  const where =
    mode === 's3' ? probe.name : `${probe.name} (${probe.dir(repoRoot)})`;
  const writable =
    mode === 's3'
      ? 'Check S3_ENDPOINT, S3_BUCKET and that the key may put, get and delete objects.'
      : `Make ${probe.dir(repoRoot)} writable by the server user (a persistent volume in a container).`;
  let key = '';
  /** @type {import('./finding.js').DoctorFinding|null} */
  let failed = null;
  try {
    ({ key } = await probe.write(provider));
    const back = await provider.readFile(key);
    if (!back?.equals(PROBE_PNG)) {
      failed = fail(
        `${mode}: wrote a probe to ${where} but read back something else.`,
      );
    }
  } catch (err) {
    failed = fail(
      `${mode}: could not write a probe to ${where}: ${err?.message || err}.`,
      writable,
    );
  }
  const removed = key
    ? await provider.deleteFile(key).catch((err) => err)
    : true;
  if (failed) return failed;
  if (removed !== true) {
    return fail(
      `${mode}: wrote and read a probe but could not delete ${key}${
        removed instanceof Error ? `: ${removed.message}` : ''
      }; replacing and removing media will fail.`,
      mode === 's3'
        ? 'Give the key permission to delete objects, then remove the probe by hand.'
        : `Make ${probe.dir(repoRoot)} writable by the server user, then remove the probe by hand.`,
    );
  }
  return null;
}

/**
 * @typedef {import('./finding.js').DoctorContext & {
 *   provider?: import('../media/interface.js').MediaProvider,
 * }} UploadsContext
 */

/** @type {import('./finding.js').DoctorCheck} */
export const uploadsCheck = {
  id: 'uploads',
  label: 'Uploads',
  /** @param {UploadsContext} ctx */
  async run({ repoRoot, provider }) {
    if (!isUploadsEnabled()) return skip('uploads are disabled');
    const mode = getEffectiveMediaProvider();
    const [configWarning] = mediaConfigWarnings();
    if (!provider) {
      const { initializeMediaProvider, getMediaProvider } =
        await import('../media/index.js');
      await initializeMediaProvider(repoRoot);
      provider = getMediaProvider();
    }
    for (const probe of UPLOAD_PROBES) {
      const failed = await runUploadProbe(probe, provider, mode, repoRoot);
      if (failed) return failed;
    }
    if (configWarning) return warn(configWarning);
    return ok(
      mode === 's3'
        ? 's3: write, read and delete work for uploads and private media'
        : `${mode}: write, read and delete work in ${UPLOAD_PROBES.map((p) => p.dir(repoRoot)).join(' and ')}`,
    );
  },
};

/** @type {import('./finding.js').DoctorCheck} */
export const mailCheck = {
  id: 'mail',
  label: 'Outgoing mail',
  run() {
    if (envStr('BREVO_API_KEY')) return ok('Brevo');
    if (!envBool('AUTH_ENABLED', true)) return skip('auth is disabled');
    // A warning, never a failure: password and SSO sign-in work without mail,
    // and an SSO-only install needs none. Choosing a transport, or none
    // explicitly, is B434's; this check follows it there.
    return warn(
      isSsoEnforced()
        ? 'No mail transport: invitations and notifications are not sent (sign-in is SSO-only and unaffected).'
        : 'No mail transport: magic links, invitations, password resets and notifications are not sent.',
      'Set BREVO_API_KEY and BREVO_SENDER_EMAIL.',
    );
  },
};
