/**
 * The media provider is configured as generic S3, and the Scaleway-era names
 * are legacy with a boot warning — not a silent alias (B98 / D25).
 *
 * Pins five things the rename has to keep true:
 *  (a) a complete `S3_*` set selects the `s3` provider;
 *  (b) `MEDIA_STORAGE_MODE=s3` without `S3_ENDPOINT` refuses to boot, saying so;
 *  (c) a legacy `SCW_*` set still works, and every read legacy name warns;
 *  (d) `S3_*` wins when both are set, and the warning says the legacy name is
 *      overridden;
 *  (e) the public base URL comes from `S3_PUBLIC_URL` when set, and is derived
 *      from endpoint + bucket otherwise.
 *
 * Run with: node --test tests/media-config-s3.test.js
 */

import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePublicBaseUrl,
  getEffectiveMediaProvider,
  getS3Config,
  isS3Configured,
  mediaConfigWarnings,
} from '../server/media/config.js';

const MANAGED = [
  'MEDIA_STORAGE_MODE',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'S3_PUBLIC_URL',
  'SCW_ACCESS_KEY',
  'SCW_SECRET_KEY',
  'SCW_BUCKET',
  'SCW_REGION',
  'SCW_ENDPOINT',
  'SCW_CDN_URL',
];

const SAVED = Object.fromEntries(MANAGED.map((k) => [k, process.env[k]]));

function clearManaged() {
  for (const k of MANAGED) delete process.env[k];
}

beforeEach(clearManaged);

after(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function setS3Env() {
  process.env.S3_ACCESS_KEY = 'ak';
  process.env.S3_SECRET_KEY = 'sk';
  process.env.S3_BUCKET = 'media';
  process.env.S3_ENDPOINT = 'https://s3.eu-central-1.example.com';
}

function setLegacyEnv() {
  process.env.SCW_ACCESS_KEY = 'legacy-ak';
  process.env.SCW_SECRET_KEY = 'legacy-sk';
  process.env.SCW_BUCKET = 'legacy-bucket';
}

test('(a) a complete S3_* set configures the s3 provider', () => {
  setS3Env();
  process.env.S3_REGION = 'eu-central-1';

  assert.equal(isS3Configured(), true);
  assert.equal(getEffectiveMediaProvider(), 's3');
  assert.deepEqual(getS3Config(), {
    accessKeyId: 'ak',
    secretAccessKey: 'sk',
    region: 'eu-central-1',
    bucket: 'media',
    endpoint: 'https://s3.eu-central-1.example.com',
    publicUrl: 'https://media.s3.eu-central-1.example.com',
  });
  assert.deepEqual(mediaConfigWarnings(), []);
});

test('(a) without any keys, auto mode stays on local storage', () => {
  assert.equal(isS3Configured(), false);
  assert.equal(getEffectiveMediaProvider(), 'local');

  process.env.MEDIA_STORAGE_MODE = 'local';
  setS3Env();
  assert.equal(
    getEffectiveMediaProvider(),
    'local',
    'forced local wins over a complete S3 configuration',
  );
});

test('(b) MEDIA_STORAGE_MODE=s3 without S3_ENDPOINT refuses to boot', () => {
  process.env.MEDIA_STORAGE_MODE = 's3';
  process.env.S3_ACCESS_KEY = 'ak';
  process.env.S3_SECRET_KEY = 'sk';
  process.env.S3_BUCKET = 'media';

  assert.equal(isS3Configured(), false);
  assert.throws(() => getEffectiveMediaProvider(), /S3_ENDPOINT/);
});

test('(c) a legacy SCW_* set still works and warns per name', () => {
  process.env.MEDIA_STORAGE_MODE = 'scaleway';
  setLegacyEnv();
  process.env.SCW_CDN_URL = 'https://cdn.example.com/';

  assert.equal(getEffectiveMediaProvider(), 's3');
  const config = getS3Config();
  assert.equal(config.accessKeyId, 'legacy-ak');
  assert.equal(config.bucket, 'legacy-bucket');
  assert.equal(
    config.endpoint,
    'https://s3.nl-ams.scw.cloud',
    'the region-derived Scaleway endpoint survives in the legacy branch only',
  );
  assert.equal(config.publicUrl, 'https://cdn.example.com');

  const warnings = mediaConfigWarnings();
  for (const [legacy, replacement] of [
    ['MEDIA_STORAGE_MODE=scaleway', 'MEDIA_STORAGE_MODE=s3'],
    ['SCW_ACCESS_KEY', 'S3_ACCESS_KEY'],
    ['SCW_SECRET_KEY', 'S3_SECRET_KEY'],
    ['SCW_BUCKET', 'S3_BUCKET'],
    ['SCW_CDN_URL', 'S3_PUBLIC_URL'],
  ]) {
    const line = warnings.find((w) => w.startsWith(legacy));
    assert.ok(line, `expected a warning for ${legacy}`);
    assert.match(line, new RegExp(replacement));
    assert.match(line, /2026-11-01/);
  }
  assert.ok(
    warnings.some((w) => /derived from SCW_REGION/.test(w)),
    'the derived endpoint warns too — it disappears on the same date',
  );
});

test('(d) S3_* wins when both are set, and the warning says so', () => {
  setS3Env();
  setLegacyEnv();

  const config = getS3Config();
  assert.equal(config.accessKeyId, 'ak');
  assert.equal(config.bucket, 'media');
  assert.equal(config.endpoint, 'https://s3.eu-central-1.example.com');

  const line = mediaConfigWarnings().find((w) => w.startsWith('SCW_BUCKET'));
  assert.match(line, /S3_BUCKET is also set and takes precedence/);
});

test('(e) the public base URL: explicit wins, else derived from the endpoint', () => {
  assert.equal(
    derivePublicBaseUrl('https://s3.nl-ams.scw.cloud', 'media'),
    'https://media.s3.nl-ams.scw.cloud',
  );
  assert.equal(
    derivePublicBaseUrl('https://s3.nl-ams.scw.cloud/', 'media'),
    'https://media.s3.nl-ams.scw.cloud',
    'a trailing slash on the endpoint changes nothing',
  );
  assert.equal(derivePublicBaseUrl('', 'media'), '');
  assert.equal(derivePublicBaseUrl('not a url', 'media'), '');

  setS3Env();
  process.env.S3_PUBLIC_URL = 'https://media.example.com/';
  assert.equal(
    getS3Config().publicUrl,
    'https://media.example.com',
    'the trailing slash is normalised away so key joining stays single-slash',
  );
});
