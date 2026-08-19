/**
 * Storage scopes — the object every stored-deck operation acts under.
 *
 * A scope answers two questions that a storage call cannot answer for itself:
 * **which organization does this act in**, and **on whose behalf**. Before this
 * module the presentations facade answered the first one itself, with a
 * hardcoded `getDefaultOrganizationId()`. That is fine while an instance holds
 * one organization and wrong the moment it holds two: every read would look in
 * the default organization rather than the one the session is working in.
 *
 * The rule this module enforces is therefore blunt: **a storage call may not
 * invent an organization the caller did not give it.** There is no fallback. A
 * caller either states the organization, or states — in writing, with a reason —
 * that the operation is deliberately not organization-scoped.
 *
 * ## The two legitimate shapes
 *
 * 1. **An organization-scoped scope.** `{ repoRoot, organizationId, actorEmail }`.
 *    Route handlers get this from {@link module:server/utils/context.createStorageScope},
 *    which since #356 carries the membership-verified session organization.
 *
 * 2. **A cross-organization scope.** `{ repoRoot, crossOrganization: '<reason>' }`.
 *    For paths where no session exists *and no organization can*: a published
 *    deck, an embed, a share link, a follow-along audience. Those resolve a
 *    globally unique token first (`getPublishedById`, `getShareLinkByToken`) and
 *    fetch the deck by the id that token yielded — the token *is* the
 *    authorization, so an organization filter adds nothing and, on a
 *    multi-organization instance, would break every public link. The reason
 *    string is mandatory so these stay countable: `grep -r crossOrganization`
 *    lists every deliberately unscoped read in the codebase.
 *
 * Anything else — a bare `repoRoot` string, `null`, an object with neither
 * field — throws. That is the point: an un-migrated call site fails loudly at
 * the first request instead of quietly reading the wrong organization.
 *
 * @module server/storage/scope
 */

import { getDefaultOrganizationId } from '../config/database.js';
import { isMultiOrgEnabled } from '../config/features.js';

/**
 * @typedef {Object} StorageScope
 * @property {string|null} [repoRoot] - Repository root: the disk path for uploads, thumbnails and theme files.
 * @property {string} [organizationId] - The organization this operation acts in.
 * @property {string|null} [actorEmail] - Who the operation is attributed to.
 * @property {string} [crossOrganization] - Reason this operation is deliberately unscoped.
 */

/**
 * Validate a scope and reduce it to the context the storage adapters take.
 *
 * @param {StorageScope} storageScope - The caller's scope.
 * @param {string} operation - Facade function name, for the error message.
 * @param {Object} [options]
 * @param {boolean} [options.allowCrossOrganization=false] - Whether this operation
 *   may run unscoped. Reads of a token-addressed deck may; **writes never may**,
 *   because a write without an organization would land on whatever the storage
 *   layer picked — which is the behaviour this module exists to remove.
 * @returns {{organizationId: string|undefined, actorEmail: string|null, crossOrganization: string|undefined}}
 * @throws {TypeError} If the scope states no organization and declares no reason.
 */
export function resolveScope(
  storageScope,
  operation,
  { allowCrossOrganization = false } = {},
) {
  if (typeof storageScope === 'string') {
    throw new TypeError(
      `${operation}() takes a storage scope, not a repoRoot string. ` +
        'Pass createStorageScope(authedUser, { repoRoot }) on session paths, or ' +
        "crossOrganizationScope(repoRoot, '<reason>') where a public token is the authorization. " +
        'See server/storage/scope.js.',
    );
  }
  if (!storageScope || typeof storageScope !== 'object') {
    throw new TypeError(
      `${operation}() requires a storage scope; received ${storageScope === null ? 'null' : typeof storageScope}. ` +
        'See server/storage/scope.js.',
    );
  }

  const crossOrganization =
    typeof storageScope.crossOrganization === 'string' &&
    storageScope.crossOrganization.trim()
      ? storageScope.crossOrganization.trim()
      : undefined;
  const organizationId =
    typeof storageScope.organizationId === 'string' &&
    storageScope.organizationId
      ? storageScope.organizationId
      : undefined;

  if (!organizationId && !crossOrganization) {
    throw new TypeError(
      `${operation}() was given a scope with no organizationId. A storage call may not ` +
        'fall back to the default organization: state the organization, or declare ' +
        "crossOrganization: '<reason>' when a public token is the authorization. " +
        'See server/storage/scope.js.',
    );
  }

  if (crossOrganization && !organizationId && !allowCrossOrganization) {
    throw new TypeError(
      `${operation}() cannot run cross-organization (declared: "${crossOrganization}"). ` +
        'Only reads of a deck addressed by a public token may skip the organization ' +
        'filter; an operation that writes must state the organization it writes in, ' +
        'or it would land wherever the storage layer guessed. See server/storage/scope.js.',
    );
  }

  return {
    organizationId,
    actorEmail: storageScope.actorEmail ?? null,
    crossOrganization,
  };
}

/**
 * The repository root a scope carries — the disk path for uploads, thumbnails
 * and theme files.
 *
 * Unlike the organization this is allowed to be absent: paths that never touch
 * the disk (analytics ingest, for one) have no repo root to give, and the six
 * disk-path functions are never reached from there.
 *
 * @param {StorageScope} storageScope
 * @returns {string|null}
 */
