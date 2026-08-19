/**
 * Deck-grid thumbnail follow-ups (front-page-perf polish).
 *
 * - The list payload ships a `hasSlides` boolean, not the full slide-1 content
 *   (the thumbnail is a server-rasterized PNG, so the client only needs the
 *   presence signal for the empty-state).
 * - `resolveThemeThumbBg` yields a theme's background hex for the placeholder
 *   shown until the raster loads.
 *
 * In its own file so the shared theme cache stays clean — route tests elsewhere
 * load themes from throwaway repo roots, which would poison a shared process.
 *
 * Run with: node --test tests/list-thumb-followups.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveThemeThumbBg } from '../server/utils/themes.js';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, listPresentations } =
  await import('../server/storage/presentations/index.js');

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test('resolveThemeThumbBg returns a theme background hex', async () => {
  const bg = await resolveThemeThumbBg(repoRoot, 'amethyst');
  assert.match(bg || '', /^#[0-9a-f]{3,6}$/i, 'a hex color for a known theme');
});

test('resolveThemeThumbBg never throws and falls back sanely', async () => {
  // Unknown theme resolves to the default theme's background (a hex) or null;
  // either way it must not throw.
  const bg = await resolveThemeThumbBg(repoRoot, 'no-such-theme-xyz');
  assert.ok(bg === null || /^#[0-9a-f]{3,6}$/i.test(bg));
});

test('list payload reports hasSlides instead of shipping slide content', async () => {
  await createPresentation(testScope(), {
    title: 'Has a slide',
    ownerEmail: 'owner@example.com',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hi' } }],
  });
  const list = await listPresentations(testScope());
  const item = list.find((p) => p.title === 'Has a slide');
  assert.ok(item, 'deck is listed');
  assert.equal(item.hasSlides, true, 'presence flag set');
  assert.equal('firstSlide' in item, false, 'no full slide payload shipped');
});
