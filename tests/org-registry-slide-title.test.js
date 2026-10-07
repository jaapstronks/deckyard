/**
 * B601: a comment's slide context and the deck-compression prompt name an
 * org-owned slide type by its own declared heading.
 *
 * B597 put every server reader on `slideTitle()`, but two of them looked the
 * type up in the core registry only, so an org's custom type (one that lives
 * in `custom_slide_types`, not in `shared/`) fell through to no heading at
 * all. Both readers now take the org's merged registry from their caller, the
 * way the speaker-notes export already did. This pins the readers themselves
 * and the MCP `add_comment` route that hands them the session registry.
 *
 * Run with: node --test tests/org-registry-slide-title.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b601']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000ac';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'deck-org-registry-title';
const SLIDE_ID = 'a0000000-0000-4000-8000-000000000601';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { buildMergedSlideTypes } =
  await import('../server/utils/custom-slide-type-runtime.js');
const { slideContextFor } =
  await import('../server/services/comment-slide-context.js');
const { buildCompressionUserPrompt } =
  await import('../server/utils/ai/compress-deck.js');

/** An org type whose heading is a field core has never heard of. */
const ORG_TYPE_ROW = {
  id: 'cst-agenda-point',
  organization_id: ORG,
  slug: 'agenda-point',
  label: 'Agenda point',
  base_type: null,
  fields: [
    { key: 'onderwerp', type: 'string', label: 'Topic', role: 'heading' },
    { key: 'toelichting', type: 'string', label: 'Note' },
  ],
  defaults: { onderwerp: '', toelichting: '' },
  defaults_by_lang: null,
  template: '<div class="slide"><h2>{{esc onderwerp}}</h2></div>',
  css: null,
  usage: null,
  is_published: true,
  sort_order: 0,
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T00:00:00.000Z',
  created_by: null,
};

const SLIDE = {
  id: SLIDE_ID,
  type: 'custom-agenda-point',
  content: { onderwerp: 'Begroting 2027', toelichting: 'Ter besluitvorming' },
};

const PRES = { id: DECK_ID, title: 'Agenda', lang: 'nl', slides: [SLIDE] };

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [
        { id: ORG, name: 'Default', slug: 'default', settings: {} },
      ],
      users: userRows(OWNER),
      themes: [],
      custom_slide_types: [ORG_TYPE_ROW],
      presentations: [
        {
          id: DECK_ID,
          organization_id: ORG,
          owner_email: OWNER,
          created_by: OWNER,
          updated_by: OWNER,
          owner_user_id: userIdFor(OWNER),
          created_by_user_id: userIdFor(OWNER),
          updated_by_user_id: userIdFor(OWNER),
          title: PRES.title,
          theme: 'default',
          lang: 'nl',
          visibility: 'private',
          revision: 1,
          slides: [structuredClone(SLIDE)],
          created_at: '2026-10-07T00:00:00.000Z',
          modified_at: '2026-10-07T00:00:00.000Z',
          trashed_at: null,
        },
      ],
      comments: [],
    }),
  );
  await initializeStorage(process.cwd());
});

test('the core registry alone does not know the org type', () => {
  assert.equal(slideContextFor(PRES, SLIDE_ID).title, '');
});

test("a comment's slide context reads the org type's own heading", async () => {
  const slideTypes = await buildMergedSlideTypes({ organizationId: ORG });
  assert.equal(
    slideContextFor(PRES, SLIDE_ID, { slideTypes }).title,
    'Begroting 2027',
  );
});

test('the compression prompt lists the org type by its own heading', async () => {
  const slideTypes = await buildMergedSlideTypes({ organizationId: ORG });
  const prompt = buildCompressionUserPrompt({
    title: PRES.title,
    slides: PRES.slides,
    slideTypes,
    lang: 'nl',
  });
  assert.ok(
    prompt.includes('[0] custom-agenda-point: Begroting 2027\n'),
    prompt,
  );
});

test('MCP add_comment hands the session registry to the slide context', async () => {
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const result = await server.tools
    .get('add_comment')
    .handler(
      { presentationId: DECK_ID, slideId: SLIDE_ID, body: 'Klopt dit bedrag?' },
      { ownerEmail: OWNER, organizationId: ORG },
    );
  assert.equal(result.comment.slide.title, 'Begroting 2027');
});
