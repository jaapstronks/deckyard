/**
 * Custom Slide Types API routes.
 *
 * GET    /api/custom-slide-types          - List all (org-scoped)
 * GET    /api/custom-slide-types/:id      - Get one
 * POST   /api/custom-slide-types          - Create (designer only)
 * PUT    /api/custom-slide-types/:id      - Update (designer only)
 * DELETE /api/custom-slide-types/:id      - Delete (designer only)
 * POST   /api/custom-slide-types/:id/duplicate - Duplicate (designer only)
 * PUT    /api/custom-slide-types/reorder - Set display order (designer only)
 */

import { badRequest, methodNotAllowed, serveJson, unauthorized, notFound, requireJsonBody , withErrorHandler } from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import {
  listCustomSlideTypes,
  getCustomSlideType,
  createCustomSlideType,
  updateCustomSlideType,
  deleteCustomSlideType,
  reorderCustomSlideTypes,
} from '../../storage/custom-slide-types.js';
import { SLIDE_TYPES } from '../../../shared/slide-types.js';
import { USAGE_MAX_LENGTH } from '../../../shared/slide-types/usage.js';
import { SLIDE_TYPE_CATALOG } from '../../utils/ai/slide-catalog/definitions.js';
import { canManage } from '../../utils/route-middleware.js';

const ERROR_MESSAGES = {
  invalid_label: 'Invalid slide type label.',
  invalid_slug: 'Invalid slide type slug.',
  invalid_fields: 'Invalid field definitions.',
  invalid_usage: 'Usage rules must be text.',
  usage_too_long: `Usage rules are too long (max ${USAGE_MAX_LENGTH} characters).`,
  slug_exists: 'A slide type with this slug already exists.',
  not_found: 'Slide type not found.',
  unavailable: 'Database unavailable.',
  invalid_id: 'Invalid slide type ID.',
  invalid_order: 'Invalid slide type order.',
  order_mismatch: 'The order does not list exactly the current slide types. Reload and try again.',
};

// GET /api/custom-slide-types - List all (org-scoped)
async function handleCustomSlideTypeList({ storageScope, res, authedUser }) {
  if (!authedUser) return unauthorized(res);
  const types = await listCustomSlideTypes(storageScope);
  serveJson(res, 200, { customSlideTypes: types });
  return true;
}

// POST /api/custom-slide-types - Create (designer only)
async function handleCustomSlideTypeCreate({ storageScope, req, res, authedUser }) {
  if (!canManage(authedUser)) return unauthorized(res);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const result = await createCustomSlideType(storageScope, body);

  if (!result.ok) {
    return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to create slide type.');
  }
  serveJson(res, 201, result.customSlideType);
  return true;
}

// PUT /api/custom-slide-types/reorder - Set display order (designer only).
// One call for the whole order: N single-field PUTs would leave a
// half-applied order behind if one of them failed.
async function handleCustomSlideTypeReorder({ storageScope, req, res, authedUser }) {
  if (!canManage(authedUser)) return unauthorized(res);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const result = await reorderCustomSlideTypes(storageScope, body.order);
  if (!result.ok) {
    return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to reorder slide types.');
  }
  serveJson(res, 200, { customSlideTypes: result.customSlideTypes });
  return true;
}

// POST /api/custom-slide-types/:id/duplicate - Duplicate (designer only)
async function handleCustomSlideTypeDuplicate({ storageScope, req, res, authedUser }, sourceId) {
  if (!canManage(authedUser)) return unauthorized(res);

  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const body = parsed.body;

  // Source can be a custom type or a core type slug
  let sourceData;
  const existing = await getCustomSlideType(storageScope, sourceId);
  if (existing) {
    sourceData = existing;
  } else {
    // Try as a core type slug
    const coreDef = SLIDE_TYPES[sourceId];
    if (coreDef) {
      sourceData = {
        label: coreDef.label || sourceId,
        baseType: sourceId,
        fields: coreDef.fields || [],
        defaults: coreDef.defaults || {},
        defaultsByLang: coreDef.defaultsByLang || null,
        // Carry the core type's usage rules into the copy. "Fork our type and
        // add our own rule on top" is the whole point of duplicating one, and
        // starting from a blank rule loses whatever the catalog already said.
        usage: SLIDE_TYPE_CATALOG[sourceId]?.usage || null,
      };
    }
  }

  if (!sourceData) {
    return badRequest(res, 'Source slide type not found.');
  }

  const newLabel = body?.label || `${sourceData.label} (copy)`;
  const result = await createCustomSlideType(
    storageScope,
    {
      label: newLabel,
      baseType: sourceData.baseType || sourceData.slug || sourceId,
      fields: sourceData.fields,
      defaults: sourceData.defaults,
      defaultsByLang: sourceData.defaultsByLang,
      template: sourceData.template || null,
      css: sourceData.css || null,
      usage: sourceData.usage || null,
    }
  );

  if (!result.ok) {
    return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to duplicate slide type.');
  }
  serveJson(res, 201, result.customSlideType);
  return true;
}

