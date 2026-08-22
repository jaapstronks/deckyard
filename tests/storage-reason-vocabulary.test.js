/**
 * The `reason` vocabulary gate (B104).
 *
 * `server/storage/reasons.js` is the one place a storage `reason` code is
 * minted. This file is what makes that true rather than aspirational: it parses
 * every `{ ok: false, reason: '<literal>' }` under `server/storage/**`,
 * `server/routes/api/**` and `shared/**` and asserts the code is in `REASONS`.
 * **The allowlist is
 * empty and stays empty** — there is no burndown here, because there is nothing
 * left to burn down. A new code is added to the register or it does not exist.
 *
 * That replaces rule (d) of `tests/storage-call-convention.test.js`, which was a
 * flat three-needle blocklist and said so itself: *"it stops the three known
 * losers coming back, it cannot judge a new one."* This one judges every one.
 *
 * Four more rules keep the register itself honest:
 *
 *   - **shape** — a reason is a `snake_case` token, never prose and never
 *     `camelCase`. Both used to live in the tree (`'No device id provided'`,
 *     `bad_slideIndex`), and prose in `reason` reaches the wire as the
 *     machine-readable `error` code that clients branch on.
 *   - **kind/status agreement** — `kind: 'ours'` means 5xx and `kind: 'caller'`
 *     means 4xx. The pair is the whole point of B104: 65 codes used to fall
 *     through to a `400` default, so a failed insert reported as the caller's
 *     malformed request and never reached a dashboard watching 5xx.
 *   - **liveness** — every code in the register is actually minted somewhere
 *     under `server/`. A register that accumulates codes nobody emits is the
 *     same drift in the other direction (`already_requested` was one).
 *   - **no route-local default** — `getErrorStatus(reason)` takes exactly one
 *     argument. The old `getErrorStatus(reason, 500)` habit put the
 *     caller-vs-ours decision at the call site, which is precisely where it
 *     disagreed with itself.
 *
 * Two more rules (PR 2) keep the routes from re-deciding what the register
 * already decided:
 *
 *   - **no `badRequest(res, <reason>)`** — that form puts the snake_case reason
 *     in the human `message` field under a `bad_request` code, the exact
 *     inversion `docs/reference/api-error-format.md` forbids, and answers 400
 *     for a failed insert. Hard zero, no exceptions.
 *   - **no hand-written status ladder** — a `reason === '<code>'` branch that
 *     picks a status. The branches that read a reason for something else (a
 *     message, a payload, another vocabulary entirely) are listed in
 *     `REASON_BRANCH_EXCEPTIONS` with why; `REASON_BRANCH_BURNDOWN` is
 *     shrink-only and, since D52(b), empty.
 *
 * `shared/**` is in scope because `shared/slide-types/usage.js` mints
 * `invalid` (with `field: 'usage'`) / `usage_too_long` and
 * `createCustomSlideType` hands them straight back, so they reach the wire as
 * storage reasons like any other.
 *
 * **Four namespaces are deliberately out of scope**, because they answer to
 * something other than `getErrorStatus`:
 *
 *   - `server/routes/public-api/**` — the public `/api/v1/*` surface has its own
 *     openapi-documented schema, produced through `sendV1Error`
 *     (`docs/reference/api-error-format.md` § Scope). Its one
 *     `{ ok: false, reason: 'missing_auth' }` is an internal "the response is
 *     already sent" signal between middleware and handler.
 *   - `server/integrations/email/core.js` — the mail sender's own
 *     `not_configured` / `upstream`, which its callers map to 501 / 502.
 *   - `server/utils/sse-limiter.js` — `global` / `per-ip` name *which* limit
 *     bit, not an HTTP outcome.
 *   - `server/services/access-notifications.js` and `server/mcp/sse.js` — both
 *     fire-and-forget; neither reason reaches a response.
 *
 * A `reason` column also exists on the presentation-version audit trail
 * (`'pre_merge'`, `'snapshot'`, `'session_end'`). The scanner never sees it: it
 * only reads objects with a literal `ok: false`.
 *
 * Run with: node --test tests/storage-reason-vocabulary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REASONS, reasonCodes } from '../server/storage/reasons.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED_ROOTS = ['server/storage', 'server/routes/api', 'shared'];

/**
 * Codes minted outside the register that this gate tolerates.
 *
 * It is empty, and adding a line to it is not a fix — it is the tolerance this
 * item exists to remove. Put the code in `server/storage/reasons.js` instead.
 *
 * @type {string[]}
 */
const ALLOWLIST = [];

// ─── scanner ────────────────────────────────────────────────────────────────

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.js')) yield p;
  }
}

