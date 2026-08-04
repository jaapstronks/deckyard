/**
 * Source-level call-site inspection for guard tests.
 *
 * Some contracts are shaped as "this function takes exactly these arguments,
 * and a further one would be the thing we just removed creeping back". A
 * behavioural test cannot see a call site that no test exercises, so those
 * contracts are guarded by reading the sources. Two guards use this now:
 * `getCollaboratorPermission` (the deck is the scope — see
 * `tests/collaborator-cross-org-endpoints.test.js`) and the share-link access
 * log (the link is the scope — see `tests/share-link-access-log-scope.test.js`).
 *
 * This is a bracket-depth scanner, not a parser: it is exact about argument
 * counts for ordinary calls, including nested calls and object literals, and it
 * does not try to understand strings containing brackets. Both guards ship a
 * self-test ("the guard would catch a re-introduced argument") so a change here
 * that blinds them fails loudly.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Every `.js` file under a directory, recursively.
 * @param {string} dir - Directory to walk.
 * @param {string[]} [out] - Accumulator.
 * @returns {string[]} Absolute paths.
 */
export function walkJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * The arguments of every `<fn>(...)` call in a source file, split on top-level
 * commas. Scans by bracket depth so an object literal or a nested call in an
 * argument does not split the list. An `import { fn }` has no following `(`, so
 * imports never match.
 *
 * @param {string} source - File contents.
 * @param {string} fn - Function name to find calls of.
 * @returns {string[][]} One entry per call site, each the trimmed arguments.
 */
export function callArguments(source, fn) {
  const calls = [];
  const pattern = new RegExp(`${fn}\\s*\\(`, 'g');
  let match;
  while ((match = pattern.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    let current = '';
    const args = [];
    while (depth > 0 && i < source.length) {
      const c = source[i];
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) depth -= 1;
      if (depth === 0) break;
      if (c === ',' && depth === 1) {
        args.push(current.trim());
        current = '';
      } else {
        current += c;
      }
      i += 1;
    }
    args.push(current.trim());
    calls.push(args.filter((a) => a !== ''));
  }
  return calls;
}
