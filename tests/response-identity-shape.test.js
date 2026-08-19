/**
 * D22 gate: a response names a person, it does not hand out their address.
 *
 * Decision D22 (2026-08-19, `docs/plans/done/decisions.md`) settled the shape
 * an internal `/api` response uses for a person: `{ id, displayName }`. An
 * email crosses the boundary only where the viewer has a claim on it — their
 * own address, a collaborator they invited, a guest they addressed, a deck they
 * own. Everything else used to get someone's contact details for free, because
 * the display path happened to run through a column that held one.
 *
 * That is a rule about *where* addresses appear, so it is checked where they
 * would appear: in the object literals that become responses.
 *
 * ## What is scanned, and why only that
 *
 * Two shapes, chosen because they are the two ways a payload is built here:
 *
 *   1. **Storage return literals** — an object literal in return position
 *      anywhere under `server/storage/**`, including the arrow body of a
 *      `rows.map(row => ({ … }))`. This is where a row mapper turns columns
 *      into a payload, and it is the layer that has the addresses.
 *   2. **Route payloads** — the object literal passed as the body argument of
 *      `serveJson(...)` anywhere under `server/routes/**`. This catches a route
 *      that assembles its own shape instead of forwarding a mapper's.
 *
 * Everything else is deliberately out of scope. An `actorEmail:` in an options
 * object handed *to* storage is an input, not a disclosure, and there are
 * hundreds of them; a gate that could not tell the two apart would be noise.
 *
 * ## Two checks
 *
 * **(a) No address-shaped key.** A key ending in `Email` in a scanned literal
 * must be on {@link PERMITTED_ADDRESSES}, with a reason naming the claim the
 * viewer has on that address.
 *
 * **(b) No bare display stamp.** Under `server/storage/**`, a key that names a
 * person by role — `createdBy`, `updatedBy`, `trashedBy`, `actorName`,
 * `authorName`, … — must be built by `toDisplayIdentity` /
 * `toStoredActorIdentity` (server/storage/display-identity.js) rather than
 * echoing a column, unless it is on {@link PERMITTED_STAMPS}. `createdBy:
 * row.created_by` is exactly the shape D22 removes; `createdBy:
 * toDisplayIdentity(row.created_by_user_id, row.created_by, lookup)` is the
 * replacement.
 *
 * Both allowlists carry a reason per entry and may only shrink. They are the
 * honest part of the gate: the remaining entries are the tracked work, not
 * accidents — see the module doc of server/storage/display-identity.js and the
 * "still to convert" reasons below.
 *
 * This is a drift stop, not a proof. It reads shapes, not data flow: a response
 * assembled through a variable, a spread or a helper the scan cannot follow
 * passes. It stops the pattern coming back where it lived.
 *
 * Run with: node --test tests/response-identity-shape.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Files whose object literals are not payloads, so the shape rule does not
 * apply. Both are contracts *between* server modules, and both would otherwise
 * trip the scan on a key that never leaves the process.
 * @type {Set<string>}
 */
const NOT_A_PAYLOAD = new Set([
  // The storage context every facade takes; `actorEmail` is an input.
  'server/storage/scope.js',
  // The module that builds the pairs; its lookup object exposes `forEmail` as
  // a *function*, not an address.
  'server/storage/display-identity.js',
]);

// ─── allowlist (a): addresses a viewer has a claim on ───────────────────────

/**
 * `<repo-relative file> :: <key>` → why the viewer may see this address.
 * @type {Map<string, string>}
 */
