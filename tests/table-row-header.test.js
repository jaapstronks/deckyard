import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { SLIDE_TYPES } from '../shared/slide-types.js';
import { renderSlideBodySemanticHtml } from '../shared/slide-types/semantic-projection.js';
import {
  collectCardsForSlide,
  applyCardsVisibility,
} from '../client/views/presenter/step.js';

/**
 * B313 (D148) — the reader said `<th scope="row">` for a table's first column
 * because `rows` declares `rowHeader: 'first'`, while the canvas emitted a
 * `<td>`. Two surfaces disagreeing about one declaration is the defect. These
 * tests pin that the canvas reads the same declaration, that the step-reveal
 * and inline-edit hooks ride along on the `<th>`, and (B473, D225) that the
 * header cells, corner included, say `scope="col"` as the reader does.
 */

const TABLE = SLIDE_TYPES['table-slide'];
const ROWS_FIELD = TABLE.fields.find((f) => f.key === 'rows');

const content = {
  title: 'Planning',
  colCount: '3',
  rows: [
    { c1: 'Fase', c2: 'Wat', c3: 'Wie' },
    { c1: '1', c2: 'Opzet', c3: 'Team' },
    { c1: '2', c2: 'Uitvoering', c3: 'Team' },
  ],
};

function canvas(extra = {}) {
  const html = TABLE.renderHtml({
    ...structuredClone(TABLE.defaults),
    ...content,
    ...extra,
  });
  return new JSDOM(`<body><section>${html}</section></body>`).window.document;
}

test('the canvas makes column 1 of every body row <th scope="row">', () => {
  assert.equal(ROWS_FIELD.rowHeader, 'first');
  const doc = canvas();
  const bodyRows = [...doc.querySelectorAll('.md-table tbody tr')];
  assert.equal(bodyRows.length, 2);
  for (const tr of bodyRows) {
    const [first, ...rest] = tr.children;
    assert.equal(first.tagName, 'TH');
    assert.equal(first.getAttribute('scope'), 'row');
    assert.ok(rest.every((c) => c.tagName === 'TD'));
  }
});

test('canvas and reader agree on the row-header cells', () => {
  const doc = canvas();
  const reader = new JSDOM(
    `<body>${renderSlideBodySemanticHtml({ type: 'table-slide', content: { ...structuredClone(TABLE.defaults), ...content } }, TABLE, { headingKey: 'title' })}</body>`,
  ).window.document;
  const heads = (d) =>
    [...d.querySelectorAll('tbody th[scope="row"]')].map((c) =>
      c.textContent.trim(),
    );
  assert.deepEqual(heads(doc), ['1', '2']);
  assert.deepEqual(heads(doc), heads(reader));
});

test('canvas and reader agree on the column-header cells (D225)', () => {
  const doc = canvas();
  const reader = new JSDOM(
    `<body>${renderSlideBodySemanticHtml({ type: 'table-slide', content: { ...structuredClone(TABLE.defaults), ...content } }, TABLE, { headingKey: 'title' })}</body>`,
  ).window.document;
  const heads = (d) =>
    [...d.querySelectorAll('thead th')].map((c) => [
      c.textContent.trim(),
      c.getAttribute('scope'),
    ]);
  assert.deepEqual(heads(doc), [
    ['Fase', 'col'],
    ['Wat', 'col'],
    ['Wie', 'col'],
  ]);
  assert.deepEqual(heads(doc), heads(reader));
});

test('the corner cell heads its column, whatever cornerCell says', () => {
  for (const cornerCell of ['label', 'header']) {
    const corner = canvas({ cornerCell }).querySelector(
      '.md-table thead th:first-child',
    );
    assert.equal(corner.getAttribute('scope'), 'col');
    assert.equal(corner.textContent, 'Fase');
  }
});

test('with the header row off, the first data row heads by column 1 too', () => {
  const doc = canvas({ headerRow: 'off' });
  assert.equal(doc.querySelector('.md-table thead'), null);
  const first = doc.querySelector('.md-table tbody tr').firstElementChild;
  assert.equal(first.tagName, 'TH');
  assert.equal(first.getAttribute('data-inline-field'), 'rows.0.c1');
});

test('inline edit addresses the row-header <th> like any other cell', () => {
  const doc = canvas();
  const heads = [...doc.querySelectorAll('.md-table tbody th[scope="row"]')];
  assert.deepEqual(
    heads.map((c) => c.getAttribute('data-inline-field')),
    ['rows.1.c1', 'rows.2.c1'],
  );
});

test('step-reveal by cell steps through the row-header <th> in reading order', () => {
  const doc = canvas({ animateByCell: 'on' });
  const section = doc.querySelector('section');
  const steps = collectCardsForSlide(section);
  // Header 3 + two body rows of 3.
  assert.equal(steps.length, 9);
  assert.equal(steps[3].tagName, 'TH');
  assert.equal(steps[3].getAttribute('scope'), 'row');
  applyCardsVisibility(section, 3);
  assert.ok(steps[3].classList.contains('sb-step-hidden'));
  applyCardsVisibility(section, 4);
  assert.ok(!steps[3].classList.contains('sb-step-hidden'));
});

test('the table CSS follows the tag: label colour and body weight reach the <th>', () => {
  const css = readFileSync(
    new URL(
      '../client/styles/slides/01-layout-and-title/35-table-slide.css',
      import.meta.url,
    ),
    'utf8',
  );
  // The label-column colour covers the body row-header cell.
  assert.match(
    css,
    /\.md-table td:first-child,\s*\.slide-table \.md-table tbody th:first-child,/,
  );
  // The emphasis weight is the header row's, not every <th>'s.
  assert.match(css, /\.slide-table \.md-table thead th \{\s*font-weight: 500;/);
  assert.doesNotMatch(css, /\.slide-table \.md-table th \{\s*font-weight/);
});
