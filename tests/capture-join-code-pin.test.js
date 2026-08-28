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
  // The poll slide prints both rows at once; one code under two languages would
  // claim the two follow URLs are the same session.
  assert.notEqual(MARKETING_FOLLOW_CODES.nl, MARKETING_FOLLOW_CODES.en);
});

/** Every `data-follow-code` in `html`, as `{ key: text }`. */
function markedCodes(html) {
  const found = {};
  const re = /data-follow-code="([a-z-]+)"[^>]*>([^<]*)</g;
  let m;
  while ((m = re.exec(html))) found[m[1]] = m[2].trim();
  return found;
}

const FOLLOW_CODES = { nl: 'AAAAA', en: 'BBBBB' };

test('follow-invite-slide marks its code with the language it belongs to', () => {
  const nl = followInviteSlide.renderHtml(
    { presentationId: 'p1' },
    {},
    { lang: 'nl', followCodes: FOLLOW_CODES },
  );
  assert.deepEqual(markedCodes(nl), { nl: 'AAAAA' });

  // The render language is `en-GB`; the code is filed under `en`. The marker
  // has to carry the key, not the render language.
  const en = followInviteSlide.renderHtml(
    { presentationId: 'p1' },
    {},
    { lang: 'en-GB', followCodes: FOLLOW_CODES },
  );
  assert.deepEqual(markedCodes(en), { en: 'BBBBB' });
});

test('poll-slide marks both codes it prints', () => {
  const html = pollSlide.renderHtml(
    { question: 'Q', options: [{ text: 'A' }, { text: 'B' }] },
    {},
    { lang: 'nl', followCodes: FOLLOW_CODES },
  );
  assert.deepEqual(markedCodes(html), { nl: 'AAAAA', en: 'BBBBB' });
});

test('feedback-slide marks both codes it prints', () => {
  const html = feedbackSlide.renderHtml(
    { question: 'Q' },
    {},
    { lang: 'nl', presentationId: 'p1', followCodes: FOLLOW_CODES },
  );
  assert.deepEqual(markedCodes(html), { nl: 'AAAAA', en: 'BBBBB' });
});

test('a slide with no session codes still marks the placeholder', () => {
  // The placeholder is what `follow-invite-runtime.js` fills asynchronously
  // from its own mint — the path the editor-side shots take. If it were
  // unmarked, the pin would miss exactly the element that changes late.
  const html = followInviteSlide.renderHtml({ presentationId: 'p1' }, {}, {});
  assert.deepEqual(markedCodes(html), { nl: '----' });
});
