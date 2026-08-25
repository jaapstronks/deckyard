/**
 * Storage layer for SSO (OIDC) users. JIT-provisions or updates a user from a
 * verified SSO identity and returns the object `setSessionCookie` needs.
 *
 * Mirrors {@link getOrCreateMagicLinkUser}: upsert by email (globally unique),
 * set `auth_source`, and stamp the session-version key from the shared
 * {@link sessionVersion} helper the async validator also uses, so the minted
 * cookie validates on the next request.
 *
 * @see server/utils/session-version.js
 * @see server/storage/magic-link.js
 * @see server/auth/auth.js (getUserFromRequestAsync, setSessionCookie)
 */

import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { getUserByEmailGlobal } from './identity.js';
import { nowIso, normalizeEmail } from '../utils/normalize.js';
import { sessionVersion } from '../utils/session-version.js';
import { withDbGuard } from './utils/index.js';
import { envStr } from '../config/utils.js';
import { invalidateDisplayNames } from './display-identity.js';

/**
 * The AUTH_ADMIN_EMAIL bootstrap admin, lowercased, or '' when unset.
 * @returns {string}
 */
function getAdminEmail() {
  return envStr('AUTH_ADMIN_EMAIL').toLowerCase();
}

/**
 * Provision (or update) a Deckyard user from a verified SSO identity.
 *
 * Role policy (self-hosted single-IdP): an SSO login can *grant* admin (via
 * group mapping or the AUTH_ADMIN_EMAIL match) but never auto-*demotes* — a
 * transient missing group-claim must not lock out every admin. Removing admin
 * is done through the admin-users UI. New users are provisioned at
 * `defaultRole` unless the identity is admin.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {{ email: string, name?: string, isAdmin?: boolean }} identity - From
 *   {@link mapClaimsToIdentity}.
 * @param {object} opts
 * @param {boolean} opts.autoProvision - When false, unknown users are rejected
 *   rather than created.
 * @param {string} opts.defaultRole - Role for newly provisioned users ('user'|'admin').
 * @returns {Promise<{ ok: true, user: object, provisioned: boolean } | { ok: false, reason: string }>}
 */
export async function getOrCreateSsoUser(scope, identity, opts) {
  toStorageContext(scope, 'getOrCreateSsoUser');
  const email = normalizeEmail(identity?.email);
  if (!email || !email.includes('@')) {
    return { ok: false, reason: 'invalid', field: 'email' };
  }

  const name = String(identity?.name || '').trim();
  const grantsAdmin = !!identity?.isAdmin || email === getAdminEmail();
  const defaultRole = opts?.defaultRole === 'admin' ? 'admin' : 'user';

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    // Resolved across organizations: the IdP asserts an email, and that email
    // identifies exactly one person instance-wide (users.email is unique).
    let user = await getUserByEmailGlobal(email);

    let provisioned = false;

    if (!user) {
      if (!opts?.autoProvision) {
        return { ok: false, reason: 'not_provisioned' };
      }
      const inserted = await db
        .insertInto('users')
        .values({
          organization_id: orgId,
          email,
          name: name || null,
          role: grantsAdmin ? 'admin' : defaultRole,
          auth_source: 'oidc',
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirst();
      user = inserted;
      provisioned = true;
    } else {
      // Update on login: keep name fresh, mark the source as SSO, and grant
      // admin if the identity says so (never demote — see policy above).
      const updates = { auth_source: 'oidc', updated_at: now };
      if (name && name !== user.name) updates.name = name;
      if (grantsAdmin && user.role !== 'admin') updates.role = 'admin';

      const updated = await db
        .updateTable('users')
        .set(updates)
        .where('id', '=', user.id)
        .returningAll()
        .executeTakeFirst();
      user = updated || { ...user, ...updates };
      // `users.name` feeds the memoized response `displayName`
      // (storage/display-identity.js); a rename at login lands now, not
      // within the TTL.
      if (updates.name) invalidateDisplayNames();
    }

    const adminEmail = getAdminEmail();
    const role =
      user.role === 'admin' || email === adminEmail ? 'admin' : 'user';

    return {
      ok: true,
      provisioned,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || '',
        role,
        isAdmin: role === 'admin',
        v: sessionVersion(user),
      },
    };
  });
}
