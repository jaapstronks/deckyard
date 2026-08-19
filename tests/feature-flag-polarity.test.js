/**
 * Feature-flag polarity (B68): the three kill switches carry the canonical
 * enable form (`AI_ENABLED` / `UPLOADS_ENABLED` / `IMAGE_LIBRARY_ENABLED`,
 * default on), while the legacy `DISABLE_*` spellings stay recognized —
 * inverted, with a boot warning — until their removal date (2026-11-01).
 * Pins the read precedence (new var > legacy var > default-on) and the
 * warning text an operator migrates by.
 *
 * Run with: node --test tests/feature-flag-polarity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAiEnabled,
  isUploadsEnabled,
  isImageLibraryEnabled,
  deprecatedFlagWarnings,
} from '../server/config/features.js';

const FLAGS = [
  { read: isAiEnabled, name: 'AI_ENABLED', legacy: 'DISABLE_AI' },
  {
    read: isUploadsEnabled,
    name: 'UPLOADS_ENABLED',
    legacy: 'DISABLE_UPLOADS',
  },
  {
    read: isImageLibraryEnabled,
    name: 'IMAGE_LIBRARY_ENABLED',
    legacy: 'DISABLE_IMAGE_LIBRARY',
  },
];

const ALL_VARS = FLAGS.flatMap((f) => [f.name, f.legacy]);

/** Run fn with the given env vars set (undefined = unset), restoring after. */
function withEnv(env, fn) {
  const saved = {};
  const keys = new Set([...ALL_VARS, ...Object.keys(env)]);
  for (const k of keys) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

for (const { read, name, legacy } of FLAGS) {
  test(`${name}: defaults on, and both spellings can turn it off`, () => {
    withEnv({}, () => {
      assert.equal(read(), true, `${name} unset must default to on`);
    });
    withEnv({ [name]: 'false' }, () => {
      assert.equal(read(), false, `${name}=false must turn the feature off`);
    });
    withEnv({ [name]: 'true' }, () => {
      assert.equal(read(), true);
    });
    // Legacy disable spelling, still honored until 2026-11-01.
    withEnv({ [legacy]: 'true' }, () => {
      assert.equal(
        read(),
        false,
        `${legacy}=true must still turn the feature off`,
      );
    });
    withEnv({ [legacy]: 'false' }, () => {
      assert.equal(read(), true);
    });
  });

  test(`${name} wins over ${legacy} when both are set`, () => {
    withEnv({ [name]: 'true', [legacy]: 'true' }, () => {
      assert.equal(read(), true, `${name}=true must override ${legacy}=true`);
    });
    withEnv({ [name]: 'false', [legacy]: 'false' }, () => {
      assert.equal(
        read(),
        false,
        `${name}=false must override ${legacy}=false`,
      );
    });
  });

  test(`a set ${legacy} produces a deprecation warning naming the successor`, () => {
    withEnv({ [legacy]: 'true' }, () => {
      const warnings = deprecatedFlagWarnings();
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], new RegExp(`^${legacy} is deprecated`));
      assert.ok(
        warnings[0].includes(`${name}=false`),
        'the warning must name the equivalent enable-form setting',
      );
      assert.ok(
        warnings[0].includes('2026-11-01'),
        'the warning must name the removal date',
      );
    });
  });
}

test('no legacy vars set means no deprecation warnings', () => {
  withEnv({}, () => {
    assert.deepEqual(deprecatedFlagWarnings(), []);
  });
});

test('every set legacy var warns once, independently', () => {
  withEnv({ DISABLE_AI: 'true', DISABLE_UPLOADS: 'false' }, () => {
    const warnings = deprecatedFlagWarnings();
    assert.equal(warnings.length, 2);
    assert.ok(warnings.some((w) => w.startsWith('DISABLE_AI ')));
    // DISABLE_UPLOADS=false means uploads stay on, so the fix is =true.
    const uploads = warnings.find((w) => w.startsWith('DISABLE_UPLOADS '));
    assert.ok(uploads.includes('UPLOADS_ENABLED=true'));
  });
});

test('the warning flags a shadowed legacy var when both spellings are set', () => {
  withEnv({ AI_ENABLED: 'true', DISABLE_AI: 'true' }, () => {
    const [warning] = deprecatedFlagWarnings();
    assert.match(warning, /AI_ENABLED is also set and takes precedence/);
  });
});