const PERMITTED_ADDRESSES = new Map([
  // ── your own identity, or a record addressed to you ──────────────────────
  [
    'server/storage/notifications.js :: userEmail',
    'the recipient of the notification is the reader — their own address',
  ],
  [
    'server/storage/activity-events.js :: userEmail',
    'your own read marker in the activity feed',
  ],
  [
    'server/storage/api-keys.js :: ownerEmail',
    'an API key is listed only to the person who owns it',
  ],
  [
    'server/routes/api/api-keys.js :: ownerEmail',
    'an API key is listed only to the person who owns it',
  ],
  [
    'server/storage/password-reset.js :: maskedEmail',
    'deliberately masked before it is returned — that is the field',
  ],
  [
    'server/routes/api/password-reset.js :: maskedEmail',
    'deliberately masked before it is returned — that is the field',
  ],
  // ── people you invited, or who invited you ───────────────────────────────
  [
    'server/storage/collaborators.js :: userEmail',
    'the collaborator list is the invite surface: you addressed these people ' +
      'by hand, and removing one is done by address',
  ],
  [
    'server/storage/collaborators.js :: ownerEmail',
    'the owner of a deck shared with you — a contact you may reach about it',
  ],
  // ── a deck, library or collection you own ────────────────────────────────
  [
    'server/storage/presentations/index.js :: ownerEmail',
    'the deck owner, on a deck the reader can already open. The public API v1 ' +
      'redacts it for anyone but the owner (public-api/v1/presentations.js).',
  ],
  [
    'server/routes/public-api/v1/presentations.js :: ownerEmail',
    'redacted to null unless the requesting API key belongs to the owner — ' +
      'the redaction happens right above this key',
  ],
  [
    'server/routes/api/presentations/popular.js :: ownerEmail',
    'the owner of an organization-visible deck, to colleagues in that org',
  ],
  [
    'server/storage/slide-library/index.js :: ownerEmail',
    'a personal-shelf library item is listed only to the person who owns it',
  ],
  [
    'server/storage/collections/index.js :: ownerEmail',
    'a personal collection is listed only to the person who owns it',
  ],
  // ── analytics and audit over things you own ──────────────────────────────
  [
    'server/storage/analytics/view-sessions.js :: viewerEmail',
    'deck analytics are owner-only, and who viewed your deck is the analytic',
  ],
  [
    'server/storage/analytics/view-sessions-gdpr.js :: viewerEmail',
    'a GDPR export is the data subject asking for their own record',
  ],
  [
    'server/storage/analytics/weekly-summary.js :: ownerEmail',
    'the digest is addressed to the deck owner',
  ],
  [
    'server/storage/access-attempts.js :: accessorEmail',
    'who tried to open your deck, reported to you so you can grant access',
  ],
  [
    'server/storage/identity-verification.js :: userEmail',
    'the dual-key consistency report: an admin diagnostic whose whole subject ' +
      'is whether a row e-mail and a users-row e-mail agree',
  ],
  // ── not a person ─────────────────────────────────────────────────────────
  [
    'server/routes/api/presentations/comments-list.js :: aiEmail',
    'the instance-configured AI assistant address, not a human being — the ' +
      'client marks AI-authored comments with it (isAiAuthorEmail)',
  ],
  // ── still to convert: addresses that are also matching keys ──────────────
  [
    'server/storage/presentations/comments.js :: authorEmail',
    'STILL TO CONVERT: the client compares this address to decide whether the ' +
      'edit/delete affordance shows (client/lib/comments/comment-authz.js), ' +
      'so today it is a matching key, not only display. Retiring it means ' +
      'moving that mirror onto ids first — including guest authors, who have ' +
      'no users row at all.',
  ],
  [
    'server/storage/slide-locks.js :: holderEmail',
    'STILL TO CONVERT: display only since the address stopped being a key — ' +
      'the client shows who holds the lock and falls back to the address when ' +
      'the holder has no name (slide-lock-manager.js, render-item.js). ' +
      'Converts to a holder pair with the rest of the lock surface.',
  ],
]);

// ─── allowlist (b): display stamps not yet built as a pair ─────────────────

/**
 * `<repo-relative file> :: <key>` → why this stamp still echoes a column.
 * @type {Map<string, string>}
 */
const PERMITTED_STAMPS = new Map([
  // ── ownership stamps: compared, not merely rendered ──────────────────────
  // ── invitation stamps: who addressed whom ────────────────────────────────
  [
    'server/storage/collaborators.js :: invitedBy',
    'the person who invited this collaborator, shown on the invite surface ' +
      'itself — a contact both sides already have',
  ],
  [
    'server/storage/collaborators.js :: sharedBy',
    'who shared this deck with you; the deck list is searchable by it ' +
      '(client/views/list/views/search-view.js)',
  ],
  [
    'server/storage/share-links/guests.js :: invitedBy',
    'who issued this guest link, shown to the deck owner who issued it',
  ],
  [
    'server/storage/user-organizations/memberships.js :: invitedBy',
    'who invited this member, shown on the organization admin surface',
  ],
  // ── org-admin authoring stamps ───────────────────────────────────────────
  // ── guest-authored content ───────────────────────────────────────────────
  [
    'server/storage/presentations/comments.js :: authorName',
    'STILL TO CONVERT: converts together with the comment author address above.',
  ],
  [
    'server/storage/questions.js :: authorName',
    'the name an audience member typed into the live-session question box — ' +
      'self-declared, not an account, so there is no id to pair it with',
  ],
]);

/** Keys that name a person by role and must therefore be a display pair. */
const STAMP_KEYS = new Set([
  'createdBy',
  'updatedBy',
  'trashedBy',
  'invitedBy',
  'sharedBy',
  'actorName',
  'authorName',
  'ownerName',
]);

/** The two builders that produce a `{ id, displayName }` pair. */
const PAIR_BUILDERS = new Set(['toDisplayIdentity', 'toStoredActorIdentity']);

// ─── walking ───────────────────────────────────────────────────────────────

/**
 * Every `.js` file under a directory, recursively.
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Walk an ESTree node, calling `visit` on every node.
 * @param {any} node
 * @param {(n: any) => void} visit
 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue;
    walk(node[key], visit);
  }
}

/**
 * The object literals a file uses to build a payload.
 *
 * @param {any} ast
 * @param {boolean} isStorage - Whether the file lives under server/storage.
 * @returns {any[]} ObjectExpression nodes
 */
