/**
 * `i18n-fill.js --report` completeness guard (B136).
 *
 * The report is the worklist a translator works from, so "0 missing" has to
 * mean *nothing left to translate*. It used to mean "nothing left among the
 * keys a static `t()` call spells", which quietly excluded every runtime-built
 * family — `slideType.*`, `editor.textStyle.*`, `editor.layoutVariant.*`,
 * `editor.inline.add*`/`remove*`. Those keys carry a fixed English string in
 * `en/` and are perfectly translatable; hiding them let a locale sit 272 keys
 * short while the tool called it complete.
 *
 * Run with: node --test tests/i18n-fill-report.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { missingFor } from '../scripts/i18n-fill.js';
import { loadLocale } from '../scripts/i18n-keys.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const i18nDir = path.join(repoRoot, 'client', 'i18n');

/** Every en/ key outside follow.json — the translatable surface. */
async function englishSurface() {
  const en = await loadLocale(i18nDir, 'en');
  return Object.keys(en).filter((k) => !k.startsWith('follow.'));
}

describe('i18n-fill --report', () => {
  it('reports every en/ key a locale does not have, runtime-built ones included', async () => {
    const surface = await englishSurface();
    const nl = await loadLocale(i18nDir, 'nl');
    const gaps = surface.filter((k) => typeof nl[k] !== 'string');
    const reported = await missingFor('nl');
    const unreported = gaps.filter((k) => !(k in reported));
    assert.deepEqual(
      unreported,
      [],
      `--report nl hides ${unreported.length} key(s) that en/ has and nl/ does not`,
    );
  });

  it('does not report keys the locale already has', async () => {
    const nl = await loadLocale(i18nDir, 'nl');
    const reported = Object.keys(await missingFor('nl'));
    const alreadyThere = reported.filter((k) => typeof nl[k] === 'string');
    assert.deepEqual(alreadyThere, []);
  });

  it('never reports follow.* — that dictionary has its own scoped loader', async () => {
    const reported = Object.keys(await missingFor('de'));
    assert.deepEqual(
      reported.filter((k) => k.startsWith('follow.')),
      [],
    );
  });

  it('seeds a non-English locale from en/, not from the code fallback', async () => {
    // A runtime-built key: no static t() call spells it, so before B136 it was
    // invisible to the report. It is in en/, so a locale without it must be
    // told about it — with the en/ wording.
    const en = await loadLocale(i18nDir, 'en');
    const key = 'slideType.timeline-slide.label';
    assert.equal(typeof en[key], 'string', `${key} should exist in en/`);

    const it_ = await loadLocale(i18nDir, 'it');
    const reported = await missingFor('it');
    if (typeof it_[key] === 'string') {
      assert.ok(!(key in reported), 'a translated key must not be reported');
    } else {
      assert.equal(reported[key], en[key]);
    }
  });
});
