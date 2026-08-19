/**
 * A7.19 C8 fase 2 — batch 1 route-table migration.
 *
 * These modules moved from a hand-written `if (pathname === … && method === …)`
 * chain to a declarative `ROUTES` table dispatched through `dispatchRoutes`.
 * All five are pure fall-through (the original chains sent no 405), so a method
 * mismatch must fall through to the next mount, exactly as before.
 *
 * Each endpoint is checked with the right method (routes to the expected named
 * handler, pinning method + pattern + first-match order) and a wrong one (falls
 * through). Wrong-method dispatch is storage-free: a method mismatch never
 * reaches the real handler.
 *
 * Run with: node --test tests/c8-routes-batch-1-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUTES as SLIDE_TYPES_ROUTES,
  handleSlideTypes,
} from '../server/routes/api/slide-types.js';
import {
  ROUTES as ASSETS_ROUTES,
  handleAssets,
} from '../server/routes/api/assets.js';
import {
  ROUTES as TAGS_ROUTES,
  handleTags,
} from '../server/routes/api/tags.js';
import {
  ROUTES as PUBLISH_ROUTES,
  handlePublish,
} from '../server/routes/api/publish.js';
import {
  ROUTES as COLLAB_ROUTES,
  handleCollaborators,
} from '../server/routes/api/collaborators.js';

/**
 * Mirror of `dispatchRoutes`' matching, but returning the matched route instead
 * of invoking its handler — so a happy-path assertion never touches storage.
 */
function select(routes, method, pathname) {
  for (const route of routes) {
    if (route.method && method !== route.method) continue;
    if (typeof route.pattern === 'string') {
      if (pathname !== route.pattern) continue;
      return route;
    }
    if (!route.pattern.exec(pathname)) continue;
    return route;
  }
  return null;
}

/** A minimal context; only a wrong-method/unknown path ever reaches here. */
function ctx(method, pathname) {
  return {
    repoRoot: '/tmp',
    storageScope: {},
    authedUser: { email: 'a@b.test' },
    req: { method, headers: {} },
    res: { writeHead() {}, end() {}, setHeader() {} },
    url: { pathname, searchParams: new URLSearchParams() },
  };
}

/**
 * @param {object} spec
 * @param {any[]} spec.routes
 * @param {(ctx:any)=>any} spec.handle
 * @param {Array<[string,string,string]>} spec.served - [method, path, handlerName]
 * @param {Array<[string,string]>} spec.falls - [method, path] that must fall through
 */
function suite(name, spec) {
  test(`${name}: every declared route resolves to its named handler in order`, () => {
    for (const [method, path, handlerName] of spec.served) {
      const route = select(spec.routes, method, path);
      assert.ok(route, `${method} ${path} matches a route`);
      assert.equal(
        route.handler.name,
        handlerName,
        `${method} ${path} → ${handlerName}`,
      );
    }
  });

  test(`${name}: a wrong or unowned method falls through (no 405)`, async () => {
    for (const [method, path] of spec.falls) {
      assert.equal(
        select(spec.routes, method, path),
        null,
        `${method} ${path} matches nothing`,
      );
      assert.equal(
        await spec.handle(ctx(method, path)),
        false,
        `${method} ${path} not handled`,
      );
    }
  });

  test(`${name}: an unknown sub-path falls through`, async () => {
    assert.equal(await spec.handle(ctx('GET', '/api/__c8_nope__')), false);
  });

  test(`${name}: every route handler is a function`, () => {
    for (const route of spec.routes) {
      assert.equal(typeof route.handler, 'function');
    }
  });
}

suite('slide-types', {
  routes: SLIDE_TYPES_ROUTES,
  handle: handleSlideTypes,
  served: [['GET', '/api/slide-types', 'handleSlideTypeList']],
  falls: [
    ['POST', '/api/slide-types'],
    ['DELETE', '/api/slide-types'],
  ],
});

suite('assets', {
  routes: ASSETS_ROUTES,
  handle: handleAssets,
  served: [
    ['GET', '/api/assets/partnerlogos', 'handlePartnerLogos'],
    ['GET', '/api/assets/backgrounds', 'handleBackgrounds'],
  ],
  falls: [
    ['POST', '/api/assets/partnerlogos'],
    ['PUT', '/api/assets/backgrounds'],
  ],
});

suite('tags', {
  routes: TAGS_ROUTES,
  handle: handleTags,
  served: [
    ['GET', '/api/tags', 'handleTagList'],
    ['GET', '/api/tags/search', 'handleTagSearch'],
    ['POST', '/api/tags', 'handleTagCreate'],
    ['DELETE', '/api/tags/abc123def', 'handleTagDelete'],
  ],
  falls: [
    ['DELETE', '/api/tags'],
    ['PUT', '/api/tags/abc123def'],
    ['POST', '/api/tags/search'],
  ],
});

suite('publish', {
  routes: PUBLISH_ROUTES,
  handle: handlePublish,
  served: [
    ['POST', '/api/presentations/deck1/publish', 'handlePublishCreate'],
    ['DELETE', '/api/presentations/deck1/publish', 'handlePublishDelete'],
    ['PATCH', '/api/presentations/deck1/publish/slug', 'handlePublishSlug'],
    [
      'POST',
      '/api/presentations/deck1/preview/regenerate',
      'handlePreviewRegenerate',
    ],
  ],
  falls: [
    ['GET', '/api/presentations/deck1/publish'],
    ['PUT', '/api/presentations/deck1/publish/slug'],
    ['GET', '/api/presentations/deck1/preview/regenerate'],
  ],
});

suite('collaborators', {
  routes: COLLAB_ROUTES,
  handle: handleCollaborators,
  served: [
    ['GET', '/api/presentations/shared-with-me', 'handleSharedWithMe'],
    ['POST', '/api/presentations/deck1/collaborators', 'handleCollaboratorAdd'],
    ['GET', '/api/presentations/deck1/collaborators', 'handleCollaboratorList'],
    [
      'DELETE',
      '/api/presentations/deck1/collaborators/a%40b.test',
      'handleCollaboratorRemove',
    ],
    [
      'PATCH',
      '/api/presentations/deck1/collaborators/a%40b.test',
      'handleCollaboratorUpdate',
    ],
  ],
  falls: [
    ['POST', '/api/presentations/shared-with-me'],
    ['PUT', '/api/presentations/deck1/collaborators'],
    ['GET', '/api/presentations/deck1/collaborators/a%40b.test'],
  ],
});
