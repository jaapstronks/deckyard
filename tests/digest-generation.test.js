/**
 * Behaviour coverage for server/services/digest-generation.js (B78).
 *
 * The module has two exported entry points — `generateDigestWithAI` (solo
 * author) and `generateTeamDigestWithAI` (organization admin) — and three
 * shapes each can take:
 *
 *   - no activity     → a static "quiet week" digest, no AI call at all;
 *   - AI success      → the model's prose merged with server-owned metrics;
 *   - AI failure/junk → a deterministic template fallback.
 *
 * The AI seam is mocked at its outermost edge — `globalThis.fetch` — so every
 * path is deterministic with no network and no API key. This needs no
 * experimental flags (unlike `mock.module`) and still exercises the real
 * `getLlmConfig` → provider → response-parse chain. The vendor is pinned to
 * OpenAI via env, and the fake returns a minimal chat-completions body. The
 * real `formatDuration` is left in place — it is a pure formatter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pin the LLM vendor so getLlmConfig resolves without a real key or network.
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';

// Control the faked AI response from each test. `aiResponse` is the string the
// model "returns"; `aiThrows` makes the provider call fail (HTTP 500).
let aiResponse = '';
let aiThrows = false;
let lastFetch = null;

const realFetch = globalThis.fetch;
globalThis.fetch = async (endpoint, opts) => {
  lastFetch = { endpoint, body: opts?.body ? JSON.parse(opts.body) : null };
  if (aiThrows) {
    return { ok: false, status: 500, text: async () => 'provider exploded' };
  }
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: aiResponse } }] }),
  };
};
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const { generateDigestWithAI, generateTeamDigestWithAI } = await import(
  '../server/services/digest-generation.js'
);

function resetSeam() {
  aiResponse = '';
  aiThrows = false;
  lastFetch = null;
}

/** A solo analytics payload with real activity. */
function soloAnalytics(overrides = {}) {
  return {
    hasActivity: true,
    weekStart: '2026-08-04',
    weekEnd: '2026-08-10',
    totalViews: 120,
    uniqueViewers: 45,
    avgDurationSeconds: 95,
    presentationCount: 3,
    weekOverWeek: {
      views: { current: 120, previous: 100, percentChange: 20, direction: 'up' },
      uniqueViewers: { current: 45, previous: 50, percentChange: 10, direction: 'down' },
      avgDuration: { current: 95, previous: 95, percentChange: 0, direction: 'flat' },
    },
    topPresentations: [
      { title: 'Deck A', views: 80, avgDurationSeconds: 110 },
      { title: 'Deck B', views: 30, avgDurationSeconds: 60 },
      { title: 'Deck C', views: 10, avgDurationSeconds: 40 },
      { title: 'Deck D', views: 5, avgDurationSeconds: 20 },
    ],
    insights: [{ text: 'Insight one' }, { text: 'Insight two' }],
    ...overrides,
  };
}

/** A team analytics payload with real activity. */
function teamAnalytics(overrides = {}) {
  return {
    hasActivity: true,
    weekStart: '2026-08-04',
    weekEnd: '2026-08-10',
    totalViews: 500,
    uniqueViewers: 200,
    activePresenters: 4,
    presentationCount: 12,
    weekOverWeek: {
      views: { current: 500, previous: 400, percentChange: 25, direction: 'up' },
    },
    topPresentations: [
      { title: 'Team Deck 1', views: 200, ownerEmail: 'a@example.com' },
      { title: 'Team Deck 2', views: 150, ownerEmail: 'b@example.com' },
      { title: 'Team Deck 3', views: 90, ownerEmail: 'c@example.com' },
      { title: 'Team Deck 4', views: 40, ownerEmail: 'd@example.com' },
      { title: 'Team Deck 5', views: 15, ownerEmail: 'e@example.com' },
      { title: 'Team Deck 6', views: 5, ownerEmail: 'f@example.com' },
    ],
    topPresenters: [
      { name: 'Alice', totalViews: 200, presentationCount: 3 },
      { name: 'Bob', totalViews: 150, presentationCount: 2 },
      { name: 'Cara', totalViews: 90, presentationCount: 4 },
      { name: 'Dan', totalViews: 40, presentationCount: 1 },
      { name: 'Eve', totalViews: 15, presentationCount: 1 },
      { name: 'Finn', totalViews: 5, presentationCount: 1 },
    ],
    ...overrides,
  };
}

const user = { email: 'author@example.com', name: 'Author' };
const admin = { email: 'boss@example.com', name: 'Boss' };

// ---------------------------------------------------------------------------
// No-activity path — no AI call, static digest.
// ---------------------------------------------------------------------------

test('solo: no activity returns the quiet-week digest without calling AI', async () => {
  resetSeam();
  const digest = await generateDigestWithAI(user, {
    hasActivity: false,
    weekStart: '2026-08-04',
    weekEnd: '2026-08-10',
  });

  assert.equal(lastFetch, null, 'AI must not be called when there is no activity');
  assert.equal(digest.greeting, 'Hi Author,');
  assert.deepEqual(digest.topPresentations, []);
  assert.equal(digest.insights.length, 2);
  assert.equal(digest.weekOverWeek.views, '0 (—)');
  assert.match(digest.highlights, /2026-08-04 to 2026-08-10/);
});

