import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { userIdFor } from './helpers/identity-fixtures.js';
import {
  seedViewerReadFixture,
  READ_EMAILS,
  READ_ORG,
  PRIVATE_MARKERS,
} from './helpers/viewer-read-fixture.js';
import { __setTestDb } from '../server/db/client.js';
import { handlePresentationItem } from '../server/routes/api/presentations/presentation.js';
import { handlePresentations } from '../server/routes/public-api/v1/presentations.js';
import { handleSharePublicEndpoints } from '../server/routes/api/share-links/public.js';
import { createShareLink } from '../server/storage/share-links/index.js';
import { resetRateLimitBuckets } from '../server/utils/rate-limit.js';
import { McpServer } from '../server/mcp/protocol.js';
import { registerTools } from '../server/mcp/tools.js';
import { projectPresentationForAudience } from '../server/utils/public-output.js';

let fixture;
let original;
let mcp;
before(async () => {
  fixture = await seedViewerReadFixture();
  original = structuredClone(fixture.row);
  mcp = new McpServer();
  registerTools(mcp);
});
after(() => __setTestDb(null));
beforeEach(() => resetRateLimitBuckets());

function assertReader(deck, bytes = JSON.stringify(deck)) {
  for (const marker of PRIVATE_MARKERS)
    assert.ok(!bytes.includes(marker), marker);
  const lists = [
    deck.slides,
    ...Object.values(deck.i18n?.versions || {}).map((v) => v.slides),
  ];
  for (const slides of lists) {
    assert.equal(slides.length, 6);
    assert.match(slides[0].content.title, /VISIBLE-B769/);
    for (const slide of slides) {
      for (const key of [
        'notes',
        '_aiReasoning',
        '_aiAlternatives',
        '_aiWarnings',
      ])
        assert.ok(!(key in slide), key);
      assert.ok(!slide.visibility?.hideFromViewers);
    }
    assert.equal(slides[2]._isDraft, true);
    assert.equal(slides[0].content.actions[0].url, '#slide:target');
    assert.equal(slides[0].content.actions[1].url, '#slide:hidden');
  }
}
function assertAuthor(deck, bytes) {
  for (const marker of PRIVATE_MARKERS)
    assert.ok(bytes.includes(marker), marker);
  assert.equal(deck.slides.length, deck.i18n.active === 'de' ? 8 : 7);
  assert.equal(deck.i18n.versions.de.slides.length, 8);
  assert.equal(
    deck.slides[0].content.actions[0].url,
    deck.i18n.active === 'en-GB' ? '#2' : '#3',
  );
}
async function get(route, role, query = '') {
  const email = READ_EMAILS[role];
  const res = createMockRes();
  const ctx = {
    repoRoot: process.cwd(),
    storageScope: fixture.scope,
    req: createMockReq(),
    res,
    url: new URL(
      `/api/${route === 'v1' ? 'v1/' : ''}presentations/${fixture.deckId}${query}`,
      'http://localhost',
    ),
    authedUser: {
      id: userIdFor(email),
      email,
      role: 'user',
      organizationId: READ_ORG,
    },
    apiKey: {
      id: `read-key-${role}`,
      tier: 'free',
      ownerEmail: email,
      permissions: ['read'],
      organizationId: READ_ORG,
    },
  };
  if (route === 'v1') await handlePresentations(ctx);
  else await handlePresentationItem(ctx, fixture.deckId);
  assert.equal(res.statusCode, 200, res.body);
  const parsed = JSON.parse(res.body);
  return {
    deck: route === 'v1' ? parsed.presentation : parsed,
    bytes: res.body,
  };
}
for (const route of ['internal', 'v1']) {
  describe(`${route} actor read contract`, () => {
    for (const role of ['owner', 'edit', 'view', 'comment']) {
      for (const query of route === 'internal'
        ? ['', '?lang=en-GB', '?lang=de']
        : ['']) {
        it(`${role}${query}, even with a read-only API key`, async () => {
          const { deck, bytes } = await get(route, role, query);
          if (role === 'owner' || role === 'edit') assertAuthor(deck, bytes);
          else assertReader(deck, bytes);
          if (query)
            assert.match(
              deck.slides[0].content.title,
              new RegExp(query.slice(6)),
            );
        });
      }
    }
  });
}
async function share(token, action, body = {}) {
  const res = createMockRes();
  await handleSharePublicEndpoints({
    repoRoot: process.cwd(),
    req: createMockReq({ method: 'POST', body }),
    res,
    url: new URL(`/api/share/${token}/${action}`, 'http://localhost'),
  });
  return res;
}
it('a read-only deck denies author data to edit collaborators on every GET', async () => {
  fixture.row.is_view_only = true;
  try {
    for (const route of ['internal', 'v1']) {
      for (const query of route === 'internal' ? ['', '?lang=en-GB'] : ['']) {
        const reader = await get(route, 'edit', query);
        assertReader(reader.deck, reader.bytes);
        const owner = await get(route, 'owner', query);
        assertAuthor(owner.deck, owner.bytes);
      }
    }
    const deck = await tool('get_presentation', 'edit');
    for (const marker of PRIVATE_MARKERS)
      assert.ok(!JSON.stringify(deck).includes(marker));
  } finally {
    fixture.row.is_view_only = false;
  }
});
for (const permission of ['view', 'comment']) {
  for (const password of [undefined, 'synthetic-password']) {
    it(`share ${permission}, password=${!!password}: verify and render use the same safe list`, async () => {
      const { shareLink } = await createShareLink(
        fixture.scope,
        fixture.deckId,
        { permission, password },
      );
      if (password)
        assert.notEqual(
          (await share(shareLink.token, 'verify')).statusCode,
          200,
        );
      const res = await share(shareLink.token, 'verify', { password });
      assert.equal(res.statusCode, 200, res.body);
      const body = JSON.parse(res.body);
      assertReader(body.presentation, res.body);
      assert.ok(
        !('i18n' in body.presentation),
        'share keeps its base-language contract',
      );
      const hidden = await share(shareLink.token, 'render-slide', {
        slideId: 'hidden',
        grant: body.grant,
      });
      assert.equal(hidden.statusCode, 404);
      for (const marker of PRIVATE_MARKERS)
        assert.ok(!hidden.body.includes(marker));
      const shown = await share(shareLink.token, 'render-slide', {
        slideId: 'shown',
        grant: body.grant,
      });
      assert.equal(shown.statusCode, 200, shown.body);
      assert.match(shown.body, /VISIBLE-B769/);
      for (const marker of PRIVATE_MARKERS)
        assert.ok(!shown.body.includes(marker));
    });
  }
}
const tool = (name, role, args = {}) =>
  mcp.tools.get(name).handler(
    { presentationId: fixture.deckId, ...args },
    role
      ? {
          ownerEmail: READ_EMAILS[role],
          organizationId: READ_ORG,
          permissions: ['read'],
        }
      : undefined,
  );
