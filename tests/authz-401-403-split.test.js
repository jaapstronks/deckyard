/**
 * The 401/403 split (B172, decision D68).
 *
 * One rule, stated in `docs/reference/api-error-format.md`
 * § _401 versus 403_:
 *
 *   - **401 `unauthorized`** — there is no valid identity: no session cookie,
 *     an unparseable one, a session that resolves to no user, wrong
 *     credentials on a login. The fix is to authenticate.
 *   - **403 `forbidden`** — the identity is fine, the permission is not. Every
 *     `can…` / `is…Admin` / role / collaborator-ladder refusal, and every
 *     feature that is switched off for this instance. Authenticating again
 *     changes nothing.
 *
 * `#970` deliberately kept 401 for the second case; D68 (2026-08-25) overturned
 * that, because the two answers were being minted from the same guard shape in
 * neighbouring files (a theme mutation 403'd where the identical font-family
 * mutation 401'd).
 *
 * This gate reads the sources rather than driving routes, for the same reason
 * `tests/helpers/call-sites.js` exists: a behavioural test only sees the guards
 * some test happens to exercise, and the claim here is about *every* guard.
 * For each `unauthorized(` call under the scanned roots it reads back over the
 * guard it sits in — up to eight lines, stopping at a blank line, which is
 * enough for the dominant multi-line shape
 * (`if (\n  !canReadPresentation({ … })\n) {\n  return unauthorized(res);`)
 * and short enough not to swallow the previous statement — and asserts that
 * guard asks "who are you?", never "may you?". Bracket-balanced backtracking
 * is no use here: the conditions carry object literals, so the nearest `}`
 * going backwards is usually inside the condition itself.
 *
 * The two answers are also layered, and the layering is what makes a bare
 * `forbidden(res)` correct inside an authorization guard: the single login gate
 * in `server/routes/api/index.js` answers 401 for a caller with no identity, so
 * every guard dispatched below it is judging someone already identified. The
 * second test pins that gate.
 *
 * Run with: node --test tests/authz-401-403-split.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkJsFiles } from './helpers/call-sites.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where a session-authenticated caller's refusals are minted. The public
 * `/api/v1` surface (`server/routes/public-api`) and MCP (`server/mcp`) answer
 * in their own envelopes and already keep the split — see the doc section.
 */
const SCANNED_ROOTS = ['server/routes/api', 'server/utils', 'server/export'];

/**
 * Marks of a "may you?" question. A guard whose condition contains one of these
 * is judging permission, so its refusal is a 403.
 *
 * @type {RegExp[]}
 */
const PERMISSION_PREDICATES = [
  /\bcan[A-Z]\w*\s*\(/, // canReadPresentation(, canManage(, canGuestComment(…
  /\bcanManage\b/,
  /\bisAdmin\b/, // authedUser.isAdmin, ctx.authedUser.isAdmin
  /\bisDesigner\b/,
  /\bisOrganizationAdmin\s*\(/,
  /\bisPresentationAuthor\s*\(/,
  /\bcanRead\b|\bcanWrite\b|\bcanComment\b|\bcanEdit\b|\bcanDelete\b/,
];

/** How many lines back a guard's condition may reach. */
const GUARD_WINDOW = 8;

/**
 * The guard text a call sits in: its own line plus up to `GUARD_WINDOW` lines
 * before it, cut short at a blank line (which separates statements in this
 * codebase).
 *
 * @param {string[]} lines - File split on newlines.
 * @param {number} lineNo - 1-indexed line of the call.
 * @returns {string} The guard text.
 */
function enclosingGuard(lines, lineNo) {
  const out = [lines[lineNo - 1]];
  for (let i = lineNo - 2; i >= 0 && out.length <= GUARD_WINDOW; i--) {
    if (lines[i].trim() === '') break;
    out.unshift(lines[i]);
  }
  return out.join('\n');
}

/** Every `unauthorized(` call site under the scanned roots. */
function unauthorizedCallSites() {
  const sites = [];
  for (const root of SCANNED_ROOTS) {
    for (const file of walkJsFiles(join(repoRoot, root))) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      const re = /\bunauthorized\s*\(/g;
      let m;
      while ((m = re.exec(src))) {
        const line = src.slice(0, m.index).split('\n').length;
        // Skip JSDoc examples: they document the shape, they do not answer.
        if (lines[line - 1].trimStart().startsWith('*')) continue;
        sites.push({
          file: relative(repoRoot, file),
          line,
          stmt: enclosingGuard(lines, line),
        });
      }
    }
  }
  return sites;
}

test('no authorization guard answers 401: "may you?" is always a 403', () => {
  const offenders = unauthorizedCallSites()
    .filter(({ stmt }) => PERMISSION_PREDICATES.some((re) => re.test(stmt)))
    .map(({ file, line }) => `${file}:${line}`);

  assert.deepEqual(
    offenders,
    [],
    'a permission check refuses with forbidden(res), never unauthorized(res) — ' +
      'see docs/reference/api-error-format.md § 401 versus 403',
  );
});

test('the guard would catch a permission check that answered 401 again', () => {
  // The three shapes the tree actually used before B172.
  const shapes = [
    [
      '  if (!canWritePresentation({ user: authedUser, pres }))',
      '    return unauthorized(res);',
    ],
    [
      '  if (',
      '    !canReadPresentation({ user: authedUser, pres, collaboratorPermission })',
      '  ) {',
      '    return unauthorized(res);',
    ],
    ['  if (!canManage(authedUser)) return unauthorized(res);'],
  ];

  for (const lines of shapes) {
    const stmt = enclosingGuard(lines, lines.length);
    assert.ok(
      PERMISSION_PREDICATES.some((re) => re.test(stmt)),
      `the scanner reaches the condition in:\n${lines.join('\n')}`,
    );
  }
});

test('the login gate is the only 401 an unidentified /api caller gets', () => {
  const src = readFileSync(
    join(repoRoot, 'server/routes/api/index.js'),
    'utf8',
  );

  assert.match(
    src,
    /if \(!sandboxEnabled\(\) && authEnabled\(\) && !authedUser\)\s*\n?\s*return unauthorized\(res\);/,
    'the gate in handleApi answers 401 before any route below it runs',
  );

  const gateIdx = src.indexOf('return unauthorized(res);');
  const dispatchIdx = src.indexOf('if (await handleLiveSessions(ctx)) return;');
  assert.ok(
    gateIdx > 0 && dispatchIdx > gateIdx,
    'and it runs before dispatch',
  );
});
