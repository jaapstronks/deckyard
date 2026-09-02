/**
 * The join code a marketing shot prints is pinned, and pinnable.
 *
 * A follow code is minted per session, so two capture runs of the same recipe
 * produced eight PNGs that differed in exactly the code region and nowhere
 * else (capture/README.md § *What two runs on one host actually produce*).
 * `pinJoinCode()` substitutes a fixed code after render; these tests hold up
 * the two halves that make that possible.
 *
 * 1. **The pinned codes are shaped like minted ones.** A marketing shot showing
 *    a code the mint could never hand out reads as a typo, so the length and
 *    alphabet are checked against `server/storage/follow-codes.js` rather than
 *    trusted to stay in step.
 * 2. **Every renderer marks the code it prints.** `data-follow-code` is the
 *    capture hook, deliberately an attribute rather than a style class — a CSS
 *    tidy-up renaming `.sfi-code` must not silently turn the substitution into
 *    a no-op.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MARKETING_FOLLOW_CODES } from '../capture/lib/marketing.js';
import followInviteSlide from '../shared/slide-types/types/follow-invite-slide.js';
import pollSlide from '../shared/slide-types/types/poll-slide.js';
import feedbackSlide from '../shared/slide-types/types/feedback-slide.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The mint's own shape, read from source: `CODE_LENGTH` and `CODE_ALPHABET` are
 * module-private on purpose (nothing outside the mint may generate a code), so
 * this reads them the way a guard test reads a constant it must not import.
 */
function mintShape() {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, 'server/storage/follow-codes.js'),
    'utf8',
  );
  const length = src.match(/const CODE_LENGTH = (\d+);/);
  const alphabet = src.match(/const CODE_ALPHABET = '([A-Z]+)';/);
  assert.ok(length, 'CODE_LENGTH not found in server/storage/follow-codes.js');
  assert.ok(
    alphabet,
    'CODE_ALPHABET not found in server/storage/follow-codes.js',
  );
  return { length: Number(length[1]), alphabet: alphabet[1] };
}

test('the pinned marketing codes are shaped like minted follow codes', () => {
  const { length, alphabet } = mintShape();
  for (const [lang, code] of Object.entries(MARKETING_FOLLOW_CODES)) {
    assert.equal(
      code.length,
      length,
      `pinned ${lang} code "${code}" is not ${length} letters`,
    );
    for (const letter of code) {
      assert.ok(
        alphabet.includes(letter),
        `pinned ${lang} code "${code}" uses "${letter}", which the mint never produces`,
      );
    }
  }
});

test('the pinned codes differ per language', () => {
  // The poll slide prints every row at once; one code under two languages would
  // claim the two follow URLs are the same session.
  const pinned = Object.values(MARKETING_FOLLOW_CODES);
  assert.equal(new Set(pinned).size, pinned.length);
});

/** Every `data-follow-code` in `html`, as `{ key: text }`. */
function markedCodes(html) {
  const found = {};
  // The key is a deck language, so the pattern spans the axis spelling —
  // `en-GB` carries a capital pair that a lower-case-only class would miss.
  const re = /data-follow-code="([A-Za-z-]+)"[^>]*>([^<]*)</g;
  let m;
  while ((m = re.exec(html))) found[m[1]] = m[2].trim();
  return found;
}

// Keyed by deck language, one per version — the shape the mint produces since
// B182/D72 #6, and the shape every renderer below reads.
const FOLLOW_CODES = { nl: 'AAAAA', 'en-GB': 'BBBBB' };

test('follow-invite-slide marks its code with the language it belongs to', () => {
  const nl = followInviteSlide.renderHtml(
    { presentationId: 'p1' },
    {},
    { lang: 'nl', followCodes: FOLLOW_CODES },
  );
  assert.deepEqual(markedCodes(nl), { nl: 'AAAAA' });

  const en = followInviteSlide.renderHtml(
    { presentationId: 'p1' },
    {},
    { lang: 'en-GB', followCodes: FOLLOW_CODES },
  );
  assert.deepEqual(markedCodes(en), { 'en-GB': 'BBBBB' });
});

test('poll-slide marks both codes it prints', () => {
  const html = pollSlide.renderHtml(
    { question: 'Q', options: [{ text: 'A' }, { text: 'B' }] },
    {},
    { lang: 'nl', followCodes: FOLLOW_CODES },
  );
  assert.deepEqual(markedCodes(html), { nl: 'AAAAA', 'en-GB': 'BBBBB' });
});

test('feedback-slide marks both codes it prints', () => {
  const html = feedbackSlide.renderHtml(
    { question: 'Q' },
    {},
    { lang: 'nl', presentationId: 'p1', followCodes: FOLLOW_CODES },
  );
  assert.deepEqual(markedCodes(html), { nl: 'AAAAA', 'en-GB': 'BBBBB' });
});

test('a deck with a third version gets a third marked row', () => {
  // The pair used to be hardcoded in both renderers, so a German version was
  // unreachable from the poll and feedback slides even mid-session (B182/D72 #6).
  const codes = { nl: 'AAAAA', 'en-GB': 'BBBBB', de: 'CCCCC' };
  const poll = pollSlide.renderHtml(
    { question: 'Q', options: [{ text: 'A' }] },
    {},
    { lang: 'nl', followCodes: codes },
  );
  assert.deepEqual(markedCodes(poll), codes);
  const feedback = feedbackSlide.renderHtml(
    { question: 'Q' },
    {},
    { lang: 'de', presentationId: 'p1', followCodes: codes },
  );
  assert.deepEqual(markedCodes(feedback), codes);
});

test('a slide with no session codes still marks the placeholder', () => {
  // The placeholder is what `follow-invite-runtime.js` fills asynchronously
  // from its own mint — the path the editor-side shots take. If it were
  // unmarked, the pin would miss exactly the element that changes late.
  const html = followInviteSlide.renderHtml({ presentationId: 'p1' }, {}, {});
  assert.deepEqual(markedCodes(html), { nl: '----' });
});
