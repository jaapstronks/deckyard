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
 * `shared/**` is in scope because `shared/slide-types/usage.js` mints
 * `invalid_usage` / `usage_too_long` and `createCustomSlideType` hands them
 * straight back, so they reach the wire as storage reasons like any other.
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
 * Both `reason` and `code` are read: storage answers `{ ok: false, reason }`,
 * and the share-access validators in `routes/api/analytics-track.js` answer
 * `{ ok: false, code, message }` from the same vocabulary. Objects without a
 * literal `ok: false` are skipped — `reason` is also a column on the
 * presentation-version audit trail (`'pre_merge'`, `'snapshot'`), a different
 * namespace that never reaches an HTTP status.
 *
 * @returns {{code: string, where: string}[]}
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
            for (const prop of props) {
              const name = propName(prop);
              if (name !== 'reason' && name !== 'code') continue;
              for (const code of mintedLiterals(prop.value)) {
                minted.push({ code, where: `${rel}:${prop.loc.start.line}` });
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

test('the allowlist is empty', () => {
  assert.deepEqual(
    ALLOWLIST,
    [],
    'B104 landed with an empty allowlist and it stays that way — a code that ' +
      'needs an exception needs a register entry instead.',
  );
});
