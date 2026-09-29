/**
 * `npm run doctor`: check an installation's configuration without starting it.
 *
 * One line per check, green or red, and for red the fix. The checks ask the
 * functions boot asks, so the doctor never disagrees with `server.js` about
 * what is fatal; it only adds what boot cannot know until the first user
 * (the IdP answers, uploads are writable, a browser for exports exists).
 *
 * Runbook: docs/ops/doctor.md.
 */

import {
  authCheck,
  customDirCheck,
  publicUrlCheck,
  storageModeCheck,
} from './config.js';
import { databaseCheck, migrationsCheck } from './database.js';
import { oidcDiscoveryCheck, ssoConfigCheck } from './sso.js';
import { themesCheck } from './themes.js';
import { chromiumCheck, mailCheck, uploadsCheck } from './runtime.js';

/**
 * Every check, in the order it runs. A check may read the findings of the ones
 * before it (`migrations` skips when `database` did not pass).
 * @type {readonly import('./finding.js').DoctorCheck[]}
 */
export const DOCTOR_CHECKS = Object.freeze([
  authCheck,
  publicUrlCheck,
  storageModeCheck,
  databaseCheck,
  migrationsCheck,
  ssoConfigCheck,
  oidcDiscoveryCheck,
  customDirCheck,
  themesCheck,
  chromiumCheck,
  uploadsCheck,
  mailCheck,
]);

/**
 * @typedef {import('./finding.js').DoctorFinding & { id: string, label: string }} DoctorResult
 */

/**
 * Run the checks in order. A check that throws is a red line with its error,
 * not a crash: the operator still gets every other answer.
 * @param {object} options
 * @param {string} options.repoRoot
 * @param {readonly import('./finding.js').DoctorCheck[]} [options.checks]
 * @param {object} [options.deps] - Per-check test seams, passed in the context.
 * @returns {Promise<DoctorResult[]>}
 */
export async function runDoctor({
  repoRoot,
  checks = DOCTOR_CHECKS,
  deps = {},
}) {
  /** @type {Map<string, import('./finding.js').DoctorFinding>} */
  const results = new Map();
  /** @type {DoctorResult[]} */
  const report = [];
  for (const check of checks) {
    let finding;
    try {
      finding = await check.run({ ...deps, repoRoot, results });
    } catch (err) {
      finding = {
        status: 'fail',
        message: `check crashed: ${err?.message || err}`,
      };
    }
    results.set(check.id, finding);
    report.push({ id: check.id, label: check.label, ...finding });
  }
  return report;
}

const MARKS = Object.freeze({ ok: '✓', warn: '!', fail: '✗', skip: '-' });

/**
 * Render the report: one line per check, the fix indented under it.
 * @param {DoctorResult[]} report
 * @returns {string}
 */
export function formatDoctorReport(report) {
  const width = Math.max(...report.map(({ label }) => label.length));
  const lines = [];
  for (const { status, label, message, fix } of report) {
    const [first, ...rest] = message.split('\n');
    lines.push(`${MARKS[status]} ${label.padEnd(width)}  ${first}`);
    for (const line of rest) lines.push(`  ${' '.repeat(width)}  ${line}`);
    if (fix) lines.push(`  ${' '.repeat(width)}  fix: ${fix}`);
  }
  const count = (s) => report.filter(({ status }) => status === s).length;
  lines.push(
    '',
    `${count('fail')} failed, ${count('warn')} warning${count('warn') === 1 ? '' : 's'}, ${count('ok')} passed, ${count('skip')} skipped.`,
  );
  return lines.join('\n');
}

/**
 * The process exit code: 1 when any check failed, so a deploy step can gate
 * on it. Warnings do not fail.
 * @param {DoctorResult[]} report
 * @returns {0|1}
 */
export function doctorExitCode(report) {
  return report.some(({ status }) => status === 'fail') ? 1 : 0;
}