for (const role of ['owner', 'edit', 'view', 'comment', null]) {
  it(`MCP get and previews for ${role || 'trusted local operator'}`, async () => {
    const author = !role || role === 'owner' || role === 'edit';
    const validation = await tool('validate_presentation', role);
    assert.equal(validation.slideCount, author ? 7 : 6);
    if (!author)
      for (const marker of PRIVATE_MARKERS)
        assert.ok(!JSON.stringify(validation).includes(marker));
    const deck = await tool('get_presentation', role);
    const bytes = JSON.stringify(deck);
    assert.equal(deck.slideCount, author ? 7 : 6);
    assert.equal(deck.slides.length, deck.slideCount);
    for (const [i, slide] of deck.slides.entries()) {
      assert.equal(slide.index, i);
      assert.equal('notes' in slide, author);
    }
    assert.equal(bytes.includes(PRIVATE_MARKERS[0]), author);
    assert.equal(bytes.includes(PRIVATE_MARKERS[2]), author);
    assert.ok(
      !bytes.includes(PRIVATE_MARKERS[1]),
      'MCP keeps its existing field selection',
    );
    assert.equal(
      deck.slides[0].content.actions[0].url,
      author ? '#3' : '#slide:target',
    );
    const html = await tool('preview_presentation', role);
    assert.match(html, /VISIBLE-B769/);
    assert.equal(html.includes(PRIVATE_MARKERS[2]), author);
    if (!author)
      for (const marker of PRIVATE_MARKERS) assert.ok(!html.includes(marker));
    const single = await tool('preview_slide', role, { slideIndex: 1 });
    assert.match(single, author ? /HIDDEN-B769/ : /TARGET-B769/);
    const range = await tool('preview_presentation', role, {
      slideRange: '1-1',
    });
    assert.match(range, author ? /HIDDEN-B769/ : /TARGET-B769/);
    if (!author) {
      for (const marker of PRIVATE_MARKERS) {
        assert.ok(!single.includes(marker));
        assert.ok(!range.includes(marker));
      }
      await assert.rejects(
        tool('preview_slide', role, { slideIndex: 6 }),
        /out of range/,
      );
    }
  });
}
it('projection never mutates stored arrays or author reads', async () => {
  const before = structuredClone(fixture.row);
  for (const channel of ['viewer', 'share']) {
    const out = projectPresentationForAudience(fixture.row, {
      audience: 'reader',
      channel,
      liveEnabled: false,
    });
    assertReader(out);
  }
  assert.deepEqual(fixture.row, before);
  assert.deepEqual(fixture.row.slides, original.slides);
  assert.deepEqual(fixture.row.i18n, original.i18n);
  assertAuthor(
    (await get('internal', 'owner')).deck,
    (await get('internal', 'owner')).bytes,
  );
});
it('share live policy applies independently to every language list', () => {
  const invite = {
    id: 'invite',
    type: 'follow-invite-slide',
    content: {},
    notes: PRIVATE_MARKERS[0],
  };
  const deck = {
    slides: [invite],
    i18n: { versions: { de: { slides: [invite] } } },
  };
  for (const channel of ['viewer', 'share']) {
    const out = projectPresentationForAudience(deck, {
      audience: 'reader',
      channel,
      liveEnabled: false,
    });
    assert.equal(out.slides.length, channel === 'share' ? 0 : 1);
    assert.equal(out.i18n.versions.de.slides.length, out.slides.length);
    assert.ok(!JSON.stringify(out).includes(PRIVATE_MARKERS[0]));
  }
  assert.equal(
    projectPresentationForAudience(deck, {
      audience: 'author',
      channel: 'viewer',
    }),
    deck,
  );
});

