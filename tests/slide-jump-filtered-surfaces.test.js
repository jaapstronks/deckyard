/**
 * `#N` counts the stored deck on the two surfaces whose deck arrives filtered
 * (B696, the rest of B695). The PPTX export leaves out live-only slides and
 * the presenter of a view-only reader gets a deck without the slides hidden
 * from viewers; a slide that drops out before the target must not shift the
 * jump, and a target that drops out is no jump.
 *
 * Run with: node --test tests/slide-jump-filtered-surfaces.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { initSanitizer } from '../shared/sanitize.js';
import { pinSlideJumps } from '../shared/slide-types.js';

await initSanitizer();

const { buildEditablePptxBuffer } = await import('../server/export/pptx.js');
const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { invalidatePermission } =
  await import('../server/storage/cache/permission-cache.js');
const { handlePresentationItem } =
  await import('../server/routes/api/presentations/presentation.js');

/** A content slide whose one action button jumps to `url`. */
const jumpSlide = (id, url) => ({
  id,
  type: 'content-slide',
  content: { title: `Slide ${id}`, actions: [{ label: 'Go', url }] },
});
const plainSlide = (id, visibility) => ({
  id,
  type: 'content-slide',
  content: { title: `Slide ${id}` },
  ...(visibility ? { visibility } : {}),
});
const goUrl = (slide) => slide.content.actions[0].url;

describe('pinSlideJumps', () => {
  it('writes #N as the id it names in this order, and nothing else', () => {
    const slides = [
      jumpSlide('a', '#3'),
      jumpSlide('b', '#slide:a'),
      jumpSlide('c', 'https://example.com'),
    ];
    const pinned = pinSlideJumps(slides);
    assert.equal(goUrl(pinned[0]), '#slide:c');
    assert.equal(pinned[1], slides[1], 'an id jump is untouched');
    assert.equal(pinned[2], slides[2], 'a web link is untouched');
    assert.equal(goUrl(slides[0]), '#3', 'the input is not mutated');
  });

  it('leaves a #N past the deck as written', () => {
    const slides = [jumpSlide('a', '#9')];
    assert.equal(pinSlideJumps(slides)[0], slides[0]);
  });

  it('reads only declared url fields', () => {
    const slides = [
      { id: 'a', type: 'content-slide', content: { title: '#2' } },
      plainSlide('b'),
    ];
    assert.equal(pinSlideJumps(slides)[0].content.title, '#2');
  });
});

describe('PPTX: #N counts the live-only slides the file leaves out', () => {
  it('an invite before the target does not shift the hyperlink', async () => {
    // Deck: invite (live-only), a (jump to #3 = c), c. File: a, c.
    const { buffer } = await buildEditablePptxBuffer(
      '.',
      {
        id: 'b696',
        title: 'Jumps',
        lang: 'en-GB',
        slides: [
          { id: 'inv', type: 'follow-invite-slide', content: {} },
          jumpSlide('a', '#3'),
          plainSlide('c'),
        ],
      },
      { compose: 'generic' },
    );
    const zip = await JSZip.loadAsync(buffer);
    assert.equal(zip.file('ppt/slides/slide3.xml'), null, 'invite left out');
    const rels = await zip
      .file('ppt/slides/_rels/slide1.xml.rels')
      .async('string');
    assert.match(rels, /Target="slide2\.xml"/);
  });
});

