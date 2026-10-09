/**
 * The chart speaks the deck's language: its error card, the parser's refusals
 * and the SVG's accessible name come from the slide-copy table, never from a
 * string in the chart modules (B235).
 *
 * Run with: node --test tests/chart-slide-copy.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { default: chartSlide } =
  await import('../shared/slide-types/types/chart-slide.js');
const { CHART_ERROR, parseChartData } =
  await import('../shared/slide-types/types/chart-slide/parse.js');
const { chartErrorMessages } =
  await import('../shared/slide-types/types/chart-slide/error.js');
const { getSlideCopy } = await import('../shared/slide-types/slide-copy.js');

const CHART_DIR = 'shared/slide-types/types/chart-slide';

const render = (content, lang) =>
  chartSlide.renderHtml({ ...chartSlide.defaults, ...content }, {}, { lang });

describe('chart error card', () => {
  for (const lang of ['nl', 'en']) {
    const copy = getSlideCopy(lang);
    it(`says a parse error in the deck language (${lang})`, () => {
      const html = render({ chartType: 'bar', data: '' }, lang);
      assert.match(html, new RegExp(`aria-label="${copy.chartErrorsLabel}"`));
      assert.ok(html.includes(copy.chartErrorTitle));
      assert.ok(html.includes(copy.chartErrorEmpty));
    });

    it(`names the SVG by its kind in the deck language (${lang})`, () => {
      assert.ok(
        render({ chartType: 'bar' }, lang).includes(
          `aria-label="${copy.chartKindBar}"`,
        ),
      );
      assert.ok(
        render(
          { chartType: 'pie', data: 'Label,Value\nA,1\nB,2' },
          lang,
        ).includes(`aria-label="${copy.chartKindPie}"`),
      );
      assert.ok(
        render(
          { chartType: 'line', data: 'X,Y\n1,2\n2,3', title: '' },
          lang,
        ).includes(`aria-label="${copy.chartKindLine}"`),
      );
    });
  }
});

describe('parser error codes', () => {
  const cases = [
    ['bar', '', CHART_ERROR.empty],
    ['bar', 'Label,Value\nA,1', CHART_ERROR.tooFewRows],
    ['bar', 'Label,Value,Z\nA,1,\n,,q', CHART_ERROR.tooFewDataRows],
    ['bar', 'Label,Value\nA,x\nB,y', CHART_ERROR.noNumbers],
    ['pie', 'Label,Value\nA,1\nB,-2', CHART_ERROR.pieNegative],
    ['line', 'X,Y,Z,W\n1,2,,\n,,,q', CHART_ERROR.tooFewPoints],
    ['line', 'X,Y\n1,2\n2,', CHART_ERROR.lineNumbers],
  ];
  for (const [chartType, data, code] of cases) {
    it(`${chartType} ${JSON.stringify(data)} → ${code}`, () => {
      const parsed = parseChartData({ chartType, data });
      assert.deepEqual(parsed.errors, [code]);
    });
  }

  it('every code has a message in nl and en', () => {
    for (const code of Object.values(CHART_ERROR)) {
      for (const lang of ['nl', 'en']) {
        const [msg] = chartErrorMessages([code], lang);
        assert.notEqual(msg, code, `${code} has no ${lang} message`);
      }
    }
  });
});

describe('chart-slide modules carry no prose', () => {
  // Words only a hardcoded NL or EN message would contain. The column names
  // `defaultHeaderFor()` seeds into a grid are data the deck stores, not copy;
  // `ai.js` is the type's prompt to a model, which reads English.
  const PROSE =
    /['"`](?:[^'"`]*\b(?:Kan |Niet genoeg|Geen |vereist|negatieve|Onbekend|Data is leeg|Chart errors|Unknown chart|Bar chart|Pie chart|Line chart)\b[^'"`]*)['"`]/;
  const files = readdirSync(CHART_DIR).filter(
    (f) => f.endsWith('.js') && f !== 'ai.js',
  );
  for (const f of [
    ...files.map((f) => join(CHART_DIR, f)),
    `${CHART_DIR}.js`,
  ]) {
    it(f, () => {
      const code = readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join('\n');
      assert.doesNotMatch(code, PROSE);
    });
  }
});