function payloadLiterals(ast, isStorage) {
  const found = [];
  walk(ast, (node) => {
    // 1. return { … }
    if (node.type === 'ReturnStatement' && node.argument) {
      collectObject(node.argument, found);
    }
    // 2. (row) => ({ … }) — the row-mapper arrow body
    if (
      node.type === 'ArrowFunctionExpression' &&
      node.body?.type === 'ObjectExpression'
    ) {
      found.push(node.body);
    }
    // 3. serveJson(res, code, { … })
    if (
      !isStorage &&
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      node.callee.name === 'serveJson'
    ) {
      for (const arg of node.arguments) collectObject(arg, found);
    }
  });
  return found;
}

/**
 * Push `node` if it is an object literal, looking through `a || b` and
 * ternaries so `return cond ? { … } : null` is still scanned.
 * @param {any} node
 * @param {any[]} out
 */
function collectObject(node, out) {
  if (!node) return;
  if (node.type === 'ObjectExpression') out.push(node);
  else if (node.type === 'LogicalExpression') {
    collectObject(node.left, out);
    collectObject(node.right, out);
  } else if (node.type === 'ConditionalExpression') {
    collectObject(node.consequent, out);
    collectObject(node.alternate, out);
  }
}

/**
 * The static name of a property key, or null for a computed one.
 * @param {any} prop
 * @returns {string|null}
 */
function keyName(prop) {
  if (prop.type !== 'Property' || prop.computed) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal' && typeof prop.key.value === 'string')
    return prop.key.value;
  return null;
}

/**
 * Whether a property's value is built by a display-pair builder.
 * @param {any} prop
 * @returns {boolean}
 */
function isPairBuilt(prop) {
  let value = prop.value;
  // `key: cond ? build(…) : null` and `key: build(…) || null` both count.
  while (value?.type === 'LogicalExpression') value = value.left;
  if (value?.type === 'ConditionalExpression') value = value.consequent;
  if (value?.type === 'ObjectExpression') return true; // already a literal pair
  return (
    value?.type === 'CallExpression' &&
    value.callee?.type === 'Identifier' &&
    PAIR_BUILDERS.has(value.callee.name)
  );
}

/**
 * Scan the tree for both violations.
 * @returns {{addresses: string[], stamps: string[]}}
 */
function scan() {
  const addresses = new Set();
  const stamps = new Set();
  const roots = [
    join(repoRoot, 'server', 'storage'),
    join(repoRoot, 'server', 'routes'),
  ];
  for (const root of roots) {
    for (const file of jsFilesUnder(root)) {
      const rel = relative(repoRoot, file).replaceAll('\\', '/');
      if (NOT_A_PAYLOAD.has(rel)) continue;
      const isStorage = rel.startsWith('server/storage/');
      const ast = parse(readFileSync(file, 'utf8'), {
        ecmaVersion: 'latest',
        sourceType: 'module',
      });
      for (const literal of payloadLiterals(ast, isStorage)) {
        for (const prop of literal.properties) {
          const key = keyName(prop);
          if (!key) continue;
          if (/Email$/.test(key)) addresses.add(`${rel} :: ${key}`);
          else if (isStorage && STAMP_KEYS.has(key) && !isPairBuilt(prop))
            stamps.add(`${rel} :: ${key}`);
        }
      }
    }
  }
  return { addresses: [...addresses].sort(), stamps: [...stamps].sort() };
}

// ─── the gate ──────────────────────────────────────────────────────────────

test('no response literal carries an address the viewer has no claim on', () => {
  const { addresses } = scan();
  const undeclared = addresses.filter((k) => !PERMITTED_ADDRESSES.has(k));
  assert.deepEqual(
    undeclared,
    [],
    'a response grew an e-mail field (D22). Build the person as ' +
      '{ id, displayName } with toDisplayIdentity() from ' +
      'server/storage/display-identity.js — or, if the viewer really has a ' +
      'claim on this address, add it to PERMITTED_ADDRESSES with the reason.',
  );
});

test('no storage mapper echoes a bare display stamp', () => {
  const { stamps } = scan();
  const undeclared = stamps.filter((k) => !PERMITTED_STAMPS.has(k));
  assert.deepEqual(
    undeclared,
    [],
    'a storage mapper names a person without building a display pair (D22). ' +
      'Use toDisplayIdentity() / toStoredActorIdentity() from ' +
      'server/storage/display-identity.js.',
  );
});

test('both allowlists are live — every entry still names a real occurrence', () => {
  const { addresses, stamps } = scan();
  const stale = [
    ...[...PERMITTED_ADDRESSES.keys()].filter((k) => !addresses.includes(k)),
    ...[...PERMITTED_STAMPS.keys()].filter((k) => !stamps.includes(k)),
  ];
  assert.deepEqual(
    stale,
    [],
    'an allowlist entry no longer matches anything — delete it, so the list ' +
      'keeps shrinking and never grants cover to a field that comes back later',
  );
});

test('every allowlist entry carries a reason', () => {
  for (const [key, reason] of [...PERMITTED_ADDRESSES, ...PERMITTED_STAMPS]) {
    assert.ok(
      typeof reason === 'string' && reason.trim().length > 20,
      `${key} is allowlisted without a reason worth reading`,
    );
  }
});
