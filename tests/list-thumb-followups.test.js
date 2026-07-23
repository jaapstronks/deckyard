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
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { createPresentation, listPresentations } from '../server/storage/presentations.js';
import { resolveThemeThumbBg } from '../server/utils/themes.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resolveThemeThumbBg returns a theme background hex', async () => {
  const bg = await resolveThemeThumbBg(repoRoot, 'deckyard');
  assert.match(bg || '', /^#[0-9a-f]{3,6}$/i, 'a hex color for a known theme');
});

test('resolveThemeThumbBg never throws and falls back sanely', async () => {
  // Unknown theme resolves to the default theme's background (a hex) or null;
  // either way it must not throw.
  const bg = await resolveThemeThumbBg(repoRoot, 'no-such-theme-xyz');
  assert.ok(bg === null || /^#[0-9a-f]{3,6}$/i.test(bg));
});

test('list payload reports hasSlides instead of shipping slide content', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-hasslides-'));
  await createPresentation(tmp, {
    title: 'Has a slide',
    ownerEmail: 'owner@example.com',
    slides: [{ id: 's1', type: 'text-slide', content: { title: 'Hi' } }],
  });
  const list = await listPresentations(tmp);
  const item = list.find((p) => p.title === 'Has a slide');
  assert.ok(item, 'deck is listed');
  assert.equal(item.hasSlides, true, 'presence flag set');
  assert.equal('firstSlide' in item, false, 'no full slide payload shipped');
});