/** The property name of an AST `Property`, for identifier and string keys alike. */
function propName(prop) {
  if (prop.type !== 'Property') return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal') return String(prop.key.value);
  return null;
}

/**
 * The string literals a reason expression can evaluate to.
 *
 * A plain literal is the common case. `a.reason || 'write_failed'` and
 * `x ? 'share_link_revoked' : y.reason` mint a code too — the fallback arm is a
 * literal, so the gate looks through `||`/`??` and `?:` rather than writing the
 * whole expression off as dynamic. Anything else (a bare identifier, a member
 * read) forwards another call's reason and was judged where that call minted
 * it.
 *
 * @param {import('acorn').Node} node
 * @returns {string[]}
 */
function mintedLiterals(node) {
  if (!node) return [];
  if (node.type === 'Literal') {
    return typeof node.value === 'string' ? [node.value] : [];
  }
  if (node.type === 'LogicalExpression') {
    return [...mintedLiterals(node.left), ...mintedLiterals(node.right)];
  }
  if (node.type === 'ConditionalExpression') {
    return [
      ...mintedLiterals(node.consequent),
      ...mintedLiterals(node.alternate),
    ];
  }
  return [];
}

/**
 * Every reason code minted in an `{ ok: false, … }` object literal under the
 * scanned roots, as `{ code, where }`.
 *
 * Only `reason` is read, because after B104 PR 3 that is the only spelling: the
 * share-access validators in `routes/api/analytics-track.js` answered
 * `{ ok: false, code, message }` from the same vocabulary until then. Objects
 * without a literal `ok: false` are skipped — `reason` is also a column on the
 * presentation-version audit trail (`'pre_merge'`, `'snapshot'`), a different
 * namespace that never reaches an HTTP status.
 *
 * @returns {{code: string, field?: string, where: string}[]}
 */
function scanMintedReasons() {
  const minted = [];
  for (const root of SCANNED_ROOTS) {
    for (const file of walk(join(repoRoot, root))) {
      const rel = relative(repoRoot, file).replace(/\\/g, '/');
      const ast = parse(readFileSync(file, 'utf8'), {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
      });
      (function visit(node) {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'ObjectExpression') {
          const props = node.properties.filter((p) => p.type === 'Property');
          const okProp = props.find((p) => propName(p) === 'ok');
          const isFailure =
            okProp?.value.type === 'Literal' && okProp.value.value === false;
          if (isFailure) {
            const fieldProp = props.find((p) => propName(p) === 'field');
            const field =
              fieldProp && fieldProp.value.type === 'Literal'
                ? String(fieldProp.value.value)
                : fieldProp
                  ? '<dynamic>'
                  : undefined;
            for (const prop of props) {
              if (propName(prop) !== 'reason') continue;
              for (const code of mintedLiterals(prop.value)) {
                minted.push({
                  code,
                  field,
                  where: `${rel}:${prop.loc.start.line}`,
                });
              }
            }
          }
        }
        for (const key of Object.keys(node)) {
          if (
            key === 'type' ||
            key === 'start' ||
            key === 'end' ||
            key === 'loc'
          )
            continue;
          const value = node[key];
          if (Array.isArray(value)) {
            for (const child of value) {
              if (child && typeof child.type === 'string') visit(child);
            }
          } else if (value && typeof value.type === 'string') {
            visit(value);
          }
        }
      })(ast);
    }
  }
  return minted;
}

// ─── the gate ────────────────────────────────────────────────────────────────

test('every minted reason is in the REASONS register', () => {
  const allowed = new Set([...reasonCodes(), ...ALLOWLIST]);
  const unknown = scanMintedReasons()
    .filter(({ code }) => !allowed.has(code))
    .map(({ code, where }) => `${where}: ${code}`)
    .sort();

  assert.deepEqual(
    unknown,
    [],
    'a `reason` is minted in server/storage/reasons.js and nowhere else. ' +
      'Reach for the layer-wide vocabulary first (not_found, invalid, ' +
      'forbidden, unavailable); mint a domain code only when a route or UI ' +
      'acts on the distinction, and never as a second spelling of a meaning ' +
      'that already has one (docs/reference/storage-layer.md ' +
      '§ Failure signalling). The allowlist in this file stays empty.',
  );
});

test('every reason code is a snake_case token', () => {
  const malformed = reasonCodes().filter(
    (code) => !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(code),
  );
  assert.deepEqual(
    malformed,
    [],
    'a reason is a short snake_case token — not prose and not camelCase. It ' +
      'reaches the client as the machine-readable `error` code they branch on ' +
      '(docs/reference/api-error-format.md).',
  );
});

