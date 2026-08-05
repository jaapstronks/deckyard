/**
 * The internal/external analytics distinction is gone: `analytics.enabled` is
 * the only tracking switch, and the team-policy / detailed-opt-in / external-
 * viewer / digest-team keys no longer appear in the normalized settings shape.
 *
 * These are the cheap, no-database guards on the *default* shape. The
 * store-raw / normalize-on-read behaviour — a stored bag that still carries the
 * legacy keys reads back clean and does not write them back — needs real
 * persistence and lives in tests/pg/settings.pgtest.js.
 *
 * Rationale: docs/plans/done/decisions.md § analytics-privacy-naden.
 *
 * Run with: node --test tests/analytics-settings-no-internal-external.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { defaultAppSettings, defaultUserSettings } = await import(
  '../server/storage/settings.js'
);

describe('analytics settings: no internal/external chain', () => {
  it('the app-settings default carries only enabled/retention/externalProviders', () => {
    const analytics = defaultAppSettings().analytics;
    assert.deepEqual(
      Object.keys(analytics).sort(),
      ['enabled', 'externalProviders', 'retention']
    );
    assert.equal('teamAnalytics' in analytics, false);
    assert.equal('externalAnalytics' in analytics, false);
  });

  it('the master switch stays, defaulting on', () => {
    assert.equal(defaultAppSettings().analytics.enabled, true);
  });

  it('the user digest default drops includeTeamAnalytics', () => {
    const digest = defaultUserSettings().digest;
    assert.deepEqual(Object.keys(digest).sort(), ['dayOfWeek', 'enabled']);
    assert.equal('includeTeamAnalytics' in digest, false);
  });
});