export function repoRootOf(storageScope) {
  return storageScope && typeof storageScope === 'object'
    ? (storageScope.repoRoot ?? null)
    : null;
}

/**
 * Build a scope for an operation whose authorization is a public token rather
 * than a session, so it must not be organization-filtered.
 *
 * Three uses are legitimate (docs/reference/storage-scope.md § when a scope
 * may be cross-organization):
 *
 * 1. A globally unique token has already been resolved (publish id, share
 *    token, follow code) and the deck id came *out* of that lookup.
 * 2. Session-capability audience interactions: the live session id or follow
 *    code *is* the authorization, and the rows are keyed by session, not
 *    organization (Q&A, poll/likert votes, feedback).
 * 3. Instance-level configuration whose tables carry no organization column
 *    (app settings, user settings, email templates).
 *
 * It is not an escape hatch for "I don't have a context here" — a background
 * job that lost its organization should carry the organization in its
 * payload, not declare itself cross-organization.
 *
 * @param {string|null} repoRoot - Repository root: the disk path for uploads, thumbnails and theme files.
 * @param {string} reason - Why this operation cannot be organization-scoped.
 * @param {Object} [extra] - Additional scope fields (e.g. actorEmail).
 * @returns {StorageScope}
 */
export function crossOrganizationScope(repoRoot, reason, extra = {}) {
  if (!reason || typeof reason !== 'string') {
    throw new TypeError('crossOrganizationScope() requires a reason string.');
  }
  return { repoRoot: repoRoot ?? null, ...extra, crossOrganization: reason };
}

/**
 * Build a scope for an entry point that has no organization *because the
 * deployment has only one*: the stdio MCP server, a CLI script, a maintenance
 * task. Those are bound to an instance, not to an organization within it.
 *
 * It answers with the configured default organization, but only in
 * single-organization mode. Once an instance holds several organizations "the
 * default one" stops being an answer, so it throws instead — the entry point
 * has to be given a real organization before it can run there.
 *
 * @param {string|null} repoRoot - Repository root: the disk path for uploads, thumbnails and theme files.
 * @param {string} entryPoint - What is asking, for the error message.
 * @param {Object} [extra] - Additional scope fields (e.g. actorEmail).
 * @returns {StorageScope}
 */
export function singleOrganizationScope(repoRoot, entryPoint, extra = {}) {
  if (isMultiOrgEnabled()) {
    throw new Error(
      `${entryPoint} has no organization to act in, and this instance runs several. ` +
        'Give it one explicitly rather than letting it fall back to the default organization.',
    );
  }
  return {
    repoRoot: repoRoot ?? null,
    ...extra,
    organizationId: getDefaultOrganizationId(),
  };
}

/**
 * Build a scope for a background job from its payload.
 *
 * Queued work runs outside any request, so the organization has to travel in
 * the job payload. When it did not — a job enqueued before that field existed,
 * or a single-organization instance that has only ever had one answer — this falls
 * back to {@link singleOrganizationScope}, which is exact on a single-organization
 * instance and throws rather than guess on one that holds several.
 *
 * @param {Object} jobData - The job payload.
 * @param {string} operation - Job name, for the error message.
 * @returns {StorageScope}
 */
export function jobScope(jobData, operation) {
  const organizationId = jobData?.organizationId;
  const repoRoot = jobData?.repoRoot ?? null;
  const actorEmail = jobData?.actorEmail ?? jobData?.ownerEmail ?? null;
  if (typeof organizationId === 'string' && organizationId) {
    return { repoRoot, organizationId, actorEmail };
  }
  return singleOrganizationScope(repoRoot, operation, { actorEmail });
}

/**
 * Reduce a caller's storage scope to the context the storage adapters take.
 *
 * Every facade under `server/storage/` calls this before touching storage —
 * it is the convention's first statement (docs/reference/storage-scope.md).
 * The organization is never invented: it comes from the scope or the call
 * throws (see {@link resolveScope}). Only the actor may be sharpened per
 * call: a personal-collection op names its `userEmail`, a create attributes
 * to `ownerEmail`, a write to `actorEmail`. At most one of those is ever set
 * on a given call, so the precedence below is a pick, not a priority fight.
 *
 * @param {StorageScope} storageScope - The caller's storage scope.
 * @param {string} operation - Facade function name, for the error message.
 * @param {{actorEmail?: string, userEmail?: string, ownerEmail?: string}} [opts]
 *   A sharper actor for this call.
 * @param {{allowCrossOrganization?: boolean}} [resolveOpts] - Passed through to
 *   resolveScope; set `allowCrossOrganization` for a read addressed by a public
 *   token.
 * @returns {Object} Context for the storage adapter.
 */
export function toStorageContext(
  storageScope,
  operation,
  opts = {},
  resolveOpts,
) {
  const resolved = resolveScope(storageScope, operation, resolveOpts);
  return {
    ...resolved,
    actorEmail:
      opts.actorEmail ||
      opts.userEmail ||
      opts.ownerEmail ||
      resolved.actorEmail,
  };
}