for (const route of ['internal', 'v1']) {
  for (const role of ['owner', 'edit']) {
    it(`${route}: ${role} GET then PUT preserves every author's language list`, async () => {
      const { deck } = await get(route, role);
      const email = READ_EMAILS[role];
      const res = createMockRes();
      const ctx = {
        repoRoot: process.cwd(),
        storageScope: fixture.scope,
        req: createMockReq({
          method: 'PUT',
          headers: { 'if-match': String(deck.revision) },
          body: { title: deck.title, slides: deck.slides, i18n: deck.i18n },
        }),
        res,
        url: new URL(
          `/api/${route === 'v1' ? 'v1/' : ''}presentations/${fixture.deckId}`,
          'http://localhost',
        ),
        authedUser: {
          id: userIdFor(email),
          email,
          role: 'user',
          organizationId: READ_ORG,
        },
        apiKey: {
          id: `write-key-${role}`,
          tier: 'free',
          ownerEmail: email,
          permissions: ['read', 'write'],
          organizationId: READ_ORG,
        },
      };
      if (route === 'v1') await handlePresentations(ctx);
      else await handlePresentationItem(ctx, fixture.deckId);
      assert.equal(res.statusCode, 200, res.body);
      const readBack = await get(route, role);
      assertAuthor(readBack.deck, readBack.bytes);
      assert.deepEqual(fixture.row.slides, original.slides);
      assert.deepEqual(fixture.row.i18n.versions, original.i18n.versions);
    });
  }
}

it('v1 single-slide GET cannot bypass the presentation reader projection', async () => {
  const { handleSlides } =
    await import('../server/routes/public-api/v1/slides.js');
  for (const role of ['owner', 'edit', 'view', 'comment']) {
    const author = role === 'owner' || role === 'edit';
    const email = READ_EMAILS[role];
    for (const slideId of ['shown', 'hidden', 'target']) {
      const res = createMockRes();
      await handleSlides({
        repoRoot: process.cwd(),
        storageScope: fixture.scope,
        req: createMockReq(),
        res,
        url: new URL(
          `/api/v1/presentations/${fixture.deckId}/slides/${slideId}`,
          'http://localhost',
        ),
        authedUser: {
          id: userIdFor(email),
          email,
          role: 'user',
          organizationId: READ_ORG,
        },
        apiKey: {
          id: `slide-key-${role}`,
          tier: 'free',
          ownerEmail: email,
          permissions: ['read'],
          organizationId: READ_ORG,
        },
      });
      assert.equal(
        res.statusCode,
        !author && slideId === 'hidden' ? 404 : 200,
        res.body,
      );
      if (!author) {
        for (const marker of PRIVATE_MARKERS)
          assert.ok(!res.body.includes(marker));
        assert.ok(!res.body.includes('"notes"'));
      }
      if (res.statusCode === 200) {
        const { slide, index } = JSON.parse(res.body);
        assert.equal('notes' in slide, author);
        if (slideId === 'target') assert.equal(index, author ? 2 : 1);
        if (slideId === 'shown')
          assert.equal(
            slide.content.actions[0].url,
            author ? '#3' : '#slide:target',
          );
      }
    }
  }
});

it('all read transports pin organization-defined URL fields before filtering', async () => {
  const row = fixture.db.__tables.presentations.find(
    (r) => r.id === fixture.deckId,
  );
  const saved = structuredClone(row.slides);
  fixture.db.__tables.custom_slide_types ||= [];
  fixture.db.__tables.custom_slide_types.push({
    id: 'read-custom-jump',
    organization_id: READ_ORG,
    slug: 'read-jump',
    label: 'Read jump',
    fields: [
      { key: 'title', type: 'string', label: 'Title' },
      { key: 'destination', type: 'url', label: 'Destination' },
    ],
    defaults: {},
    template: '<div class="slide"><h2>{{esc title}}</h2></div>',
    is_published: true,
    sort_order: 0,
  });
  row.slides[0] = {
    ...row.slides[0],
    type: 'custom-read-jump',
    content: { title: 'VISIBLE-B769', destination: '#3' },
  };
  try {
    for (const route of ['internal', 'v1']) {
      const { deck } = await get(route, 'view');
      assert.equal(deck.slides[0].content.destination, '#slide:target');
    }
    const deck = await tool('get_presentation', 'view');
    assert.equal(deck.slides[0].content.destination, '#slide:target');
    const { shareLink } = await createShareLink(fixture.scope, fixture.deckId, {
      permission: 'view',
    });
    const res = await share(shareLink.token, 'verify');
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(
      JSON.parse(res.body).presentation.slides[0].content.destination,
      '#slide:target',
    );
  } finally {
    row.slides = saved;
  }
});
