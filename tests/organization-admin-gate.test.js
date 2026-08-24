/**
 * The workspace-scoped admin gate (B144).
 *
 * `user.isAdmin` is the instance-wide role from `users.role`;
 * `user.organizationRole` is the membership role in the organization the
 * session is currently in. Gating UI on the instance flag alone means an admin
 * of organization A keeps every destructive affordance the moment they switch
 * to organization B — the delete button on a shared image, the Q&A remove
 * button, the raw-JSON slide editor, the moderator route.
 *
 * `isOrganizationAdmin()` in client/lib/user/organization-role.js is the
 * conjunction, and it was losing: four call sites against ten raw `.isAdmin`
 * reads. This file pins the ESLint rule that makes the helper the default, and
 * the helper's own semantics — in particular that a single-workspace instance
 * (no membership role) is unchanged by any of it.
 *
 * Run with: node --test tests/organization-admin-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isOrganizationAdmin } from '../client/lib/user/organization-role.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const ADMIN_MESSAGE = /Gate UI on isOrganizationAdmin\(user\)/;
const PROBE = 'client/views/admin-gate-probe.js';

async function lintProbe(code, relPath) {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages.filter(
    (m) => m.ruleId === 'no-restricted-syntax' && ADMIN_MESSAGE.test(m.message),
  );
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

const RESTRICTED = [
  ['an optional-chained read', 'export const f = (user) => user?.isAdmin;\n'],
  ['a plain member read', 'export const f = (user) => user.isAdmin;\n'],
  [
    'a negated guard',
    'export const f = (user) => {\n  if (!user?.isAdmin) return null;\n  return user;\n};\n',
  ],
  [
    'a conditional affordance',
    "export const f = (user) => (user?.isAdmin ? 'delete' : null);\n",
  ],
  [
    'a read off something other than `user`',
    'export const f = (ctx) => ctx.session.isAdmin;\n',
  ],
];

for (const [label, code] of RESTRICTED) {
  test(`gate: ${label} of .isAdmin is a lint error`, async () => {
    const messages = await lintProbe(code, PROBE);
    assert.ok(
      messages.length >= 1,
      `expected the instance-admin error, got: ${JSON.stringify(messages)}`,
    );
  });
}

test('gate: the shapes that are not a gate stay legal', async () => {
  const legal = [
    // Destructuring — the name arrives as a binding, not a read off a user.
    'export const f = ({ isAdmin }) => isAdmin;\n',
    // Prop-threading the already-narrowed answer down to a child view.
    "import { isOrganizationAdmin } from '../lib/user/organization-role.js';\n" +
      'export const f = (user) => ({ isAdmin: isOrganizationAdmin(user) });\n',
    // A jsdoc mention.
    '/**\n * @param {boolean} isAdmin - Whether the user is an admin\n * @returns {boolean}\n */\n' +
      'export const f = (isAdmin) => isAdmin;\n',
  ];
  for (const code of legal) {
    assert.deepEqual(
      await lintProbe(code, PROBE),
      [],
      `should not be restricted:\n${code}`,
    );
  }
});

test('gate: the canonical helper is importable and unrestricted', async () => {
  const messages = await lintProbe(
    "import { isOrganizationAdmin } from '../lib/user/organization-role.js';\n" +
      'export const f = (user) => (isOrganizationAdmin(user) ? 1 : 0);\n',
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: organization-role.js is the one allowed reader', async () => {
  assert.deepEqual(
    await lintProbe(
      'export const f = (user) => Boolean(user?.isAdmin);\n',
      'client/lib/user/organization-role.js',
    ),
    [],
    'the helper narrows the instance flag, so it must be able to read it',
  );
  assert.ok(
    (
      await lintProbe(
        'export const f = (user) => Boolean(user?.isAdmin);\n',
        'client/lib/dom/modal.js',
      )
    ).length >= 1,
    'no second exemption — modal.js re-states the client restrictions',
  );
});

test('gate: the client is clean — the burndown is finished', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintFiles(['client']);
  const hits = results.flatMap((r) =>
    r.messages
      .filter(
        (m) =>
          m.ruleId === 'no-restricted-syntax' && ADMIN_MESSAGE.test(m.message),
      )
      .map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line}`),
  );
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------------------
// The helper's semantics — what the gates now mean
// ---------------------------------------------------------------------------

test('single-workspace instances are unchanged: no membership role means isAdmin decides', () => {
  assert.equal(isOrganizationAdmin({ isAdmin: true }), true);
  assert.equal(isOrganizationAdmin({ isAdmin: false }), false);
  assert.equal(
    isOrganizationAdmin({ isAdmin: true, organizationRole: null }),
    true,
  );
});

test('a membership role only ever narrows what the instance role allows', () => {
  const cases = [
    [{ isAdmin: true, organizationRole: 'owner' }, true],
    [{ isAdmin: true, organizationRole: 'admin' }, true],
    // The case the gate exists for: instance admin, plain member here.
    [{ isAdmin: true, organizationRole: 'member' }, false],
    // The opposite damage the gate must not do: workspace admin, not an
    // instance admin, would be shown tabs whose API answers 403.
    [{ isAdmin: false, organizationRole: 'owner' }, false],
    [{ isAdmin: false, organizationRole: 'admin' }, false],
  ];
  for (const [user, expected] of cases) {
    assert.equal(
      isOrganizationAdmin(user),
      expected,
      `${JSON.stringify(user)} → ${expected}`,
    );
  }
});

test('a missing or unknown user is never an admin', () => {
  assert.equal(isOrganizationAdmin(undefined), false);
  assert.equal(isOrganizationAdmin(null), false);
  assert.equal(isOrganizationAdmin({}), false);
  // An unrecognised role falls back to "no membership to speak of", so the
  // instance flag decides — the same as single-workspace mode.
  assert.equal(
    isOrganizationAdmin({ isAdmin: true, organizationRole: 'nonsense' }),
    true,
  );
});