test('team: no activity returns the quiet-week team digest without calling AI', async () => {
  resetSeam();
  const digest = await generateTeamDigestWithAI(admin, {
    hasActivity: false,
    weekStart: '2026-08-04',
    weekEnd: '2026-08-10',
    presentationCount: 7,
  });

  assert.equal(lastFetch, null);
  assert.equal(digest.greeting, 'Hi Boss,');
  assert.deepEqual(digest.topPresenters, []);
  assert.equal(digest.activePresenters, 0);
  assert.equal(digest.presentationCount, 7);
  assert.equal(digest.weekOverWeek.views, '0 (—)');
});

// ---------------------------------------------------------------------------
// AI-success path — model prose + server-owned metrics.
// ---------------------------------------------------------------------------

test('solo: AI success merges model prose with server-owned metrics', async () => {
  resetSeam();
  aiResponse = JSON.stringify({
    subject: 'Great week',
    greeting: 'Hi {name},',
    highlights: 'Model highlight paragraph.',
    topPresentationsIntro: 'Your best decks:',
    insights: ['A', 'B', 'C', 'D'], // 4 → capped to 3
    closing: 'Model closing.',
  });

  const digest = await generateDigestWithAI(user, soloAnalytics());

  // Model-authored prose is kept.
  assert.equal(digest.subject, 'Great week');
  assert.equal(digest.highlights, 'Model highlight paragraph.');
  assert.equal(digest.closing, 'Model closing.');
  // {name} placeholder is resolved.
  assert.equal(digest.greeting, 'Hi Author,');
  // Insights capped at 3.
  assert.deepEqual(digest.insights, ['A', 'B', 'C']);
  // topPresentations come from analytics (capped at 3), never the model.
  assert.equal(digest.topPresentations.length, 3);
  assert.equal(digest.topPresentations[0].title, 'Deck A');
  // weekOverWeek is server-formatted from analytics, with direction signs.
  assert.match(digest.weekOverWeek.views, /^120 \(\+20%\)$/);
  assert.match(digest.weekOverWeek.uniqueViewers, /^45 \(-10%\)$/);

  // The AI request asked for JSON output, with a system + user message.
  assert.equal(lastFetch.endpoint, 'https://api.openai.com/v1/chat/completions');
  assert.equal(lastFetch.body.response_format.type, 'json_object');
  assert.equal(lastFetch.body.messages[0].role, 'system');
  assert.equal(lastFetch.body.messages[1].role, 'user');
});

test('team: AI success caps presenters and presentations from analytics', async () => {
  resetSeam();
  aiResponse = JSON.stringify({
    subject: 'Team week',
    greeting: 'Hi {name},',
    highlights: 'Team highlight.',
    topPresentationsIntro: 'Top decks:',
    topPresentersIntro: 'Top folks:',
    insights: ['x', 'y'],
    closing: 'Onward.',
  });

  const digest = await generateTeamDigestWithAI(admin, teamAnalytics());

  assert.equal(digest.subject, 'Team week');
  assert.equal(digest.greeting, 'Hi Boss,');
  // Both server-owned lists are capped at 5.
  assert.equal(digest.topPresentations.length, 5);
  assert.equal(digest.topPresenters.length, 5);
  assert.equal(digest.topPresenters[0].name, 'Alice');
  assert.equal(digest.activePresenters, 4);
  assert.equal(digest.presentationCount, 12);
  assert.deepEqual(digest.insights, ['x', 'y']);
});

test('solo: AI JSON wrapped in a markdown code fence is still parsed', async () => {
  resetSeam();
  aiResponse = '```json\n' + JSON.stringify({ subject: 'Fenced subject' }) + '\n```';

  const digest = await generateDigestWithAI(user, soloAnalytics());
  assert.equal(digest.subject, 'Fenced subject');
  // Missing fields fall back to server defaults, not undefined.
  assert.equal(digest.closing, 'Keep creating great presentations!');
});

// ---------------------------------------------------------------------------
// AI-failure path — deterministic template fallback.
// ---------------------------------------------------------------------------

test('solo: AI throwing falls back to the template digest', async () => {
  resetSeam();
  aiThrows = true;

  const digest = await generateDigestWithAI(user, soloAnalytics());

  // Fallback highlight names the top deck and describes the trend.
  assert.match(digest.highlights, /Deck A/);
  assert.match(digest.highlights, /up 20% from last week/);
  assert.equal(digest.topPresentations.length, 3);
  assert.deepEqual(digest.insights, ['Insight one', 'Insight two']);
});

test('solo: unparseable AI output falls back to the template digest', async () => {
  resetSeam();
  aiResponse = 'this is not json at all';

  const digest = await generateDigestWithAI(user, soloAnalytics());
  assert.match(digest.highlights, /120 views from 45 unique viewers/);
  assert.equal(digest.subject, 'Your weekly engagement insights - 120 views');
});

test('team: AI throwing falls back to the template team digest', async () => {
  resetSeam();
  aiThrows = true;

  const digest = await generateTeamDigestWithAI(admin, teamAnalytics());
  assert.match(digest.highlights, /500 views from 200 unique viewers/);
  assert.match(digest.highlights, /4 team members/);
  assert.equal(digest.topPresenters.length, 5);
});

// ---------------------------------------------------------------------------
// Name handling — email prefix when no display name is set.
// ---------------------------------------------------------------------------

test('a user without a name is greeted by their email prefix', async () => {
  resetSeam();
  const digest = await generateDigestWithAI(
    { email: 'jane.doe@example.com' },
    { hasActivity: false, weekStart: '2026-08-04', weekEnd: '2026-08-10' }
  );
  assert.equal(digest.greeting, 'Hi jane.doe,');
});
