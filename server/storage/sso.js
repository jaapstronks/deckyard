/**
 * Storage layer for SSO (OIDC) users. JIT-provisions or updates a user from a
 * verified SSO identity and returns the object `setSessionCookie` needs.
 *
 * Mirrors {@link getOrCreateMagicLinkUser}: upsert by (email, organization_id),
 * set `auth_source`, and derive a session-version key from the same source the
 * async validator recomputes (`password_changed_at || updated_at`), so the
 * minted cookie validates on the next request.
 *
 * @see server/storage/magic-link.js
 * @see server/auth/auth.js (getUserFromRequestAsync, setSessionCookie)
 */

import crypto from 'node:crypto';
import { getOrgId } from '../utils/context.js';
import { nowIso, normalizeEmail } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';

/**
 * The AUTH_ADMIN_EMAIL bootstrap admin, lowercased, or '' when unset.
 * @returns {string}
 */
function getAdminEmail() {
  return String(process.env.AUTH_ADMIN_EMAIL || '').trim().toLowerCase();
}

/**
 * Session-version key matching the calculation in auth.js: sha256 of
 * `password_changed_at || updated_at`, base64url, first 12 chars.
 * @param {object} user - DB row with password_changed_at / updated_at.
 * @param {string} fallbackNow - ISO string to use when both are absent.
 * @returns {string}
 */
function sessionVersion(user, fallbackNow) {
  const versionSource = user.password_changed_at || user.updated_at || fallbackNow;
  return crypto
    .createHash('sha256')
    .update(String(versionSource))
    .digest('base64url')
    .slice(0, 12);
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
 * @param {{ email: string, name?: string, isAdmin?: boolean }} identity - From
 *   {@link mapClaimsToIdentity}.
 * @param {object} opts
 * @param {boolean} opts.autoProvision - When false, unknown users are rejected
 *   rather than created.
 * @param {string} opts.defaultRole - Role for newly provisioned users ('user'|'admin').
 * @param {object} ctx - Route context (repoRoot, req) for org resolution.
 * @returns {Promise<{ ok: true, user: object, provisioned: boolean } | { ok: false, reason: string }>}
 */
export async function getOrCreateSsoUser(identity, opts, ctx) {
  const email = normalizeEmail(identity?.email);
  if (!email || !email.includes('@')) {
    return { ok: false, reason: 'invalid_email' };
  }

  const name = String(identity?.name || '').trim();
  const grantsAdmin = !!identity?.isAdmin || email === getAdminEmail();
  const defaultRole = opts?.defaultRole === 'admin' ? 'admin' : 'user';

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    let user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

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
    }

    const adminEmail = getAdminEmail();
    const role = user.role === 'admin' || email === adminEmail ? 'admin' : 'user';

    return {
      ok: true,
      provisioned,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || '',
        role,
        isAdmin: role === 'admin',
        v: sessionVersion(user, now),
      },
    };
  });
}
