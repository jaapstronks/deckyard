/**
 * Tests for the white-label branding config (server/config/branding.js):
 * APP_NAME default + override, HELP_URL and APP_LOGO_URL validation, and the
 * boot warnings for a value that is set but unusable.
 *
 * Run with: node --test tests/branding-config.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import {
  getAppName,
  getAppLogoUrl,
  getHelpUrl,
  getBranding,
  brandingConfigWarnings,
} from '../server/config/branding.js';

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
    for (const bad of [
      'javascript:alert(1)',
      'ftp://x',
      '/docs',
      'docs.example.com',
    ]) {
      process.env.HELP_URL = bad;
      assert.equal(getHelpUrl(), null, `expected null for ${bad}`);
    }
  });
});

describe('getBranding', () => {
  it('bundles appName + helpUrl for the client payload', () => {
    const prevName = process.env.APP_NAME;
    const prevUrl = process.env.HELP_URL;
    const prevLogo = process.env.APP_LOGO_URL;
    process.env.APP_NAME = 'Acme Decks';
    process.env.HELP_URL = 'https://help.acme.test';
    process.env.APP_LOGO_URL = '/custom/assets/images/acme.svg';
    try {
      assert.deepEqual(getBranding(), {
        appName: 'Acme Decks',
        helpUrl: 'https://help.acme.test',
        logoUrl: '/custom/assets/images/acme.svg',
      });
    } finally {
      if (prevName === undefined) delete process.env.APP_NAME;
      else process.env.APP_NAME = prevName;
      if (prevUrl === undefined) delete process.env.HELP_URL;
      else process.env.HELP_URL = prevUrl;
      if (prevLogo === undefined) delete process.env.APP_LOGO_URL;
      else process.env.APP_LOGO_URL = prevLogo;
    }
  });
});

describe('getAppLogoUrl (B432)', () => {
  let saved;
  beforeEach(() => {
    saved = process.env.APP_LOGO_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_LOGO_URL;
    else process.env.APP_LOGO_URL = saved;
  });

  it('is null when unset: the upstream logo applies', () => {
    delete process.env.APP_LOGO_URL;
    assert.equal(getAppLogoUrl(), null);
  });

  it('accepts an absolute http(s) URL and a root-relative path', () => {
    for (const ok of [
      'https://cdn.acme.test/logo.svg',
      '/custom/assets/images/acme/lockup.svg',
    ]) {
      process.env.APP_LOGO_URL = `  ${ok}  `;
      assert.equal(getAppLogoUrl(), ok);
    }
  });

  it('refuses protocol-relative, relative and non-http values', () => {
    for (const bad of [
      '//evil.test/logo.svg',
      'logo.svg',
      'javascript:alert(1)',
      'data:image/svg+xml,<svg/>',
    ]) {
      process.env.APP_LOGO_URL = bad;
      assert.equal(getAppLogoUrl(), null, `expected null for ${bad}`);
    }
  });
});

describe('brandingConfigWarnings', () => {
  let savedLogo;
  let savedHelp;
  beforeEach(() => {
    savedLogo = process.env.APP_LOGO_URL;
    savedHelp = process.env.HELP_URL;
  });
  afterEach(() => {
    if (savedLogo === undefined) delete process.env.APP_LOGO_URL;
    else process.env.APP_LOGO_URL = savedLogo;
    if (savedHelp === undefined) delete process.env.HELP_URL;
    else process.env.HELP_URL = savedHelp;
  });

  it('is quiet when nothing is set, or everything is usable', () => {
    delete process.env.APP_LOGO_URL;
    delete process.env.HELP_URL;
    assert.deepEqual(brandingConfigWarnings(), []);
    process.env.APP_LOGO_URL = '/custom/assets/images/logo.svg';
    process.env.HELP_URL = 'https://docs.example.com';
    assert.deepEqual(brandingConfigWarnings(), []);
  });

  it('names each value that is set but ignored', () => {
    process.env.APP_LOGO_URL = 'logo.svg';
    process.env.HELP_URL = '/docs';
    const warnings = brandingConfigWarnings();
    assert.equal(warnings.length, 2);
    assert.match(warnings.join('\n'), /HELP_URL="\/docs"/);
    assert.match(warnings.join('\n'), /APP_LOGO_URL="logo\.svg"/);
  });
});
