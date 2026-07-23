import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapClaimsToIdentity, OidcError } from '../server/auth/providers/oidc.js';

/**
 * Pure claim -> identity mapping for OIDC SSO. Security gates: email present +
 * verified, optional hosted-domain allowlist, and group -> admin mapping.
 */

const BASE = {
  allowedDomains: [],
  adminGroups: [],
  autoProvision: true,
  defaultRole: 'user',
  issuerUrl: 'https://idp.example.com',
  clientId: 'c',
  clientSecret: 's',
  redirectUri: 'https://deck.example.com/api/auth/oidc/callback',
};

test('rejects missing email', () => {
  assert.throws(
    () => mapClaimsToIdentity({ email_verified: true }, BASE),
    (e) => e instanceof OidcError && e.reason === 'no_email'
  );
});

test('rejects unverified email', () => {
  assert.throws(
    () => mapClaimsToIdentity({ email: 'a@example.com', email_verified: false }, BASE),
    (e) => e instanceof OidcError && e.reason === 'email_unverified'
  );
});

test('accepts email_verified as the string "true"', () => {
  const id = mapClaimsToIdentity(
    { email: 'a@example.com', email_verified: 'true', name: 'Ann' },
    BASE
  );
  assert.equal(id.email, 'a@example.com');
  assert.equal(id.name, 'Ann');
  assert.equal(id.isAdmin, false);
});

test('normalizes email to lowercase', () => {
  const id = mapClaimsToIdentity({ email: 'Ann@Example.COM', email_verified: true }, BASE);
  assert.equal(id.email, 'ann@example.com');
});

test('composes name from given/family when name absent', () => {
  const id = mapClaimsToIdentity(
    { email: 'a@example.com', email_verified: true, given_name: 'Ann', family_name: 'Lee' },
    BASE
  );
  assert.equal(id.name, 'Ann Lee');
});

test('hosted-domain guard rejects other domains', () => {
  const cfg = { ...BASE, allowedDomains: ['example.com'] };
  assert.throws(
    () => mapClaimsToIdentity({ email: 'a@evil.com', email_verified: true }, cfg),
    (e) => e instanceof OidcError && e.reason === 'domain_not_allowed'
  );
  const id = mapClaimsToIdentity({ email: 'a@example.com', email_verified: true }, cfg);
  assert.equal(id.email, 'a@example.com');
});

test('admin group mapping (array claim)', () => {
  const cfg = { ...BASE, adminGroups: ['deckyard-admins'] };
  const admin = mapClaimsToIdentity(
    { email: 'a@example.com', email_verified: true, groups: ['Users', 'Deckyard-Admins'] },
    cfg
  );
  assert.equal(admin.isAdmin, true);
  const user = mapClaimsToIdentity(
    { email: 'b@example.com', email_verified: true, groups: ['Users'] },
    cfg
  );
  assert.equal(user.isAdmin, false);
});

test('admin group mapping (space/comma string claim, roles key)', () => {
  const cfg = { ...BASE, adminGroups: ['ops'] };
  const id = mapClaimsToIdentity(
    { email: 'a@example.com', email_verified: true, roles: 'viewer ops' },
    cfg
  );
  assert.equal(id.isAdmin, true);
});

test('no admin groups configured → never admin from claims', () => {
  const id = mapClaimsToIdentity(
    { email: 'a@example.com', email_verified: true, groups: ['admins'] },
    BASE
  );
  assert.equal(id.isAdmin, false);
});
