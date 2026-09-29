/**
 * The shape every doctor check returns, and the constructors that build it.
 *
 * A check answers one question about an installation and says what to do when
 * the answer is wrong: `fail` blocks a production deploy, `warn` works but
 * should be fixed, `skip` means the check does not apply to this install
 * (SSO off, no fork directory), `ok` carries what was found.
 */

import { envStr } from '../config/utils.js';

/** @typedef {'ok'|'warn'|'fail'|'skip'} DoctorStatus */

/**
 * @typedef {object} DoctorFinding
 * @property {DoctorStatus} status
 * @property {string} message - What was found; the fix itself when none is given.
 * @property {string} [fix] - What to change, when `message` does not say it.
 */

/**
 * @typedef {object} DoctorContext
 * @property {string} repoRoot - Installation root.
 * @property {Map<string, DoctorFinding>} results - Findings of the checks that ran before.
 */

/**
 * @typedef {object} DoctorCheck
 * @property {string} id - Stable machine id, the key in `--json` output.
 * @property {string} label - Human label for the report line.
 * @property {(ctx: DoctorContext) => DoctorFinding|Promise<DoctorFinding>} run
 */

/**
 * Whether this is a production run. The container sets NODE_ENV=production;
 * a checkout does not, so there the checks that only matter in production warn.
 * @returns {boolean}
 */
export function isProduction() {
  return envStr('NODE_ENV') === 'production';
}

/** @param {string} message @returns {DoctorFinding} */
export const ok = (message) => ({ status: 'ok', message });

/** @param {string} message @returns {DoctorFinding} */
export const skip = (message) => ({ status: 'skip', message });

/** @param {string} message @param {string} [fix] @returns {DoctorFinding} */
export const warn = (message, fix) =>
  fix ? { status: 'warn', message, fix } : { status: 'warn', message };

/** @param {string} message @param {string} [fix] @returns {DoctorFinding} */
export const fail = (message, fix) =>
  fix ? { status: 'fail', message, fix } : { status: 'fail', message };