// GET /api/custom-slide-types/:id - Get one
async function handleCustomSlideTypeGet({ storageScope, res, authedUser }, typeId) {
  const type = await getCustomSlideType(storageScope, typeId);
  if (!type) {
    notFound(res, 'Slide type not found.');
    return true;
  }
  serveJson(res, 200, type);
  return true;
}

// PUT /api/custom-slide-types/:id - Update (designer only)
async function handleCustomSlideTypeUpdate({ storageScope, req, res, authedUser }, typeId) {
  if (!canManage(authedUser)) return unauthorized(res);
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const result = await updateCustomSlideType(storageScope, typeId, body);
  if (!result.ok) {
    if (result.reason === 'not_found') {
      notFound(res, 'Slide type not found.');
      return true;
    }
    return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to update slide type.');
  }
  serveJson(res, 200, result.customSlideType);
  return true;
}

// DELETE /api/custom-slide-types/:id - Delete (designer only)
async function handleCustomSlideTypeDelete({ storageScope, res, authedUser }, typeId) {
  if (!canManage(authedUser)) return unauthorized(res);
  const result = await deleteCustomSlideType(storageScope, typeId);
  if (!result.ok) {
    if (result.reason === 'not_found') {
      notFound(res, 'Slide type not found.');
      return true;
    }
    return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to delete slide type.');
  }
  serveJson(res, 200, { ok: true });
  return true;
}

/**
 * Declarative route table for `/api/custom-slide-types*` (A7.19 C8). Order
 * matches the previous if-chain: the collection routes and `/reorder` come
 * before the `/:id` rows (the hex-only id pattern would not match "reorder"
 * today, but ordering the routes by shape is what keeps that true), and each
 * path that sent an explicit 405 keeps it as a trailing catch-all row.
 * `/duplicate` fell through on a wrong method (Form A) and still does.
 *
 * The per-route guards (auth on list, `canManage` on every mutation) live in
 * the handlers, exactly where the original chain ran them — `/reorder` checked
 * the method *before* the designer guard, which the PUT row + catch-all
 * preserves.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/custom-slide-types', handler: handleCustomSlideTypeList },
  { method: 'POST', pattern: '/api/custom-slide-types', handler: handleCustomSlideTypeCreate },
  { pattern: '/api/custom-slide-types', handler: ({ res }) => methodNotAllowed(res, ['GET', 'POST']) },
  { method: 'PUT', pattern: '/api/custom-slide-types/reorder', handler: handleCustomSlideTypeReorder },
  { pattern: '/api/custom-slide-types/reorder', handler: ({ res }) => methodNotAllowed(res, ['PUT']) },
  { method: 'POST', pattern: /^\/api\/custom-slide-types\/([a-f0-9-]+)\/duplicate$/, handler: handleCustomSlideTypeDuplicate },
  { method: 'GET', pattern: /^\/api\/custom-slide-types\/([a-f0-9-]+)$/, handler: handleCustomSlideTypeGet },
  { method: 'PUT', pattern: /^\/api\/custom-slide-types\/([a-f0-9-]+)$/, handler: handleCustomSlideTypeUpdate },
  { method: 'DELETE', pattern: /^\/api\/custom-slide-types\/([a-f0-9-]+)$/, handler: handleCustomSlideTypeDelete },
  { pattern: /^\/api\/custom-slide-types\/([a-f0-9-]+)$/, handler: ({ res }) => methodNotAllowed(res, ['GET', 'PUT', 'DELETE']) },
];

/**
 * Handle custom-slide-type API routes. No module-wide guard: the original
 * chain guarded per route (list requires auth, mutations require `canManage`),
 * and that stays in the handlers.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleCustomSlideTypes = withErrorHandler('custom-slide-types', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
