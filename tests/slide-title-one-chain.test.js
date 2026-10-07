/**
 * B597: every server reader that names a slide reads the same heading the
 * reader document gives it.
 *
 * The MCP tools, a comment's slide context, the speaker-notes export and the
 * deck-compression prompt each used to pick their own order of
 * `title`/`heading`/`quote`/`text`, so a change to a type's fields (D314 moved
 * the quote into `quotes[]`) had to be carried into four chains. They now all
 * read `slideTitle()` from `semantic-projection.js`, the content-supplied part
 * of `slideHeading()`. This pins a title, a quote and a KPI slide in every
 * reader against the reader's own heading.
 *
 * Run with: node --test tests/slide-title-one-chain.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'b597']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000ab';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'deck-slide-title';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { McpServer } = await import('../server/mcp/protocol.js');
const { registerTools } = await import('../server/mcp/tools.js');
const { slideContextFor } =
  await import('../server/services/comment-slide-context.js');
const { buildNotesMarkdown } = await import('../server/export/notes.js');
const { buildCompressionUserPrompt } =
  await import('../server/utils/ai/compress-deck.js');
const { slideHeading } =
  await import('../shared/slide-types/semantic-projection.js');
const { getSlideType } = await import('../shared/slide-types/registry.js');

const SLIDES = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    type: 'title-slide',
    content: { title: 'Welkom', subheading: 'Onder de titel' },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    type: 'quote-slide',
    content: {
      quotes: [
        { quote: 'Eerst de vorm, dan de rest.', authorName: 'Ada' },
        { quote: 'De tweede quote.', authorName: 'Bob' },
      ],
    },
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    type: 'kpi-metrics-slide',
    content: {
      title: 'Kerncijfers',
      metrics: [{ value: '42', label: 'Antwoord' }],
    },
  },
];

const PRES = { id: DECK_ID, title: 'A deck', lang: 'nl', slides: SLIDES };

/** The reader document's heading text for each slide. */
const READER = SLIDES.map(
  (slide, index) =>
    slideHeading(slide, getSlideType(slide.type), { index, lang: 'nl' }).text,
);

test('the reader headings are the authored words, not type labels', () => {
  assert.deepEqual(READER, [
    'Welkom',
    'Eerst de vorm, dan de rest.',
    'Kerncijfers',
  ]);
});

test('a comment names its slide by the reader heading', () => {
  SLIDES.forEach((slide, i) => {
    assert.equal(slideContextFor(PRES, slide.id).title, READER[i]);
  });
});

test('the speaker notes head each slide with the reader heading', () => {
  const md = buildNotesMarkdown(PRES);
  SLIDES.forEach((_, i) => {
    assert.ok(
      md.includes(`## Slide ${i + 1} — ${READER[i]}\n`),
      `slide ${i + 1} heading`,
    );
  });
});

test('the compression prompt lists each slide by the reader heading', () => {
  const prompt = buildCompressionUserPrompt({
    title: PRES.title,
    slides: SLIDES,
  });
  SLIDES.forEach((slide, i) => {
    assert.ok(
      prompt.includes(`[${i}] ${slide.type}: ${READER[i]}\n`),
      `slide ${i} line`,
    );
  });
});

test('a slide that supplies no words gets no title, not its type label', () => {
  const bare = { id: 'b', type: 'kpi-metrics-slide', content: {} };
  const pres = { ...PRES, slides: [bare] };
  assert.equal(slideContextFor(pres, 'b').title, '');
  assert.ok(buildNotesMarkdown(pres).includes('## Slide 1\n'));
  assert.ok(
    buildCompressionUserPrompt({ title: 'x', slides: [bare] }).includes(
      '[0] kpi-metrics-slide: Untitled',
    ),
  );
});

test('the MCP tools name a slide by the reader heading', async () => {
  __setTestDb(
    createFakeDb({
      organizations: [
        { id: ORG, name: 'Default', slug: 'default', settings: {} },
      ],
      users: userRows(OWNER),
      themes: [],
      custom_slide_types: [],
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
          slides: structuredClone(SLIDES),
          created_at: '2026-10-01T00:00:00.000Z',
          modified_at: '2026-10-01T00:00:00.000Z',
          trashed_at: null,
        },
      ],
    }),
  );
  await initializeStorage(process.cwd());
  const server = new McpServer();
  registerTools(server, { defaultOwnerEmail: OWNER });
  const reorder = server.tools.get('reorder_slides').handler;
  for (let i = 0; i < SLIDES.length; i += 1) {
    const result = await reorder(
      { presentationId: DECK_ID, fromIndex: i, toIndex: i },
      { ownerEmail: OWNER, organizationId: ORG },
    );
    assert.equal(result.slide.title, READER[i], `slide ${i}`);
  }
});