test('kind and status agree: ours is 5xx, the caller is 4xx', () => {
  const disagreeing = Object.entries(REASONS)
    .filter(([, { status, kind }]) =>
      kind === 'ours' ? status < 500 : !(status >= 400 && status < 500),
    )
    .map(([code, { status, kind }]) => `${code}: kind=${kind} status=${status}`)
    .sort();

  assert.deepEqual(
    disagreeing,
    [],
    'a reason that names our own failure must answer 5xx: a 4xx tells the ' +
      'client to fix a request that is not broken, and hides the outage from ' +
      'every error dashboard that watches 5xx.',
  );
});

test('every reason kind is one of the two', () => {
  const bad = Object.entries(REASONS)
    .filter(([, { kind }]) => kind !== 'caller' && kind !== 'ours')
    .map(([code, { kind }]) => `${code}: ${kind}`);
  assert.deepEqual(bad, [], "kind is 'caller' or 'ours'");
});

test('the register carries no dead codes', () => {
  const minted = new Set(scanMintedReasons().map(({ code }) => code));
  const dead = reasonCodes().filter((code) => !minted.has(code));
  assert.deepEqual(
    dead,
    [],
    'every code in the register is minted somewhere under server/. A register ' +
      'that grows codes nobody emits is the same drift pointing the other way ' +
      '(`already_requested` sat in the old ERROR_STATUS_MAP unminted).',
  );
});

test('getErrorStatus takes no route-local default status', () => {
  const offenders = [];
  for (const root of SCANNED_ROOTS) {
    for (const file of walk(join(repoRoot, root))) {
      const rel = relative(repoRoot, file).replace(/\\/g, '/');
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // A second argument to getErrorStatus on one line. The call is always
          // written inline as an argument to jsonError, so it never wraps.
          if (/getErrorStatus\([^)]*,/.test(line))
            offenders.push(`${rel}:${i + 1}`);
        });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'getErrorStatus(reason) takes exactly one argument. The caller-vs-ours ' +
      'decision belongs to the REASONS register, not to the route: the old ' +
      '`getErrorStatus(reason, 500)` / `(reason, 400)` split is how the same ' +
      'reason answered two different statuses on two different routes.',
  );
});

/**
 * Hand-written `reason === '<code>'` branches that are **not** a route picking
 * an HTTP status, keyed `<file> :: <code>` with why they stay.
 *
 * B104 PR 2 converted the status ladders — the six-line
 * not_found/forbidden/else chains that ended in `badRequest(res, reason)` and
 * flattened everything they did not name into a 400. What is left reads a
 * reason for some other purpose, or belongs to a vocabulary that is not this
 * one. Each is a decision, not a leftover; the burndown below is for leftovers.
 */
const REASON_BRANCH_EXCEPTIONS = new Map([
  [
    'server/routes/api/email-templates.js :: not_configured',
    "the mail sender's own vocabulary (server/integrations/email/core.js), which maps to 501/502",
  ],
  [
    'server/routes/api/leads.js :: not_configured',
    'same mail-sender vocabulary; the dev branch echoes a token instead of claiming a mail went out',
  ],
  [
    'server/routes/api/password-reset.js :: invalid_or_expired',
    'picks display copy for the reset link; the status comes from the register',
  ],
  [
    'server/routes/api/magic-link.js :: invalid_or_expired',
    'picks a client-facing slug on a 200 body. Deliberate, not a leftover: D52(c) decided the soft-fail page shape stays — the branch chooses copy, never a status (record: docs/plans/done/decisions.md § Beslist 2026-08-22, D52)',
  ],
  [
    'server/routes/api/share-links/public.js :: revoked',
    'adds the presentation id to the payload; the status is unaffected',
  ],
  [
    'server/routes/api/presentations/slide-locks.js :: unavailable',
    'the release path: "nothing to release because there is no lock backend" is a no-op, not a server error, so editor teardown does not log a 500 on file storage',
  ],
  [
    'server/routes/api/presentations/slide-locks.js :: held',
    'the documented soft-fail policy: only a real conflict is an HTTP error, everything else answers 200 so a single-operator backend does not log phantom 409s',
  ],
  [
    'server/routes/api/presentations/versions.js :: session_end',
    'the presentation-version audit trail, a different `reason` namespace entirely',
  ],
  [
    'server/routes/public-api/v1/middleware.js :: unavailable',
    'the public v1 surface picks its own envelope via sendV1Error',
  ],
]);

/**
 * Real status ladders still standing, shrink-only (the `eslint-suppressions.json`
 * pattern): fixing one means deleting its line, and a new one fails the test.
 *
 * @type {string[]}
 */
const REASON_BRANCH_BURNDOWN = [
  // Empty, and that is the state to hold. The last entry —
  // `public-api/v1/comments.js :: unavailable`, a hand-rolled 503-or-400 —
  // went in D52(b): the status now comes from `getErrorStatus`, and the
  // openapi op grew the `'500'` response that made the move honest. A new
  // line here is a regression, not a to-do.
];

