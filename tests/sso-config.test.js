import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ssoConfigError,
  isSsoEnabled,
  isSsoEnforced,
  getSsoProvider,
  getOidcConfig,
  getSsoPublicConfig,
} from '../server/config/sso.js';

/**
 * Track 1 SSO config reader + boot validation. A half-configured SSO must fail
 * loudly (ssoConfigError returns a string) and isSsoEnabled must be false
 * whenever a login attempt would fail for lack of config.
 */

const SSO_KEYS = [
  'SSO_ENABLED', 'SSO_PROVIDER', 'SSO_ENFORCE',
  'OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI', 'OIDC_ALLOWED_DOMAINS', 'OIDC_AUTO_PROVISION',
  'OIDC_DEFAULT_ROLE', 'OIDC_ADMIN_GROUPS',
];

function withEnv(env, fn) {
  const saved = {};
  for (const k of SSO_KEYS) saved[k] = process.env[k];
  for (const k of SSO_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const k of SSO_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const FULL = {
  SSO_ENABLED: 'true',
  SSO_PROVIDER: 'oidc',
  OIDC_ISSUER_URL: 'https://login.example.com',
  OIDC_CLIENT_ID: 'client-abc',
  OIDC_CLIENT_SECRET: 'secret-xyz',
  OIDC_REDIRECT_URI: 'https://deck.example.com/api/auth/oidc/callback',
};

test('disabled → no error, not enabled', () => {
  withEnv({}, () => {
    assert.equal(ssoConfigError(), null);
    assert.equal(isSsoEnabled(), false);
    assert.equal(getSsoProvider(), null);
  });
});

test('enabled but no provider → error', () => {
  withEnv({ SSO_ENABLED: 'true' }, () => {
    assert.equal(typeof ssoConfigError(), 'string');
    assert.equal(isSsoEnabled(), false);
  });
});

test('unsupported provider → error', () => {
  withEnv({ SSO_ENABLED: 'true', SSO_PROVIDER: 'saml' }, () => {
    assert.match(ssoConfigError(), /not supported/i);
    assert.equal(isSsoEnabled(), false);
  });
});

test('missing required OIDC fields → error listing them', () => {
  withEnv({ SSO_ENABLED: 'true', SSO_PROVIDER: 'oidc' }, () => {
    const err = ssoConfigError();
    assert.match(err, /OIDC_ISSUER_URL/);
    assert.match(err, /OIDC_CLIENT_ID/);
    assert.equal(isSsoEnabled(), false);
  });
});

test('malformed issuer URL → error', () => {
  withEnv({ ...FULL, OIDC_ISSUER_URL: 'not a url' }, () => {
    assert.match(ssoConfigError(), /not a valid absolute URL/i);
    assert.equal(isSsoEnabled(), false);
  });
});

test('fully configured → no error, enabled', () => {
  withEnv(FULL, () => {
    assert.equal(ssoConfigError(), null);
    assert.equal(isSsoEnabled(), true);
    assert.equal(getSsoProvider(), 'oidc');
  });
});

test('enforce requires enabled', () => {
  withEnv({ SSO_ENFORCE: 'true' }, () => assert.equal(isSsoEnforced(), false));
  withEnv({ ...FULL, SSO_ENFORCE: 'true' }, () => assert.equal(isSsoEnforced(), true));
});

test('getOidcConfig parses lists, role, and auto-provision default', () => {
  withEnv(
    {
      ...FULL,
      OIDC_ALLOWED_DOMAINS: 'Example.com, other.org',
      OIDC_ADMIN_GROUPS: 'Deckyard-Admins,ops',
      OIDC_DEFAULT_ROLE: 'admin',
    },
    () => {
      const c = getOidcConfig();
      assert.deepEqual(c.allowedDomains, ['example.com', 'other.org']);
      assert.deepEqual(c.adminGroups, ['deckyard-admins', 'ops']);
      assert.equal(c.defaultRole, 'admin');
      assert.equal(c.autoProvision, true); // default when unset
    }
  );
  withEnv({ ...FULL, OIDC_AUTO_PROVISION: 'false' }, () => {
    assert.equal(getOidcConfig().autoProvision, false);
  });
  withEnv({ ...FULL, OIDC_DEFAULT_ROLE: 'weird' }, () => {
    assert.equal(getOidcConfig().defaultRole, 'user'); // falls back to user
  });
});

test('getSsoPublicConfig exposes no secret', () => {
  withEnv({ ...FULL, SSO_ENFORCE: 'true' }, () => {
    const pub = getSsoPublicConfig();
    assert.deepEqual(pub, {
      enabled: true,
      enforce: true,
      provider: 'oidc',
      loginPath: '/api/auth/oidc/login',
    });
    assert.equal(JSON.stringify(pub).includes('secret-xyz'), false);
  });
});
