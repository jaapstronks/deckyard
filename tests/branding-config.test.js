/**
 * Tests for the white-label branding config (server/config/branding.js):
 * APP_NAME default + override, and HELP_URL validation.
 *
 * Run with: node --test tests/branding-config.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import { getAppName, getHelpUrl, getBranding } from '../server/config/branding.js';

describe('getAppName', () => {
  let saved;
  beforeEach(() => {
    saved = process.env.APP_NAME;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = saved;
  });

  it('defaults to "Deckyard" when unset', () => {
    delete process.env.APP_NAME;
    assert.equal(getAppName(), 'Deckyard');
  });

  it('defaults to "Deckyard" when blank/whitespace', () => {
    process.env.APP_NAME = '   ';
    assert.equal(getAppName(), 'Deckyard');
  });

  it('returns the configured name, trimmed', () => {
    process.env.APP_NAME = '  CIIIC Slides  ';
    assert.equal(getAppName(), 'CIIIC Slides');
  });
});

describe('getHelpUrl', () => {
  let saved;
  beforeEach(() => {
    saved = process.env.HELP_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.HELP_URL;
    else process.env.HELP_URL = saved;
  });

  it('is null when unset', () => {
    delete process.env.HELP_URL;
    assert.equal(getHelpUrl(), null);
  });

  it('accepts absolute http(s) URLs', () => {
    process.env.HELP_URL = 'https://docs.example.com';
    assert.equal(getHelpUrl(), 'https://docs.example.com');
  });

  it('rejects non-http(s) schemes (javascript:, ftp:, relative)', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://x', '/docs', 'docs.example.com']) {
      process.env.HELP_URL = bad;
      assert.equal(getHelpUrl(), null, `expected null for ${bad}`);
    }
  });
});

describe('getBranding', () => {
  it('bundles appName + helpUrl for the client payload', () => {
    const prevName = process.env.APP_NAME;
    const prevUrl = process.env.HELP_URL;
    process.env.APP_NAME = 'Acme Decks';
    process.env.HELP_URL = 'https://help.acme.test';
    try {
      assert.deepEqual(getBranding(), {
        appName: 'Acme Decks',
        helpUrl: 'https://help.acme.test',
      });
    } finally {
      if (prevName === undefined) delete process.env.APP_NAME;
      else process.env.APP_NAME = prevName;
      if (prevUrl === undefined) delete process.env.HELP_URL;
      else process.env.HELP_URL = prevUrl;
    }
  });
});
