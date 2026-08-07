/**
 * Pin: `getOrgId(ctx)` refuses a context with no organization.
 *
 * `getOrgId` used to fall back to the default organization when the context
 * carried none (`ctx?.organizationId || getDefaultOrganizationId()`). On a
 * multi-organization instance that turns a missing organization into an unfiltered
 * query against the *default* organization — the tenant-isolation leak
 * `server/storage/scope.js` refuses to allow, in another guise. The org-scoping
 * fallback-sweep made `getOrgId` refuse instead (brief `org-scoping-decision.md`
 * § *Uitvoeringsspec fallback-sweep*: "weigeren, niet undefined"). This locks
 * that in: a call site that reaches `getOrgId` without an organization is a bug,
 * and it fails loudly rather than silently scoping to the default organization.
 *
 * Run with: node --test tests/get-org-id-refuses-empty-context.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getOrgId } from '../server/utils/context.js';

test('getOrgId returns the organization the context carries', () => {
  assert.equal(getOrgId({ organizationId: 'org_alpha' }), 'org_alpha');
  assert.equal(
    getOrgId({ organizationId: 'org_beta', actorEmail: 'a@b.c' }),
    'org_beta'
  );
});

test('getOrgId throws — never a silent default — when the context has no organization', () => {
  // Every shape a missing organization can take must throw, not fall back.
  for (const ctx of [undefined, null, {}, { organizationId: undefined }, { organizationId: '' }]) {
    assert.throws(
      () => getOrgId(ctx),
      /no organization to act in/,
      `expected getOrgId(${JSON.stringify(ctx)}) to throw`
    );
  }
});
