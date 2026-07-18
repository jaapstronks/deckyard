import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateAddress,
  assertPublicHttpUrl,
  isRemoteHttpUrl,
  safeFetchRemoteImage,
} from '../server/utils/ssrf-guard.js';
import { toDataUrlIfLocal } from '../server/utils/html-utils.js';

/** Security hardening 2: SSRF guard for server-side image fetches. */

test('isPrivateAddress flags non-public IPv4', () => {
  for (const ip of [
    '127.0.0.1',
    '169.254.169.254', // cloud metadata
    '10.0.0.5',
    '172.16.3.4',
    '192.168.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
  ]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be private`);
  }
});

test('isPrivateAddress allows public IPv4', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} should be public`);
  }
});

test('isPrivateAddress flags non-public IPv6', () => {
  for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:169.254.169.254', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, `${ip} should be private`);
  }
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('isPrivateAddress rejects non-IP input', () => {
  assert.equal(isPrivateAddress('not-an-ip'), true);
  assert.equal(isPrivateAddress(''), true);
});

test('assertPublicHttpUrl blocks metadata and private IP literals', async () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/',
    'https://10.0.0.1/x.png',
    'http://[::1]/x.png',
    'http://192.168.0.1/',
  ]) {
    await assert.rejects(
      () => assertPublicHttpUrl(url),
      (e) => e.code === 'SSRF_BLOCKED_ADDRESS',
      `should block ${url}`
    );
  }
});

test('assertPublicHttpUrl blocks non-http schemes', async () => {
  for (const url of ['file:///etc/passwd', 'gopher://x/', 'ftp://x/']) {
    await assert.rejects(
      () => assertPublicHttpUrl(url),
      (e) => e.code === 'SSRF_BAD_SCHEME'
    );
  }
});

test('assertPublicHttpUrl blocks hostnames resolving to loopback (localhost)', async () => {
  await assert.rejects(
    () => assertPublicHttpUrl('http://localhost/x.png'),
    (e) => e.code === 'SSRF_BLOCKED_ADDRESS'
  );
});

test('assertPublicHttpUrl allows a public IP literal', async () => {
  const url = await assertPublicHttpUrl('https://8.8.8.8/logo.png');
  assert.equal(url.hostname, '8.8.8.8');
});

test('isRemoteHttpUrl distinguishes remote from local', () => {
  assert.equal(isRemoteHttpUrl('http://example.com/a.png'), true);
  assert.equal(isRemoteHttpUrl('https://example.com/a.png'), true);
  assert.equal(isRemoteHttpUrl('/uploads/a.png'), false);
  assert.equal(isRemoteHttpUrl('data:image/png;base64,xxx'), false);
});

test('safeFetchRemoteImage returns null for a blocked URL (no network)', async () => {
  assert.equal(await safeFetchRemoteImage('http://169.254.169.254/x'), null);
  assert.equal(await safeFetchRemoteImage('http://127.0.0.1/x'), null);
});

test('toDataUrlIfLocal with embedRemote strips a blocked remote URL', async () => {
  const out = await toDataUrlIfLocal('/repo', 'http://169.254.169.254/latest/', {
    embedRemote: true,
  });
  assert.equal(out, '');
});

test('toDataUrlIfLocal without embedRemote leaves remote URLs untouched', async () => {
  const url = 'http://169.254.169.254/latest/';
  assert.equal(await toDataUrlIfLocal('/repo', url), url);
});
