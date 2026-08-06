/**
 * Analytics retention config (B46): one source, one default per value.
 *
 * The cleanup job reads `settings.analytics.retention.*` (the admin UI), not
 * the old env-only `ANALYTICS_CONFIG`. These are the cheap, no-database guards
 * on the *default* shape: the built-in defaults (90 / 7) and the env seed that
 * feeds them. The runtime wiring — cleanup job → getAnalyticsRetention →
 * settings — needs real persistence and is exercised in tests/pg.
 *
 * Run with: node --test tests/analytics-retention-config.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { defaultAppSettings } = await import('../server/storage/settings.js');

describe('analytics retention config', () => {
  it('defaults to 90-day session data and 7-day IP anonymization', () => {
    const retention = defaultAppSettings().analytics.retention;
    assert.deepEqual(retention, { sessionDataDays: 90, ipAnonymizationDays: 7 });
  });

  it('seeds the defaults from env when the vars are set', () => {
    const prevRetention = process.env.ANALYTICS_RETENTION_DAYS;
    const prevIp = process.env.ANALYTICS_IP_ANONYMIZATION_DAYS;
    process.env.ANALYTICS_RETENTION_DAYS = '120';
    process.env.ANALYTICS_IP_ANONYMIZATION_DAYS = '14';
    try {
      const retention = defaultAppSettings().analytics.retention;
      assert.deepEqual(retention, { sessionDataDays: 120, ipAnonymizationDays: 14 });
    } finally {
      restore('ANALYTICS_RETENTION_DAYS', prevRetention);
      restore('ANALYTICS_IP_ANONYMIZATION_DAYS', prevIp);
    }
  });

  it('clamps an out-of-range env seed to the value bounds', () => {
    const prevIp = process.env.ANALYTICS_IP_ANONYMIZATION_DAYS;
    process.env.ANALYTICS_IP_ANONYMIZATION_DAYS = '9999'; // max is 90
    try {
      assert.equal(defaultAppSettings().analytics.retention.ipAnonymizationDays, 90);
    } finally {
      restore('ANALYTICS_IP_ANONYMIZATION_DAYS', prevIp);
    }
  });

  it('falls back to the default for a non-numeric env seed', () => {
    const prevRetention = process.env.ANALYTICS_RETENTION_DAYS;
    process.env.ANALYTICS_RETENTION_DAYS = 'not-a-number';
    try {
      assert.equal(defaultAppSettings().analytics.retention.sessionDataDays, 90);
    } finally {
      restore('ANALYTICS_RETENTION_DAYS', prevRetention);
    }
  });
});

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
