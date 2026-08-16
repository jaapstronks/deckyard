/**
 * B67 — payload-contract tests for outgoing webhooks (server/utils/webhooks.js).
 *
 * docs/reference/webhooks.md calls the payload shapes "the contract" an
 * external integrator writes against, but until now no test pinned them: the
 * SSRF side is covered (security-audit-cluster7) and settings migration is
 * covered, while the shapes themselves — and the `x-sb-event` header and the
 * best-effort fire — were only enforced by the doc. This file pins, per event:
 *
 * - which configured URL an event fires to (the URL is the enable switch);
 * - the delivered request: `x-sb-event`, content-type, user-agent,
 *   `redirect: 'error'`;
 * - the exact top-level payload shape per builder (common, slide-library,
 *   interaction, lead) and the load-bearing values inside;
 * - best-effort semantics: a dead or refusing receiver never rejects the
 *   `maybeFire…` call.
 *
 * Storage is the in-memory fake DB (tests/helpers/fake-db.js); the webhook
 * URLs use public IP literals so the SSRF guard classifies them without DNS.
 *
 * Run with: node --test tests/webhook-payload-contracts.test.js
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { writeAppSettings } = await import('../server/storage/settings.js');
const {
  maybeFireWebhook,
  maybeFireLeadWebhook,
  maybeFireInteractionWebhook,
} = await import('../server/utils/webhooks.js');

const REPO_ROOT = '/tmp/webhook-contract-tests';

// One distinct public-IP URL per event, so a payload arriving at the wrong
// URL is a routing failure, not a coincidence.
const URLS = {
  presentationMovedToOrganizationUrl: 'http://203.0.114.1/moved',
  slideAddedToTeamLibraryUrl: 'http://203.0.114.2/library',
  presentationPublishedUrl: 'http://203.0.114.3/published',
  commentCreatedUrl: 'http://203.0.114.4/comment',
  interactionPollClosedUrl: 'http://203.0.114.5/poll',
  interactionLikertClosedUrl: 'http://203.0.114.6/likert',
  interactionFeedbackSubmittedUrl: 'http://203.0.114.7/feedback',
  leadSubmittedUrl: 'http://203.0.114.8/lead',
};

const REQ = { headers: { host: 'decks.example.test' } };
const ACTOR = { email: 'Actor@Example.com', name: 'Actor Name', isAdmin: true };

const originalFetch = globalThis.fetch;
let fetchCalls;

function stubFetch(responder = () => ({ ok: true, status: 200 })) {
  fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return responder(String(url), options);
  };
}

/** The fire path is `void postJson(...)` — give its microtasks room to land. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

function delivered(i = 0) {
  const call = fetchCalls[i];
  assert.ok(call, `expected delivery #${i + 1}, got ${fetchCalls.length}`);
  return { ...call, payload: JSON.parse(call.options.body) };
}

before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
  await writeAppSettings(testScope(REPO_ROOT), { webhooks: URLS });
});

after(() => {
  __setTestDb(null);
});

beforeEach(() => stubFetch());
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── the delivered request ─────────────────────────────────────────────────

describe('the delivered request', () => {
  it('carries x-sb-event, JSON content-type, the webhook user-agent, and refuses redirects', async () => {
    await maybeFireWebhook(REPO_ROOT, REQ, {
      event: 'presentation.published',
      pres: { id: 'pres-1', title: 'T' },
      authedUser: ACTOR,
    });
    await settle();

    const { url, options } = delivered();
    assert.equal(url, URLS.presentationPublishedUrl);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-sb-event'], 'presentation.published');
    assert.equal(options.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(options.headers['user-agent'], 'presentation-system-webhook/1');
    assert.equal(options.redirect, 'error', 'a 30x must not walk into private space');
  });

  it('an unset URL is the off switch: no request leaves the process', async () => {
    await writeAppSettings(testScope(REPO_ROOT), {
      webhooks: { ...URLS, commentCreatedUrl: '' },
    });
    await maybeFireWebhook(REPO_ROOT, REQ, {
      event: 'comment.created',
      pres: { id: 'pres-1', title: 'T' },
      authedUser: ACTOR,
    });
    await settle();
    assert.equal(fetchCalls.length, 0);
    await writeAppSettings(testScope(REPO_ROOT), { webhooks: URLS });
  });
});

// ─── common payload (presentation.*, comment.created) ──────────────────────

describe('common payload shape', () => {
  it('presentation.published: exact shape, lowercased actor, published block and links', async () => {
    await maybeFireWebhook(REPO_ROOT, REQ, {
      event: 'presentation.published',
      pres: {
        id: 'pres-1',
        title: 'Quarterly',
        description: 'Numbers',
        theme: 'aurora',
        visibility: 'organization',
        published: { id: 'ab12', slug: 'quarterly' },
      },
      authedUser: ACTOR,
    });
    await settle();

    const { payload } = delivered();
    assert.deepEqual(Object.keys(payload).sort(), ['actor', 'createdAt', 'event', 'links', 'presentation']);
    assert.equal(payload.event, 'presentation.published');
    assert.ok(!Number.isNaN(Date.parse(payload.createdAt)));

    // actor.id is the email — a documented pre-user-id contract (webhooks.md).
    assert.deepEqual(payload.actor, {
      id: 'actor@example.com',
      email: 'actor@example.com',
      name: 'Actor Name',
      role: 'admin',
    });

    assert.deepEqual(payload.presentation, {
      id: 'pres-1',
      title: 'Quarterly',
      description: 'Numbers',
      theme: 'aurora',
      visibility: 'organization',
      published: {
        id: 'ab12',
        slug: 'quarterly',
        path: '/p/ab12-quarterly',
        url: 'http://decks.example.test/p/ab12-quarterly',
      },
    });

    assert.deepEqual(payload.links, {
      editPath: '/app/pres-1',
      editUrl: 'http://decks.example.test/app/pres-1',
      publicPath: '/p/ab12-quarterly',
      publicUrl: 'http://decks.example.test/p/ab12-quarterly',
    });
  });

  it('an unpublished deck nulls the published block and public links', async () => {
    await maybeFireWebhook(REPO_ROOT, REQ, {
      event: 'presentation.moved_to_organization',
      pres: { id: 'pres-2', title: 'Draft' },
      authedUser: { email: 'user@example.com', name: 'U', isAdmin: false },
    });
    await settle();

    const { url, payload } = delivered();
    assert.equal(url, URLS.presentationMovedToOrganizationUrl);
    assert.equal(payload.actor.role, 'user');
    assert.equal(payload.presentation.published, null);
    assert.equal(payload.presentation.visibility, 'private', 'defaults to private');
    assert.equal(payload.links.publicPath, null);
    assert.equal(payload.links.publicUrl, null);
  });

  it('comment.created forwards the fire site extra block verbatim', async () => {
    await maybeFireWebhook(REPO_ROOT, REQ, {
      event: 'comment.created',
      pres: { id: 'pres-3', title: 'T' },
      authedUser: ACTOR,
      extra: { comment: { id: 'c-1', body: 'Nice' } },
    });
    await settle();

    const { url, payload } = delivered();
    assert.equal(url, URLS.commentCreatedUrl);
    assert.deepEqual(Object.keys(payload).sort(), ['actor', 'createdAt', 'event', 'extra', 'links', 'presentation']);
    assert.deepEqual(payload.extra, { comment: { id: 'c-1', body: 'Nice' } });
  });
});

// ─── slide-library payload ─────────────────────────────────────────────────

describe('slide.added_to_team_library payload shape', () => {
  it('carries the slide block and library links instead of a presentation', async () => {
    await maybeFireWebhook(REPO_ROOT, REQ, {
      event: 'slide.added_to_team_library',
      slideItem: {
        id: 'sl-9',
        name: 'KPI grid',
        description: 'Four numbers',
        slideType: 'kpi-metrics-slide',
        themeId: 'aurora',
        previewUrl: '/thumbs/sl-9.png',
      },
      authedUser: ACTOR,
    });
    await settle();

    const { url, payload } = delivered();
    assert.equal(url, URLS.slideAddedToTeamLibraryUrl);
    assert.deepEqual(Object.keys(payload).sort(), ['actor', 'createdAt', 'event', 'links', 'slide']);
    assert.deepEqual(payload.slide, {
      id: 'sl-9',
      name: 'KPI grid',
      description: 'Four numbers',
      slideType: 'kpi-metrics-slide',
      themeId: 'aurora',
      previewUrl: '/thumbs/sl-9.png',
      url: 'http://decks.example.test/app/slide-library/team/sl-9',
    });
    assert.deepEqual(payload.links, {
      libraryPath: '/app/slide-library',
      libraryUrl: 'http://decks.example.test/app/slide-library',
      slidePath: '/app/slide-library/team/sl-9',
      slideUrl: 'http://decks.example.test/app/slide-library/team/sl-9',
    });
  });
});

// ─── interaction payloads ──────────────────────────────────────────────────

describe('interaction.* payload shape', () => {
  const INTERACTION_EVENTS = [
    ['interaction.poll_closed', URLS.interactionPollClosedUrl],
    ['interaction.likert_closed', URLS.interactionLikertClosedUrl],
    ['interaction.feedback_submitted', URLS.interactionFeedbackSubmittedUrl],
  ];

  for (const [event, expectedUrl] of INTERACTION_EVENTS) {
    it(`${event}: minimal shape with session and interaction, deliberately no actor`, async () => {
      stubFetch();
      await maybeFireInteractionWebhook(REPO_ROOT, {
        event,
        sessionId: 'sess-1',
        interaction: {
          type: 'poll',
          slideId: 'slide-2',
          totals: [3, 1],
          total: 4,
          status: 'closed',
        },
      });
      await settle();

      const { url, payload, options } = delivered();
      assert.equal(url, expectedUrl);
      assert.equal(options.headers['x-sb-event'], event);
      // These fire from the storage layer during a live session; the acting
      // party is the audience, so there is no actor block (webhooks.md).
      assert.deepEqual(Object.keys(payload).sort(), ['event', 'interaction', 'session', 'timestamp']);
      assert.equal(payload.event, event);
      assert.ok(!Number.isNaN(Date.parse(payload.timestamp)));
      assert.deepEqual(payload.session, { id: 'sess-1' });
      assert.deepEqual(payload.interaction, {
        type: 'poll',
        slideId: 'slide-2',
        totals: [3, 1],
        total: 4,
        status: 'closed',
      });
    });
  }
});

// ─── lead payload ──────────────────────────────────────────────────────────

describe('lead.submitted payload shape', () => {
  it('carries the visitor PII block — the one payload shipping non-user personal data', async () => {
    await maybeFireLeadWebhook(REPO_ROOT, REQ, {
      presentation: { id: 'pres-1', title: 'Quarterly' },
      slideId: 'slide-7',
      lead: { name: 'Visitor V', email: 'visitor@example.org', submittedAt: '2026-08-16T10:00:00.000Z' },
    });
    await settle();

    const { url, payload, options } = delivered();
    assert.equal(url, URLS.leadSubmittedUrl);
    assert.equal(options.headers['x-sb-event'], 'lead.submitted');
    assert.deepEqual(Object.keys(payload).sort(), ['createdAt', 'event', 'lead', 'presentation', 'slide']);
    assert.equal(payload.event, 'lead.submitted');
    assert.deepEqual(payload.presentation, {
      id: 'pres-1',
      title: 'Quarterly',
      editUrl: 'http://decks.example.test/app/pres-1',
    });
    assert.deepEqual(payload.slide, { id: 'slide-7' });
    assert.deepEqual(payload.lead, {
      name: 'Visitor V',
      email: 'visitor@example.org',
      submittedAt: '2026-08-16T10:00:00.000Z',
    });
  });

  it('does not fire without a lead', async () => {
    await maybeFireLeadWebhook(REPO_ROOT, REQ, {
      presentation: { id: 'pres-1', title: 'T' },
      slideId: 'slide-7',
      lead: null,
    });
    await settle();
    assert.equal(fetchCalls.length, 0);
  });
});

// ─── best-effort fire ──────────────────────────────────────────────────────

describe('best-effort fire', () => {
  it('a refusing receiver (500) never rejects the maybeFire call', async () => {
    stubFetch(() => ({ ok: false, status: 500 }));
    await assert.doesNotReject(
      maybeFireWebhook(REPO_ROOT, REQ, {
        event: 'presentation.published',
        pres: { id: 'pres-1', title: 'T' },
        authedUser: ACTOR,
      })
    );
    await settle();
    assert.equal(fetchCalls.length, 1, 'the attempt was made');
  });

  it('a dead receiver (network error) never rejects the maybeFire call', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    await assert.doesNotReject(
      maybeFireInteractionWebhook(REPO_ROOT, {
        event: 'interaction.poll_closed',
        sessionId: 's',
        interaction: { type: 'poll', slideId: 'x', totals: [], total: 0, status: 'closed' },
      })
    );
    await settle();
    assert.equal(fetchCalls.length, 1);
  });

  it('a webhook URL that turned private is refused at delivery, before any request', async () => {
    // normalizeWebhookUrl only checks the scheme at write time; the SSRF
    // decision is per-POST because DNS can change between the two.
    await writeAppSettings(testScope(REPO_ROOT), {
      webhooks: { ...URLS, presentationPublishedUrl: 'http://127.0.0.1/hook' },
    });
    await assert.doesNotReject(
      maybeFireWebhook(REPO_ROOT, REQ, {
        event: 'presentation.published',
        pres: { id: 'pres-1', title: 'T' },
        authedUser: ACTOR,
      })
    );
    await settle();
    assert.equal(fetchCalls.length, 0, 'blocked before fetch');
    await writeAppSettings(testScope(REPO_ROOT), { webhooks: URLS });
  });
});