/**
 * Every `<ident>.reason === '<code>'` / `!== '<code>'` branch under
 * `server/routes/**`. Both directions: a negated test picks a status just as
 * effectively as a positive one — the slide-lock release path is that shape.
 */
function scanReasonBranches() {
  const found = [];
  for (const file of walk(join(repoRoot, 'server/routes'))) {
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    readFileSync(file, 'utf8').replace(
      /\breason [!=]== '([a-z_]+)'/g,
      (_m, code) => found.push(`${rel} :: ${code}`),
    );
  }
  return [...new Set(found)].sort();
}

test('no route flattens a storage reason into badRequest', () => {
  const offenders = [];
  for (const file of walk(join(repoRoot, 'server/routes'))) {
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/badRequest\(\s*res,\s*[A-Za-z_$][\w$]*\.?reason\b/.test(line))
          offenders.push(`${rel}:${i + 1}`);
      });
  }
  assert.deepEqual(
    offenders,
    [],
    'badRequest(res, <reason>) puts the snake_case reason in the human ' +
      '`message` field under a `bad_request` code — the exact inversion ' +
      'docs/reference/api-error-format.md forbids, and it answers 400 for a ' +
      'failed insert. Use jsonError(res, getErrorStatus(reason), reason).',
  );
});

test('no route maps a storage reason to a status by hand', () => {
  const allowed = new Set([
    ...REASON_BRANCH_EXCEPTIONS.keys(),
    ...REASON_BRANCH_BURNDOWN,
  ]);
  const fresh = scanReasonBranches().filter((b) => !allowed.has(b));
  assert.deepEqual(
    fresh,
    [],
    'the status for a reason lives in the REASONS register, not in a route. ' +
      'Answer with jsonError(res, getErrorStatus(reason), reason) and keep ' +
      'display copy in a per-route message map (the INVITE_FAILURE_MESSAGES ' +
      'pattern in routes/api/collaborators.js). If the branch reads a reason ' +
      'for something other than a status, add it to REASON_BRANCH_EXCEPTIONS ' +
      'with why.',
  );
});

test('the reason-branch lists name only real branches', () => {
  const present = new Set(scanReasonBranches());
  const stale = [...REASON_BRANCH_EXCEPTIONS.keys(), ...REASON_BRANCH_BURNDOWN]
    .filter((b) => !present.has(b))
    .sort();
  assert.deepEqual(
    stale,
    [],
    'these branches are gone — delete their lines so the lists keep shrinking',
  );
});

test('field rides only on invalid', () => {
  const misplaced = scanMintedReasons()
    .filter(({ code, field }) => field !== undefined && code !== 'invalid')
    .map(({ code, field, where }) => `${where}: ${code} + field=${field}`)
    .sort();

  assert.deepEqual(
    misplaced,
    [],
    '`field` says *which* input was bad, which is only a question `invalid` ' +
      'raises — D48 collapsed the generic `invalid_*` spellings into one ' +
      '`invalid` carrying a field. Every other reason already names its own ' +
      'meaning, and a field there would be a second, quieter vocabulary. ' +
      'Route helpers read `result.field` without checking the reason first ' +
      '(routes/api/font-families.js), so this rule is what keeps that safe.',
  );
});

test('every field is a snake_case token', () => {
  const malformed = [
    ...new Set(
      scanMintedReasons()
        .map(({ field }) => field)
        .filter((f) => f !== undefined),
    ),
  ]
    .filter((f) => !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(f))
    .sort();
  assert.deepEqual(
    malformed,
    [],
    'a field is a literal snake_case token: it reaches the client as ' +
      '`details.field` and is keyed on in route message maps, so it cannot be ' +
      'computed at the mint site.',
  );
});

test('a route answers a storage failure through storageError()', () => {
  const offenders = [];
  for (const file of walk(join(repoRoot, 'server/routes'))) {
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/jsonError\(\s*res,\s*getErrorStatus\(/.test(line))
          offenders.push(`${rel}:${i + 1}`);
      });
  }
  assert.deepEqual(
    offenders,
    [],
    'storageError(res, result, message?) is the one form. Spreading the ' +
      'result by hand — jsonError(res, getErrorStatus(r.reason), r.reason) — ' +
      'drops `details.field` on the floor, which is exactly the information ' +
      'D48 traded the `invalid_*` suffixes for.',
  );
});

test('the allowlist is empty', () => {
  assert.deepEqual(
    ALLOWLIST,
    [],
    'B104 landed with an empty allowlist and it stays that way — a code that ' +
      'needs an exception needs a register entry instead.',
  );
});
