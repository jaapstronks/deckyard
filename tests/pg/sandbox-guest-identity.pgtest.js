/**
 * A sandbox guest owns what it creates, end to end against real PostgreSQL.
 *
 * Ownership is keyed on `users.id` only (D22, shared/identity-match.js). A
 * guest that carried nothing but the address in its cookie could create a
 * deck and then not open it: every example on the sandbox Home answered
 * "Access Denied". The guest is now a real `users` row (auth/sandbox.js), and
 * this file proves the seam the pure tests cannot: the row exists, the deck
 * the facade stamps carries its id, the read decider lets the guest in and a
 * second guest out, and the cleanup sweep removes the row once the cookie is
 * gone.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPresentation,
  getPresentation,
} from '../../server/storage/presentations/index.js';
import { canReadPresentation } from '../../server/utils/presentation-authz/index.js';
import { ensureSandboxUserAsync } from '../../server/auth/sandbox.js';
import { sweepExpiredSandboxGuests } from '../../server/jobs/sandbox-cleanup.js';

const DAY = 24 * 60 * 60 * 1000;

/** A request carrying the given guest cookie token (or none). */
function guestReq(token) {
  return {
    method: 'GET',
    headers: token ? { cookie: `sb_sandbox=${token}` } : {},
  };
}

/** A response double that records Set-Cookie. */
function fakeRes() {
  const headers = {};
  return {
    headers,
    getHeader: (k) => headers[k],
    setHeader: (k, v) => {
      headers[k] = v;
    },
  };
}

pgDescribe('sandbox guest identity (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let prevSandboxMode;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    prevSandboxMode = process.env.SANDBOX_MODE;
    process.env.SANDBOX_MODE = '1';
  });

  after(async () => {
    if (prevSandboxMode === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = prevSandboxMode;
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
  });

  it('mints a cookie without a row, then gives the returning guest one stable id', async () => {
    const res = fakeRes();
    const first = await ensureSandboxUserAsync(guestReq(null), res);
    assert.equal(first.id, null, 'the minting request carries no id yet');
    assert.match(String(res.headers['Set-Cookie']), /sb_sandbox=/);
    const rowsAfterMint = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', first.email)
      .execute();
    assert.equal(rowsAfterMint.length, 0, 'a cookieless client leaves no row');

    const back = await ensureSandboxUserAsync(
      guestReq(first.sandboxId),
      fakeRes(),
    );
    assert.ok(back.id, 'the returning guest has a users.id');
    const again = await ensureSandboxUserAsync(
      guestReq(first.sandboxId),
      fakeRes(),
    );
    assert.equal(again.id, back.id, 'the id is stable across requests');
  });

  it('never puts the cookie token in the address other guests can see', async () => {
    const token = 'cccccccc-guest-carol';
    const carol = await ensureSandboxUserAsync(guestReq(token), fakeRes());
    assert.ok(!carol.email.includes(token), carol.email);
    assert.match(carol.email, /^guest-[0-9a-f]{32}@sandbox\.local$/);
    const again = await ensureSandboxUserAsync(guestReq(token), fakeRes());
    assert.equal(again.email, carol.email, 'stable per cookie');
  });

  it('lets a guest read the deck it created, and keeps another guest out', async () => {
    const alice = await ensureSandboxUserAsync(
      guestReq('aaaaaaaa-guest-alice'),
      fakeRes(),
    );
    const bob = await ensureSandboxUserAsync(
      guestReq('bbbbbbbb-guest-bob'),
      fakeRes(),
    );

    const created = await createPresentation(testScope(), {
      title: 'Imported example',
      ownerEmail: alice.email,
    });
    const pres = await getPresentation(testScope(), created.id);
    assert.equal(
      pres.ownerId,
      alice.id,
      'the deck is stamped with the guest id',
    );

    assert.equal(canReadPresentation({ user: alice, pres }), true);
    assert.equal(canReadPresentation({ user: bob, pres }), false);
  });

  it('sweeps guest rows older than the cookie lifetime and nothing else', async () => {
    const old = new Date(Date.now() - 31 * DAY).toISOString();
    const fresh = new Date(Date.now() - 1 * DAY).toISOString();
    await db
      .insertInto('users')
      .values([
        {
          email: 'guest-old00000@sandbox.local',
          name: 'Guest',
          role: 'user',
          created_at: old,
        },
        {
          email: 'guest-fresh000@sandbox.local',
          name: 'Guest',
          role: 'user',
          created_at: fresh,
        },
        {
          email: 'admin@example.com',
          name: 'Admin',
          role: 'admin',
          created_at: old,
        },
      ])
      .execute();

    assert.equal(await sweepExpiredSandboxGuests(), 1);
    const left = (await db.selectFrom('users').select('email').execute())
      .map((r) => r.email)
      .sort();
    assert.deepEqual(left, [
      'admin@example.com',
      'guest-fresh000@sandbox.local',
    ]);
  });
});