describe('view-only presenter: #N pinned before the viewer filter', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const DECK = 'deck-b696';
  const OWNER = 'owner@example.test';
  const VIEWER = {
    email: 'viewer@example.test',
    name: 'Vera',
    organizationId: ORG,
  };

  async function seed(slides, i18n = null) {
    __setTestDb(
      createFakeDb({
        organizations: [{ id: ORG, name: 'Home', slug: 'home' }],
        users: [
          {
            id: 'user-viewer',
            organization_id: ORG,
            email: VIEWER.email,
            name: VIEWER.name,
            role: 'user',
            auth_source: 'database',
            password_hash: null,
            settings: {},
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        presentations: [
          {
            id: DECK,
            organization_id: ORG,
            title: 'Jumps',
            owner_email: OWNER,
            created_by: OWNER,
            updated_by: OWNER,
            visibility: 'private',
            theme: 'default',
            lang: 'en-GB',
            revision: 1,
            is_view_only: false,
            slides,
            i18n,
            settings: {},
            created_at: '2026-02-01T00:00:00.000Z',
            modified_at: '2026-02-01T00:00:00.000Z',
            trashed_at: null,
          },
        ],
        presentation_collaborators: [
          {
            id: 'c-1',
            organization_id: ORG,
            presentation_id: DECK,
            user_email: VIEWER.email,
            user_id: null,
            permission: 'view',
            invited_by: OWNER,
            invited_at: '2026-02-02T00:00:00.000Z',
            accepted_at: null,
            revoked_at: null,
            revoked_by: null,
            revocation_message: null,
          },
        ],
        presentation_tags: [],
        tags: [],
        app_settings: [],
      }),
    );
    await invalidatePermission(DECK, VIEWER.email);
  }

  async function getAsViewer(query = '') {
    const res = {
      status: null,
      chunks: [],
      writeHead(status) {
        this.status = status;
        return this;
      },
      setHeader() {},
      end(chunk) {
        if (chunk) this.chunks.push(chunk);
      },
    };
    await handlePresentationItem(
      {
        repoRoot: process.cwd(),
        storageScope: createStorageScope(VIEWER, { repoRoot: process.cwd() }),
        req: { method: 'GET', headers: {} },
        res,
        url: new URL(
          `http://decks.example.test/api/presentations/${DECK}${query}`,
        ),
        authedUser: VIEWER,
      },
      DECK,
    );
    assert.equal(res.status, 200);
    return JSON.parse(res.chunks.join(''));
  }

  before(async () => {
    __setTestDb(createFakeDb({}));
    await initializeStorage();
  });
  after(() => __setTestDb(null));

  it('a slide hidden from viewers before the target does not shift #N', async () => {
    await seed([
      jumpSlide('a', '#3'),
      plainSlide('b', { hideFromViewers: true }),
      plainSlide('c'),
    ]);
    const body = await getAsViewer();
    assert.equal(body._userPermission, 'view');
    assert.deepEqual(
      body.slides.map((s) => s.id),
      ['a', 'c'],
    );
    assert.equal(goUrl(body.slides[0]), '#slide:c');
  });

  it('a target hidden from viewers is no slide the presenter can reach', async () => {
    await seed([
      jumpSlide('a', '#2'),
      plainSlide('b', { hideFromViewers: true }),
      plainSlide('c'),
    ]);
    const body = await getAsViewer();
    assert.equal(goUrl(body.slides[0]), '#slide:b');
    assert.ok(!body.slides.some((s) => s.id === 'b'));
  });

  // B698: the hidden slide left `slides` but stayed readable in the other
  // language versions the response carries.
  const versionSlides = () => [
    jumpSlide('a', '#3'),
    plainSlide('b', { hideFromViewers: true }),
    plainSlide('c'),
  ];
  const bilingual = () => ({
    dominant: 'en-GB',
    versions: {
      'en-GB': { title: 'Jumps', slides: versionSlides() },
      nl: { title: 'Sprongen', slides: versionSlides() },
    },
  });

  /** Every version's slide ids, as `{ lang: [ids] }`. */
  const versionIds = (body) =>
    Object.fromEntries(
      Object.entries(body.i18n.versions).map(([lang, v]) => [
        lang,
        v.slides.map((s) => s.id),
      ]),
    );

  it('a slide hidden from viewers is in no language version of the response', async () => {
    await seed(versionSlides(), bilingual());
    const body = await getAsViewer();
    assert.deepEqual(versionIds(body), { 'en-GB': ['a', 'c'], nl: ['a', 'c'] });
    for (const version of Object.values(body.i18n.versions)) {
      assert.equal(goUrl(version.slides[0]), '#slide:c');
    }
    assert.equal(body.i18n.versions.nl.title, 'Sprongen');
  });

  it('the ?lang projection filters and pins every version as well', async () => {
    await seed(versionSlides(), bilingual());
    const body = await getAsViewer('?lang=nl');
    assert.equal(body.i18n.active, 'nl');
    assert.deepEqual(
      body.slides.map((s) => s.id),
      ['a', 'c'],
    );
    assert.equal(goUrl(body.slides[0]), '#slide:c');
    assert.deepEqual(versionIds(body), { 'en-GB': ['a', 'c'], nl: ['a', 'c'] });
  });
});
