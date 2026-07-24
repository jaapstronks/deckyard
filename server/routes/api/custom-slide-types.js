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

import { badRequest, json, methodNotAllowed, serveJson, unauthorized, notFound } from '../../utils/http.js';
import { createRouteContext } from '../../utils/context.js';
import {
  listCustomSlideTypes,
  getCustomSlideType,
  createCustomSlideType,
  updateCustomSlideType,
  deleteCustomSlideType,
  reorderCustomSlideTypes,
} from '../../storage/custom-slide-types.js';
import { SLIDE_TYPES } from '../../../shared/slide-types.js';
import { canManage } from '../../utils/route-middleware.js';

const ERROR_MESSAGES = {
  invalid_label: 'Invalid slide type label.',
  invalid_slug: 'Invalid slide type slug.',
  invalid_fields: 'Invalid field definitions.',
  slug_exists: 'A slide type with this slug already exists.',
  not_found: 'Slide type not found.',
  unavailable: 'Database unavailable.',
  invalid_id: 'Invalid slide type ID.',
  invalid_order: 'Invalid slide type order.',
  order_mismatch: 'The order does not list exactly the current slide types. Reload and try again.',
};

export async function handleCustomSlideTypes({ req, res, url, authedUser }) {
  const pathname = url.pathname;

  // ─── LIST ─────────────────────────────────────────────────
  if (pathname === '/api/custom-slide-types' && req.method === 'GET') {
    if (!authedUser) return unauthorized(res);
    const ctx = createRouteContext(authedUser);
    const types = await listCustomSlideTypes(ctx);
    serveJson(res, 200, { customSlideTypes: types });
    return true;
  }

  // ─── CREATE ───────────────────────────────────────────────
  if (pathname === '/api/custom-slide-types' && req.method === 'POST') {
    if (!canManage(authedUser)) return unauthorized(res);
    const body = await json(req);
    if (!body || typeof body !== 'object') return badRequest(res, 'Missing JSON body.');

    const ctx = createRouteContext(authedUser);
    const result = await createCustomSlideType(body, ctx);

    if (!result.ok) {
      return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to create slide type.');
    }
    serveJson(res, 201, result.customSlideType);
    return true;
  }

  if (pathname === '/api/custom-slide-types') {
    return methodNotAllowed(res, ['GET', 'POST']);
  }

  // ─── REORDER ──────────────────────────────────────────────
  // A collection-level route, matched before the /:id block for the same
  // reason /duplicate is (the hex-only id pattern would not match "reorder"
  // today, but ordering the routes by shape is what keeps that true).
  // One call for the whole order: N single-field PUTs would leave a
  // half-applied order behind if one of them failed.
  if (pathname === '/api/custom-slide-types/reorder') {
    if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT']);
    if (!canManage(authedUser)) return unauthorized(res);

    const body = await json(req);
    if (!body || typeof body !== 'object') return badRequest(res, 'Missing JSON body.');

    const ctx = createRouteContext(authedUser);
    const result = await reorderCustomSlideTypes(body.order, ctx);
    if (!result.ok) {
      return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to reorder slide types.');
    }
    serveJson(res, 200, { customSlideTypes: result.customSlideTypes });
    return true;
  }

  // ─── DUPLICATE ─────────────────────────────────────────────
  const dupMatch = pathname.match(/^\/api\/custom-slide-types\/([a-f0-9-]+)\/duplicate$/);
  if (dupMatch && req.method === 'POST') {
    if (!canManage(authedUser)) return unauthorized(res);

    const sourceId = dupMatch[1];
    const ctx = createRouteContext(authedUser);
    const body = await json(req);

    // Source can be a custom type or a core type slug
    let sourceData;
    const existing = await getCustomSlideType(sourceId, ctx);
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
        };
      }
    }

    if (!sourceData) {
      return badRequest(res, 'Source slide type not found.');
    }

    const newLabel = body?.label || `${sourceData.label} (copy)`;
    const result = await createCustomSlideType(
      {
        label: newLabel,
        baseType: sourceData.baseType || sourceData.slug || sourceId,
        fields: sourceData.fields,
        defaults: sourceData.defaults,
        defaultsByLang: sourceData.defaultsByLang,
        template: sourceData.template || null,
        css: sourceData.css || null,
      },
      ctx
    );

    if (!result.ok) {
      return badRequest(res, ERROR_MESSAGES[result.reason] || 'Failed to duplicate slide type.');
    }
    serveJson(res, 201, result.customSlideType);
    return true;
  }

  // ─── GET / UPDATE / DELETE by ID ──────────────────────────
  const idMatch = pathname.match(/^\/api\/custom-slide-types\/([a-f0-9-]+)$/);
  if (idMatch) {
    const typeId = idMatch[1];
    const ctx = createRouteContext(authedUser);

    if (req.method === 'GET') {
      const type = await getCustomSlideType(typeId, ctx);
      if (!type) {
        notFound(res, 'Slide type not found.');
        return true;
      }
      serveJson(res, 200, type);
      return true;
    }

    if (req.method === 'PUT') {
      if (!canManage(authedUser)) return unauthorized(res);
      const body = await json(req);
      if (!body || typeof body !== 'object') return badRequest(res, 'Missing JSON body.');

      const result = await updateCustomSlideType(typeId, body, ctx);
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

    if (req.method === 'DELETE') {
      if (!canManage(authedUser)) return unauthorized(res);
      const result = await deleteCustomSlideType(typeId, ctx);
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

    return methodNotAllowed(res, ['GET', 'PUT', 'DELETE']);
  }

  return false;
}
