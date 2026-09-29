#!/usr/bin/env node

/**
 * Create an organization on a multi-organization instance, without the UI.
 *
 * Usage:
 *   npm run org:create -- --slug acme --name "Acme" [--external-id <idp-org-id>] [--owner you@acme.example]
 *
 * Idempotent on the slug: rerunning the same command reports the organization
 * that is already there and changes nothing. A rerun that *disagrees* with what
 * is there (another name, another external ID, an owner who is not the owner)
 * is refused rather than applied — this command creates, it does not edit. Edit
 * an existing organization in its settings, or with `PATCH /api/organizations/:id`.
 *
 * `--owner` gives the organization its first member, as owner: the same
 * membership a first login writes into an empty organization
 * (`ensureMembership`, server/storage/login-membership.js). A person with no
 * account yet gets one, homed in this organization, without an invitation
 * mail; they sign in with SSO or a magic link, or an instance admin resends the
 * invitation from Admin → Users.
 *
 * Runbook: docs/ops/multi-organization.md.
 */

import { parseArgs } from 'node:util';

import { isCli } from './lib/is-cli.js';
import { loadDotEnv } from '../server/config/env.js';
import { repoRoot } from '../server/config/paths.js';
import { isMultiOrgEnabled } from '../server/config/features.js';
import {
  initializeStorage,
  closeStorage,
} from '../server/storage/lifecycle.js';
import {
  addMember,
  countOrganizationMembers,
  createOrganization,
  getMembership,
  getOrganizationBySlug,
  isValidOrganizationSlug,
} from '../server/storage/user-organizations/index.js';
import { getUserByEmailGlobal } from '../server/storage/identity.js';
import { createUser } from '../server/storage/users.js';
import { normalizeEmail } from '../server/utils/normalize.js';

const USAGE =
  'npm run org:create -- --slug <slug> --name <name> [--external-id <id>] [--owner <email>]';

/**
 * @typedef {object} OrgCreateInput
 * @property {string} slug
 * @property {string} name
 * @property {string|null} [externalId]
 * @property {string|null} [ownerEmail]
 */

/**
 * @typedef {object} OrgCreateResult
 * @property {true} ok
 * @property {Object} organization - The organization as stored
 * @property {boolean} created - false: it was already there
 * @property {{ email: string, accountCreated: boolean, membershipAdded: boolean } | null} owner
 */

/**
 * Create the organization, or confirm the one that is already there, and give
 * it its owner. Storage must be initialized.
 *
 * @param {OrgCreateInput} input
 * @returns {Promise<OrgCreateResult | { ok: false, message: string }>}
 */
export async function provisionOrganization(input) {
  const refuse = (message) => ({ ok: false, message });

  if (!isMultiOrgEnabled()) {
    return refuse(
      'MULTI_ORG_ENABLED is off: this instance has one organization. Turn it on first (docs/ops/multi-organization.md).',
    );
  }

  const slug = String(input.slug || '')
    .trim()
    .toLowerCase();
  const name = String(input.name || '').trim();
  const externalId = input.externalId?.trim() || null;
  const ownerEmail = input.ownerEmail ? normalizeEmail(input.ownerEmail) : null;

  if (!isValidOrganizationSlug(slug)) {
    return refuse(
      'Slug must be 2-63 characters, lowercase alphanumeric with optional hyphens',
    );
  }
  if (name.length < 2) {
    return refuse('Organization name must be at least 2 characters');
  }
  if (externalId && externalId.length > 255) {
    return refuse('External ID must be at most 255 characters');
  }
  if (input.ownerEmail && !ownerEmail?.includes('@')) {
    return refuse(`Not an email address: ${input.ownerEmail}`);
  }

  let organization = await getOrganizationBySlug(slug);
  let created = false;
  if (organization) {
    if (organization.name !== name) {
      return refuse(
        `Organization "${slug}" exists with name "${organization.name}", not "${name}". This command does not rename.`,
      );
    }
    if (externalId && organization.externalId !== externalId) {
      return refuse(
        `Organization "${slug}" exists with external ID ${organization.externalId ?? '(none)'}, not ${externalId}. This command does not rebind.`,
      );
    }
  } else {
    const result = await createOrganization({ name, slug, externalId });
    if (!result.ok) {
      return refuse(
        result.reason === 'external_id_exists'
          ? `External ID ${externalId} already routes logins to another organization`
          : `Could not create the organization: ${result.reason}`,
      );
    }
    organization = result.organization;
    created = true;
  }

  if (!ownerEmail) return { ok: true, organization, created, owner: null };

  let user = await getUserByEmailGlobal(ownerEmail);
  let accountCreated = false;
  if (!user) {
    // The organization being provisioned is the one this act happens in, so
    // the new account is homed there.
    const scope = { repoRoot, organizationId: organization.id };
    const result = await createUser(scope, { email: ownerEmail, role: 'user' });
    if (!result.ok) {
      return refuse(`Could not create the owner's account: ${result.reason}`);
    }
    user = result.user;
    accountCreated = true;
  }

  const membership = await getMembership(user.id, organization.id);
  if (membership) {
    if (membership.role !== 'owner') {
      return refuse(
        `${ownerEmail} is already a ${membership.role} of "${slug}", not its owner. This command does not change roles.`,
      );
    }
    return {
      ok: true,
      organization,
      created,
      owner: { email: ownerEmail, accountCreated, membershipAdded: false },
    };
  }

  if ((await countOrganizationMembers(organization.id)) > 0) {
    return refuse(
      `"${slug}" already has members; invite ${ownerEmail} from the organization's member settings instead.`,
    );
  }

  const added = await addMember({
    userId: user.id,
    organizationId: organization.id,
    role: 'owner',
  });
  if (!added.ok) {
    return refuse(`Could not add the owner: ${added.reason}`);
  }
  return {
    ok: true,
    organization,
    created,
    owner: { email: ownerEmail, accountCreated, membershipAdded: true },
  };
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        slug: { type: 'string' },
        name: { type: 'string' },
        'external-id': { type: 'string' },
        owner: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    console.error(err.message);
    console.error(`Usage: ${USAGE}`);
    process.exit(1);
  }
  if (!values.slug || !values.name) {
    console.error(`Usage: ${USAGE}`);
    process.exit(1);
  }

  await loadDotEnv(repoRoot);
  await initializeStorage();
  try {
    const result = await provisionOrganization({
      slug: values.slug,
      name: values.name,
      externalId: values['external-id'] ?? null,
      ownerEmail: values.owner ?? null,
    });
    if (!result.ok) {
      console.error(result.message);
      process.exitCode = 1;
      return;
    }
    const { organization, created, owner } = result;
    console.log(
      `${created ? 'Created' : 'Already there'}: ${organization.name} (${organization.slug})`,
    );
    console.log(`  id:          ${organization.id}`);
    console.log(`  external id: ${organization.externalId ?? '(none)'}`);
    if (owner) {
      const account = owner.accountCreated ? 'new account, ' : '';
      const membership = owner.membershipAdded ? 'added' : 'already owner';
      console.log(`  owner:       ${owner.email} (${account}${membership})`);
      if (owner.accountCreated) {
        console.log(
          '  No invitation mail was sent: the owner signs in with SSO or a magic link, or resend the invitation from Admin → Users.',
        );
      }
    }
  } finally {
    await closeStorage();
  }
}

if (isCli(import.meta.url)) {
  // Exit explicitly: after closeStorage() the process still does not end on
  // its own (a handle opened during storage initialization stays live), and a
  // provisioning script that hangs reads as one still working.
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (err) => {
      console.error('Error:', err.message);
      process.exit(1);
    },
  );
}
