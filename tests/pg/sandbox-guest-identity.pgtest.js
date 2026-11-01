import { createMockRes } from '../helpers/http-mocks.js';
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
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPresentation,
  getPresentation,
} from '../../server/storage/presentations/index.js';
import { canReadPresentation } from '../../server/utils/presentation-authz/index.js';
import { ensureSandboxUserAsync } from '../../server/auth/sandbox.js';
import { signPayload } from '../../server/utils/signed-payload.js';
import { sweepExpiredSandboxGuests } from '../../server/jobs/sandbox-cleanup.js';
import { initializeThemeSeeds } from '../../server/utils/theme-seeds.js';

const DAY = 24 * 60 * 60 * 1000;
const SECRET = 'sandbox-guest-identity-test-secret-32chars';

/** A token as the server mints it, for a guest id of the test's choosing. */
function guestToken(sid) {
  return signPayload(
    { purpose: 'sandbox_guest', sid, exp: Date.now() + DAY },
    SECRET,
  );
}

/** The token value out of a mint response's Set-Cookie. */
function mintedToken(res) {
  return /sb_sandbox=([^;]+)/.exec(String(res.headers['Set-Cookie']))[1];
}

/** A request carrying the given guest cookie token (or none). */
function guestReq(token) {
  return {
    method: 'GET',
    headers: token ? { cookie: `sb_sandbox=${token}` } : {},
  };
}

pgDescribe('sandbox guest identity (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let prevSandboxMode;
  let prevSecret;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    prevSandboxMode = process.env.SANDBOX_MODE;
    process.env.SANDBOX_MODE = '1';
    prevSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = SECRET;
  });

  after(async () => {
    if (prevSandboxMode === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = prevSandboxMode;
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    await initializeThemeSeeds();
  });

  it('mints a cookie without a row, then gives the returning guest one stable id', async () => {
    const res = createMockRes();
    const first = await ensureSandboxUserAsync(guestReq(null), res);
    assert.equal(first.id, null, 'the minting request carries no id yet');
    assert.match(String(res.headers['Set-Cookie']), /sb_sandbox=/);
    const rowsAfterMint = await db
      .selectFrom('users')
      .select('id')
      .where('email', '=', first.email)
      .execute();
    assert.equal(rowsAfterMint.length, 0, 'a cookieless client leaves no row');

    const token = mintedToken(res);
    const back = await ensureSandboxUserAsync(guestReq(token), createMockRes());
    assert.ok(back.id, 'the returning guest has a users.id');
    const again = await ensureSandboxUserAsync(
      guestReq(token),
      createMockRes(),
    );
    assert.equal(again.id, back.id, 'the id is stable across requests');
  });

  it('never puts the cookie token in the address other guests can see', async () => {
    const sid = 'cccccccc-guest-carol';
    const token = guestToken(sid);
    const carol = await ensureSandboxUserAsync(
      guestReq(token),
      createMockRes(),
    );
    assert.ok(!carol.email.includes(sid), carol.email);
    assert.match(carol.email, /^guest-[0-9a-f]{32}@sandbox\.local$/);
    const again = await ensureSandboxUserAsync(
      guestReq(token),
      createMockRes(),
    );
    assert.equal(again.email, carol.email, 'stable per cookie');
  });

  it('lets a guest read the deck it created, and keeps another guest out', async () => {
    const alice = await ensureSandboxUserAsync(
      guestReq(guestToken('aaaaaaaa-guest-alice')),
      createMockRes(),
    );
    const bob = await ensureSandboxUserAsync(
      guestReq(guestToken('bbbbbbbb-guest-bob')),
      createMockRes(),
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

  it('gives a forged token its own guest, never the row of the guest it names', async () => {
    const aliceSid = 'aaaaaaaa-guest-alice';
    const alice = await ensureSandboxUserAsync(
      guestReq(guestToken(aliceSid)),
      createMockRes(),
    );
    assert.ok(alice.id);
    const [body] = guestToken('dddddddd-guest-mallory').split('.');
    const aliceSig = guestToken(aliceSid).split('.')[1];
    const forged = await ensureSandboxUserAsync(
      guestReq(`${body}.${aliceSig}`),
      createMockRes(),
    );
    assert.equal(forged.id, null, 'a refused token is a first visit');
    assert.notEqual(forged.email, alice.email);
    const unsigned = await ensureSandboxUserAsync(
      guestReq(aliceSid),
      createMockRes(),
    );
    assert.equal(unsigned.id, null);
    assert.notEqual(unsigned.email, alice.email);
  });

  it('sweeps guest rows older than the cookie lifetime and nothing else', async () => {
    const old = new Date(Date.now() - 31 * DAY).toISOString();
    const fresh = new Date(Date.now() - 1 * DAY).toISOString();
    const oldGuest = `guest-${'a'.repeat(32)}@sandbox.local`;
    const freshGuest = `guest-${'b'.repeat(32)}@sandbox.local`;
    await db
      .insertInto('users')
      .values([
        { email: oldGuest, name: 'Guest', role: 'user', created_at: old },
        { email: freshGuest, name: 'Guest', role: 'user', created_at: fresh },
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
    assert.deepEqual(left, ['admin@example.com', freshGuest]);
  });

  it('sweeps a fresh guest row in the old token-bearing form', async () => {
    const fresh = new Date(Date.now() - 1 * DAY).toISOString();
    const current = `guest-${'c'.repeat(32)}@sandbox.local`;
    await db
      .insertInto('users')
      .values([
        {
          email: 'guest-3f2b1c4d-0000-4000-8000-000000000000@sandbox.local',
          name: 'Guest',
          role: 'user',
          created_at: fresh,
        },
        { email: current, name: 'Guest', role: 'user', created_at: fresh },
      ])
      .execute();

    assert.equal(await sweepExpiredSandboxGuests(), 1);
    const left = (await db.selectFrom('users').select('email').execute()).map(
      (r) => r.email,
    );
    assert.deepEqual(left, [current]);
  });
});
