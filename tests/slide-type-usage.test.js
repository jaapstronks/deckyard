/**
 * The `usage` field — an organization's own rules for filling a slide type.
 *
 * Two things are worth pinning, and they are different in kind:
 *
 *  1. **The rules** (shared/slide-types/usage.js): what normalization does to a
 *     hand-written template literal, and the deliberate split between the
 *     authoring paths (reject) and the load paths (truncate). Pure, so tested
 *     directly.
 *  2. **The wiring**: that a rule actually reaches an agent through
 *     `resolveAgentSlideTypes`, on both tiers, and that its absence stays an
 *     absence rather than an empty string on every type.
 *
 * What this file deliberately does NOT do is require `usage` anywhere. It is
 * optional by design — gating it would produce invented filler on 31 core types
 * that have no organization whose rules to codify. The companion matrix
 * (tests/slide-type-companion-coverage.test.js) covers the reverse direction for
 * free, because `usage` lives inside the catalog entry rather than beside it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  USAGE_MAX_LENGTH,
  normalizeUsage,
  validateUsage,
  clampUsage,
} from '../shared/slide-types/usage.js';
import { resolveAgentSlideTypes } from '../server/utils/ai/slide-catalog/agent-catalog.js';
import { SLIDE_TYPE_CATALOG } from '../server/utils/ai/slide-catalog/definitions.js';

const CUSTOM_TYPE = {
  slug: 'kwartaalcijfers',
  label: 'Kwartaalcijfers',
  fields: [{ key: 'title', type: 'string', label: 'Titel', required: true }],
  defaults: { title: 'Q1' },
};

// ── The rules ───────────────────────────────────────────────────────────────

test('normalizeUsage dedents the indentation an author never meant to send', () => {
  // What a definition file actually contains: a template literal indented to
  // match the surrounding object. Without dedenting, that indentation reaches
  // the model verbatim.
  const raw = `
      Cijfers komen uit de vastgestelde kwartaalrapportage.
      Vermeld altijd de peildatum.
  `;
  assert.equal(
    normalizeUsage(raw),
    'Cijfers komen uit de vastgestelde kwartaalrapportage.\nVermeld altijd de peildatum.',
  );
});

test('normalizeUsage keeps relative indentation and collapses blank runs', () => {
  const raw = '  Regel een:\n    - subregel\n\n\n\n  Regel twee ';
  assert.equal(normalizeUsage(raw), 'Regel een:\n  - subregel\n\nRegel twee');
});

test('normalizeUsage strips stray control characters, keeping newlines and tabs', () => {
  const raw = 'Regel een\x00\x07  \nRegel\ttwee';
  assert.equal(normalizeUsage(raw), 'Regel een\nRegel\ttwee');
});

test('normalizeUsage treats nothing-to-say as null, whatever shape it arrives in', () => {
  for (const value of [
    '',
    '   ',
    '\n\n\t\n',
    null,
    undefined,
    42,
    {},
    () => 'x',
  ]) {
    assert.equal(
      normalizeUsage(value),
      null,
      `${String(value)} should normalize to null`,
    );
  }
});

test('validateUsage rejects on the authoring path instead of silently shortening', () => {
  const tooLong = 'a'.repeat(USAGE_MAX_LENGTH + 1);
  assert.deepEqual(validateUsage(tooLong), {
    ok: false,
    reason: 'usage_too_long',
  });

  // Exactly at the cap is fine — the boundary is inclusive.
  const atCap = 'a'.repeat(USAGE_MAX_LENGTH);
  assert.deepEqual(validateUsage(atCap), { ok: true, usage: atCap });

  // A non-string is a different failure from an over-long one: the caller maps
  // them to different messages.
  assert.deepEqual(validateUsage({ text: 'x' }), {
    ok: false,
    reason: 'invalid',
    field: 'usage',
  });
  assert.deepEqual(
    validateUsage(() => 'x'),
    { ok: false, reason: 'invalid', field: 'usage' },
  );

  // Absent means "no rule", which is valid and stays null rather than ''.
  assert.deepEqual(validateUsage(undefined), { ok: true, usage: null });
  assert.deepEqual(validateUsage('   '), { ok: true, usage: null });
});

test('clampUsage truncates on the load path instead of killing the type', () => {
  const clamped = clampUsage('b'.repeat(USAGE_MAX_LENGTH + 500));
  assert.equal(clamped.length, USAGE_MAX_LENGTH);
  assert.ok(clamped.endsWith('…'), 'truncation should be visible, not silent');

  // Same tolerance for the shapes validateUsage refuses: absent, not fatal.
  assert.equal(clampUsage({ text: 'x' }), null);
  assert.equal(clampUsage(undefined), null);
});

// ── The wiring ──────────────────────────────────────────────────────────────

test('a Tier-2 rule reaches the agent, after the schema', () => {
  const resolved = resolveAgentSlideTypes({
    customSlideTypes: [
      { ...CUSTOM_TYPE, usage: '  Altijd de peildatum vermelden.  ' },
    ],
  });

  const entry = resolved['custom-kwartaalcijfers'];
  assert.equal(entry.usage, 'Altijd de peildatum vermelden.');

  // Order in the response is part of the contract: shape first, house rule
  // after, so an agent reads them in the order it needs them.
  const keys = Object.keys(entry);
  assert.ok(keys.indexOf('usage') > keys.indexOf('schema'));
});

test('a Tier-1 rule reaches the agent from the catalog entry', () => {
  const entry = SLIDE_TYPE_CATALOG['content-slide'];
  entry.usage = 'Nooit cijfers zonder bron.';
  try {
    const resolved = resolveAgentSlideTypes({});
    assert.equal(resolved['content-slide'].usage, 'Nooit cijfers zonder bron.');
  } finally {
    delete entry.usage;
  }
});

test('a type with no rule carries no usage key at all', () => {
  const resolved = resolveAgentSlideTypes({ customSlideTypes: [CUSTOM_TYPE] });

  assert.equal('usage' in resolved['custom-kwartaalcijfers'], false);

  // And core, today: no organization has written rules into the OSS catalog, so
  // an empty string on every entry would be pure weight in every response.
  const withUsage = Object.values(resolved).filter((e) => 'usage' in e);
  assert.deepEqual(withUsage, []);
});

test('an over-long stored rule is truncated on the way out, not passed through', () => {
  const resolved = resolveAgentSlideTypes({
    customSlideTypes: [
      { ...CUSTOM_TYPE, usage: 'c'.repeat(USAGE_MAX_LENGTH * 3) },
    ],
  });
  // The write path rejects this, so it can only exist in a row written before
  // the cap. The response is the last place it can still be bounded.
  assert.equal(
    resolved['custom-kwartaalcijfers'].usage.length,
    USAGE_MAX_LENGTH,
  );
});

test('usage does not promote a Tier-2 type to documented', () => {
  const resolved = resolveAgentSlideTypes({
    customSlideTypes: [
      { ...CUSTOM_TYPE, usage: 'Altijd de peildatum vermelden.' },
    ],
  });
  // `documented` means editorial copy on the description/bestFor axis, which
  // Tier 2 has no columns for. Two meanings in one flag is one too many.
  assert.equal(resolved['custom-kwartaalcijfers'].documented, false);
});
