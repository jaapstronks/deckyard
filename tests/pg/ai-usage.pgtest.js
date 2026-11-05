/**
 * The AI call meter's storage against real PostgreSQL (DY-844).
 *
 * The ceiling is one statement: `INSERT … ON CONFLICT (date) DO UPDATE …
 * WHERE calls < limit RETURNING calls`. The in-memory double resolves the
 * conflict in JavaScript, one row at a time, so it cannot show that two
 * concurrent calls never both take the last slot. This runs that statement
 * concurrently on the database that evaluates it, and reads the organization
 * rows back through the DATE and BIGINT columns node-postgres converts.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import {
  getInstanceAiCalls,
  listOrganizationAiUsage,
  recordOrganizationAiUsage,
  reserveInstanceAiCall,
  usageDay,
} from '../../server/storage/ai-usage.js';
import { crossOrganizationScope } from '../../server/storage/scope.js';

const INSTANCE = crossOrganizationScope(null, 'pg test: instance AI ceiling');

pgDescribe('AI usage meter (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  /** @type {string} */
  let organizationId;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'ai_usage_instance_daily', 'ai_usage_daily');
    await truncate(db, 'organizations');
    const row = await db
      .insertInto('organizations')
      .values({ name: 'Meter', slug: 'meter' })
      .returning('id')
      .executeTakeFirstOrThrow();
    organizationId = row.id;
  });

  it('lets exactly the limit through when calls race for the last slots', async () => {
    const day = usageDay();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserveInstanceAiCall(INSTANCE, { day, limit: 7 }),
      ),
    );

    assert.equal(results.filter((r) => r.ok).length, 7);
    assert.ok(
      results
        .filter((r) => !r.ok)
        .every((r) => r.reason === 'rate_limited' && r.used === 7),
    );
    assert.equal(await getInstanceAiCalls(INSTANCE, { day }), 7);
  });

  it('counts without a ceiling when the limit is 0', async () => {
    const day = usageDay();
    for (let i = 0; i < 3; i++) {
      assert.equal(
        (await reserveInstanceAiCall(INSTANCE, { day, limit: 0 })).ok,
        true,
      );
    }
    assert.equal(await getInstanceAiCalls(INSTANCE, { day }), 3);
  });

  it('accumulates per person and reads days and people back as numbers', async () => {
    const today = usageDay();
    const scope = (actorEmail) => ({ organizationId, actorEmail });
    await recordOrganizationAiUsage(scope('a@example.com'), {
      day: today,
      calls: 1,
      inputTokens: 100,
      outputTokens: 10,
    });
    await recordOrganizationAiUsage(scope('A@example.com'), {
      day: today,
      calls: 1,
      inputTokens: 50,
      outputTokens: 5,
    });
    await recordOrganizationAiUsage(scope(null), { day: today, calls: 1 });
    await recordOrganizationAiUsage(scope('b@example.com'), {
      day: '2020-01-01',
      calls: 9,
    });

    const usage = await listOrganizationAiUsage(scope('a@example.com'), {
      today,
      days: 7,
    });

    assert.equal(usage.ok, true);
    assert.deepEqual(usage.days, [
      {
        day: today,
        calls: 3,
        inputTokens: 150,
        outputTokens: 15,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
    // The two spellings of one address are one person; nobody is `null`.
    assert.deepEqual(
      usage.today.people.map((p) => [p.person === null, p.calls]),
      [
        [false, 2],
        [true, 1],
      ],
    );
    assert.equal(typeof usage.today.total.inputTokens, 'number');
  });
});
