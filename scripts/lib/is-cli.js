/**
 * "Was this module run as a script, or imported?"
 *
 * There is one correct way to ask and the repo had three. `pathToFileURL`, not
 * a template literal and not a path comparison: the repo path may contain
 * spaces (or any other character a URL escapes), which `import.meta.url`
 * percent-encodes and a raw `file://${process.argv[1]}` does not. The two
 * spellings that compared strings — `process.argv[1] === __filename` in
 * `i18n-sync.js` and `i18n-validate.js` — did nothing at all under such a path:
 * the script ran, matched nothing, and exited 0 having checked nothing.
 *
 * @module scripts/lib/is-cli
 */

import { pathToFileURL } from 'node:url';

/**
 * Whether `moduleUrl` is the entry point Node was started with.
 *
 * @param {string} moduleUrl - the caller's `import.meta.url`
 * @returns {boolean}
 */
export function isCli(moduleUrl) {
  return Boolean(
    process.argv[1] && moduleUrl === pathToFileURL(process.argv[1]).href,
  );
}
