/**
 * A copy by someone who may not write the source is the reader projection
 * (DY-810, D373).
 *
 * Whoever may read a deck may copy it (B570), and the copy is theirs. The copy
 * used to carry every stored slide field, so a view or comment collaborator
 * read the author's speaker notes, the slides hidden from viewers and the AI
 * working metadata in their own copy: the reader contract
 * (`docs/reference/viewer-read-data.md`) was one click or one MCP call away.
 * These tests copy the read fixture (B769) on the internal route, public v1 and
 * MCP `duplicate_presentation`, and read what storage holds afterwards:
 *
 *   - a view or comment collaborator's copy holds no notes, no hidden slide
 *     and no AI field, in any language version, and no `_isDraft` marker;
 *   - an in-deck jump in that copy lands on the copy's own slide;
 *   - an owner's or edit collaborator's copy keeps the author material.
 *
 * Run with: node --test tests/duplicate-reader-projection.test.js
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createMockRes } from './helpers/http-mocks.js';
import { userIdFor } from './helpers/identity-fixtures.js';
import {
  seedViewerReadFixture,
  READ_EMAILS,
  READ_ORG,
  PRIVATE_MARKERS,
} from './helpers/viewer-read-fixture.js';
import { __setTestDb } from '../server/db/client.js';
import { handlePresentations as handleAppPresentations } from '../server/routes/api/presentations/index.js';
import { handlePresentations as handleV1Presentations } from '../server/routes/public-api/v1/presentations.js';
import { McpServer } from '../server/mcp/protocol.js';
import { registerTools } from '../server/mcp/tools.js';

process.env.AUTH_SECRET ||= ['deckyard', 'test', 'dy810']
  .join('-')
  .padEnd(40, '0');
delete process.env.SANDBOX_MODE;

let fixture;
before(async () => {
  fixture = await seedViewerReadFixture();
});
after(() => __setTestDb(null));

const AUTHOR_ONLY_KEYS = [
  'notes',
  '_aiReasoning',
  '_aiAlternatives',
  '_aiSuggestAfter',
  '_aiWarnings',
  '_isDraft',
];

function post() {
  const req = Readable.from([]);
  req.method = 'POST';
  req.headers = {};
  return req;
}

function actorFor(email) {
  return {
    id: userIdFor(email),
    email,
    role: 'user',
    organizationId: READ_ORG,
  };
}

/** Copy the fixture deck as `role` on `contract`; answer the copy's id. */
async function copyAs(contract, role) {
  const email = READ_EMAILS[role];
  if (contract === 'MCP') {
    const server = new McpServer();
    registerTools(server, { defaultOwnerEmail: email });
    const tool = server.tools.get('duplicate_presentation');
    const out = await tool.handler(
      { presentationId: fixture.deckId },
      { ownerEmail: email, organizationId: READ_ORG, userId: userIdFor(email) },
    );
    return out.id;
  }
  const res = createMockRes();
  const ctx = {
    repoRoot: process.cwd(),
    storageScope: fixture.scope,
    req: post(),
    res,
    authedUser: actorFor(email),
  };
  if (contract === 'internal') {
    ctx.url = new URL(
      `http://test.local/api/presentations/${fixture.deckId}/duplicate`,
    );
    await handleAppPresentations(ctx);
  } else {
    ctx.url = new URL(
      `http://localhost/api/v1/presentations/${fixture.deckId}/duplicate`,
    );
    ctx.apiKey = {
      id: `dy810-key-${role}`,
      tier: 'free',
      ownerEmail: email,
      permissions: ['read', 'write'],
      organizationId: READ_ORG,
    };
    await handleV1Presentations(ctx);
  }
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  return contract === 'internal'
    ? body.id
    : (body.data?.presentation?.id ?? body.presentation?.id);
}

/** What storage holds for a copy: the row, and every slide list it carries. */
function storedCopy(id) {
  const row = fixture.db.__tables.presentations.find((r) => r.id === id);
  assert.ok(row, 'the copy is stored');
  const lists = [
    row.slides,
    ...Object.values(row.i18n?.versions || {}).map((v) => v.slides),
  ];
  return { row, lists, bytes: JSON.stringify(row) };
}

for (const contract of ['internal', 'v1', 'MCP']) {
  describe(`${contract} duplicate`, () => {
    for (const role of ['view', 'comment']) {
      it(`a ${role} collaborator's copy is the reader projection`, async () => {
        const { lists, bytes } = storedCopy(await copyAs(contract, role));
        for (const marker of PRIVATE_MARKERS)
          assert.ok(!bytes.includes(marker), marker);
        assert.equal(lists.length, 4, 'top level and three versions');
        for (const slides of lists) {
          assert.equal(slides.length, 6);
          for (const slide of slides) {
            for (const key of AUTHOR_ONLY_KEYS) assert.ok(!(key in slide), key);
            assert.ok(!slide.visibility?.hideFromViewers);
          }
          // The jump to the target lands on the copy's target slide, not on a
          // slide id of the source deck.
          const target = slides.find((s) =>
            /TARGET-B769/.test(s.content.title),
          );
          assert.equal(slides[0].content.actions[0].url, `#slide:${target.id}`);
        }
      });
    }

    for (const role of ['owner', 'edit']) {
      it(`an ${role}'s copy keeps the author material`, async () => {
        const { row, bytes } = storedCopy(await copyAs(contract, role));
        for (const marker of PRIVATE_MARKERS)
          assert.ok(bytes.includes(marker), marker);
        assert.equal(row.slides.length, 7);
        assert.equal(row.i18n.versions.de.slides.length, 8);
        assert.equal(row.slides[0].content.actions[0].url, '#3');
      });
    }
  });
}
