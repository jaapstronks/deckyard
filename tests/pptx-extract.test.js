/**
 * The page model of a PowerPoint deck (B828): `extractPptxPages()` must give
 * the model `extractPdfPages()` gives, for a deck pptxgenjs wrote (no
 * placeholders: the heading by size and position) and for one Keynote saved
 * (placeholders, bullets, frames and background inherited from slideLayout
 * and slideMaster). Both fixtures are committed; no test here starts a
 * browser. `tests/fixtures/slide-deck-pptx.js` regenerates the first,
 * `tests/pptx-keynote-fixture.test.js` says where the second comes from.
 *
 * Run with: node --test tests/pptx-extract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import JSZip from 'jszip';

import { extractPptxPages } from '../server/utils/pptx-extract/index.js';
import { colorOf } from '../server/utils/pptx-extract/colors.js';
import { parseXml } from '../server/utils/pptx-extract/xml.js';
import {
  extractPdfPages,
  liesWithin,
  normalizeText,
  pageText,
} from '../server/utils/pdf-extract/index.js';
import { chooseSlide } from '../server/services/deck-slides-import.js';
import { extractTextFromSlideXml } from '../server/utils/convert-file/pptx-text.js';

const read = (name) =>
  fs.readFile(new URL(`./fixtures/${name}`, import.meta.url));
const generated = await read('slide-deck.pptx');
const keynote = await read('slide-deck-keynote.pptx');
const gen = await extractPptxPages(generated);
const key = await extractPptxPages(keynote);

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test('the page model has the shape pdf-extract gives, page and block', async () => {
  const pdf = await extractPdfPages(await read('slide-deck-tagged.pdf'));
  const keys = Object.keys(pdf.pages[0]).sort();
  for (const p of [...gen.pages, ...key.pages]) {
    assert.deepEqual(Object.keys(p).sort(), keys, `page ${p.page}`);
    assert.deepEqual(
      Object.keys(p.drawing).sort(),
      Object.keys(pdf.pages[0].drawing).sort(),
    );
    for (const line of p.lines) {
      assert.deepEqual(
        Object.keys(line).sort(),
        Object.keys(pdf.pages[0].lines[0]).sort(),
      );
    }
    for (const block of p.blocks) {
      assert.ok(block.box, `page ${p.page}: a ${block.kind} block has a box`);
      assert.ok(
        liesWithin(
          block.box,
          { x: 0, y: 0, width: p.width, height: p.height },
          0.99,
        ),
      );
    }
  }
});

test('pptxgenjs deck: six visible pages, the hidden slide left out, notes beside them', () => {
  assert.equal(gen.pageCount, 6);
  assert.equal(gen.pages.length, 6);
  assert.equal(gen.notes.length, 6);
  assert.deepEqual(gen.size, { width: 720, height: 405 });
  assert.deepEqual(gen.metadata, {
    title: 'Fixture deck',
    author: 'Deckyard tests',
  });
  assert.deepEqual(
    gen.pages.map((p) => p.page),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(!gen.pages.some((p) => pageText(p).includes('Hidden draft')));
});

test('pptxgenjs deck: without placeholders the heading comes from size and position', () => {
  const [title, list, office, table] = gen.pages;
  assert.equal(title.heading, 'Quarterly results 2025');
  assert.equal(title.headingSource, 'geometry');
  assert.deepEqual(
    title.blocks.map((b) => b.text),
    ['Growth across every region', '17 October 2025'],
  );
  assert.equal(list.heading, 'What we learned');
  assert.equal(office.heading, 'Our new office');
  assert.equal(table.heading, 'Revenue by region');
});

test('pptxgenjs deck: a bulleted list of four literal items, the slide number dropped', () => {
  const p = gen.pages[1];
  assert.equal(p.blocks.length, 1);
  const [list] = p.blocks;
  assert.equal(list.kind, 'list');
  assert.equal(list.variant, 'bullets');
  assert.deepEqual(
    list.items.map((i) => i.text),
    [
      'Customers want faster onboarding',
      'Pricing is clear enough',
      'Support response times improved',
      'Mobile usage doubled',
    ],
  );
  assert.deepEqual(
    p.dropped.map((d) => [d.text, d.reason]),
    [['2', 'artifact']],
  );
});

test('pptxgenjs deck: a JPEG picture comes out as PNG with its box and alt text', () => {
  const p = gen.pages[2];
  assert.equal(p.images.length, 1);
  const [img] = p.images;
  assert.ok(img.png.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.deepEqual(img.pixels, { width: 120, height: 80 });
  assert.equal(img.alt, 'Floor plan of the new office');
  assert.equal(Math.round(img.box.x), 414);
  assert.equal(Math.round(img.box.width), 252);
  assert.equal(
    p.blocks[0].text,
    'The team moved into a brighter space in the city centre.',
  );
});

test('pptxgenjs deck: a table with its header row read from the bold first row', () => {
  const [table] = gen.pages[3].blocks;
  assert.equal(table.kind, 'table');
  assert.equal(table.headerRow, true);
  assert.deepEqual(table.rows, [
    ['Region', 'Q3', 'Q4'],
    ['North', '1.2', '1.4'],
    ['South', '0.9', '1.1'],
    ['West', '1.5', '1.6'],
  ]);
  assert.equal(
    gen.pages[3].lines.filter((l) => l.role === 'table-cell').length,
    12,
  );
});

test('a chart frame is a drawing with its box, and the slide import reads it as one', () => {
  for (const p of [gen.pages[4], key.pages[4]]) {
    assert.ok(p.heading);
    assert.deepEqual(p.blocks, []);
    assert.ok(p.drawing.box, `page ${p.page} has a drawing box`);
    assert.ok(p.drawing.box.y > p.lines[0].y - p.lines[0].size);
    assert.deepEqual(chooseSlide(p, { pagePixels: false }), {
      reason: 'drawing',
    });
  }
});

test('pptxgenjs deck: the slide background is the page colour', () => {
  const p = gen.pages[5];
  assert.deepEqual(p.background, { color: '#0b5ed7' });
  assert.deepEqual(
    p.lines.map((l) => [l.text, l.color]),
    [
      ['Chapter two', '#ffffff'],
      ['Looking ahead', '#ffffff'],
    ],
  );
  for (const q of gen.pages.slice(0, 5)) {
    assert.deepEqual(q.background, { color: '#ffffff' });
  }
});

test('Keynote deck: the heading is the title placeholder on every slide', () => {
  assert.equal(key.pageCount, 6);
  assert.deepEqual(
    key.pages.map((p) => [p.heading, p.headingSource]),
    [
      ['Voorbeeldpresentatie', 'struct'],
      ['Drie punten', 'struct'],
      ['Een kleine tabel', 'struct'],
      ['Beeld met tekst', 'struct'],
      ['Groei per kwartaal', 'struct'],
      ['Hoofdstuk twee', 'struct'],
    ],
  );
});

test('Keynote deck: style, bullets and frames come from layout and master', () => {
  const [title, list, , picture] = key.pages;
  // The title style's accent1 with hueOff/lumOff, as the PDF export draws it.
  assert.equal(title.lines[0].color, '#004d80');
  assert.equal(title.lines[0].size, 85);
  // The subtitle's size and colour come from the layout placeholder.
  assert.deepEqual(title.blocks, [
    {
      kind: 'para',
      y: title.blocks[0].y,
      text: 'Dummy-inhoud voor de importtest',
      bold: true,
      size: 55,
      box: title.blocks[0].box,
    },
  ]);
  assert.equal(title.lines[1].color, '#00a2ff');
  // The master's body style puts a bullet on paragraphs that set none.
  assert.equal(list.blocks.length, 1);
  assert.equal(list.blocks[0].variant, 'bullets');
  assert.deepEqual(
    list.blocks[0].items.map((i) => i.text),
    ['Eerste punt', 'Tweede punt', 'Derde punt'],
  );
  // The heading frame is the layout's: the slide's title has no xfrm.
  assert.equal(Math.round(list.lines[0].x), 99);
  // The picture placeholder holds the picture, in the slide's own frame; its
  // description is a file name, so no alt.
  assert.equal(picture.images.length, 1);
  assert.equal(picture.images[0].box.x, 960);
  assert.equal(picture.images[0].alt, undefined);
});

test('Keynote deck: the empty body placeholder gives no block', () => {
  for (const p of key.pages) {
    assert.ok(!p.blocks.some((b) => b.kind === 'para' && !b.text));
    assert.ok(!p.lines.some((l) => !l.text));
  }
  assert.equal(key.pages[4].blocks.length, 0);
});

test('Keynote deck: the table keeps its header row from firstRow', () => {
  const [table] = key.pages[2].blocks;
  assert.equal(table.kind, 'table');
  assert.equal(table.headerRow, true);
  assert.deepEqual(table.rows[0], ['Product', 'Aantal', 'Prijs']);
  assert.deepEqual(table.rows.at(-1), ['Kiwi', '20', '4,00']);
});

test('Keynote deck: the background is inherited from the layout', () => {
  assert.deepEqual(key.pages[0].background, { color: '#003462' });
  assert.deepEqual(key.pages[5].background, { color: '#003462' });
  assert.equal(key.pages[5].lines[0].color, '#ffffff');
  for (const p of key.pages.slice(1, 5)) {
    assert.deepEqual(p.background, { color: '#ffffff' });
  }
});

test('every paragraph of every visible slide stands literally in the model', async () => {
  for (const [buffer, result] of [
    [generated, gen],
    [keynote, key],
  ]) {
    const zip = await JSZip.loadAsync(buffer);
    const parts = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort(
        (a, b) =>
          Number(/(\d+)\.xml/.exec(a)[1]) - Number(/(\d+)\.xml/.exec(b)[1]),
      );
    let page = 0;
    for (const part of parts) {
      const xml = await zip.file(part).async('string');
      if (/<p:sld\b[^>]*\bshow="0"/.test(xml)) continue;
      const model = result.pages[page++];
      const kept = [
        ...pageText(model).split('\n'),
        ...model.blocks.flatMap((b) =>
          b.kind === 'table'
            ? b.rows.flat()
            : (b.items || []).flatMap((i) => i.parts),
        ),
        ...model.dropped.map((d) => d.text),
      ];
      for (const paragraph of extractTextFromSlideXml(xml).split('\n')) {
        const text = normalizeText(paragraph);
        if (!text) continue;
        assert.ok(
          kept.includes(text),
          `page ${model.page}: "${text}" is in the model literally`,
        );
      }
    }
  }
});

test('an aborted signal stops the extraction', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(
    extractPptxPages(generated, { signal: controller.signal }),
    /stop/,
  );
});

test('groups map their children, and a metafile picture is dropped with its reason', async () => {
  const zip = await JSZip.loadAsync(generated);
  const part = 'ppt/slides/slide3.xml';
  const xml = await zip.file(part).async('string');
  const pic = /<p:pic>[\s\S]*?<\/p:pic>/.exec(xml)[0];
  // The picture inside a group that halves its child space and moves it.
  const group =
    '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="90" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2571750"/>' +
    '<a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="5143500"/></a:xfrm></p:grpSpPr>' +
    `${pic}</p:grpSp>`;
  const emf = pic
    .replace(/descr="[^"]*"/, 'descr="Company logo"')
    .replace(/r:embed="[^"]*"/, 'r:embed="rIdEmf"');
  zip.file(part, xml.replace(pic, group + emf));
  const rels = 'ppt/slides/_rels/slide3.xml.rels';
  zip.file(
    rels,
    (await zip.file(rels).async('string')).replace(
      '</Relationships>',
      '<Relationship Id="rIdEmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.emf"/></Relationships>',
    ),
  );
  zip.file('ppt/media/logo.emf', Buffer.from('not really a metafile'));
  const { pages } = await extractPptxPages(
    await zip.generateAsync({ type: 'nodebuffer' }),
  );
  const [img] = pages[2].images;
  const original = gen.pages[2].images[0].box;
  assert.equal(pages[2].images.length, 1);
  assert.ok(Math.abs(img.box.x - original.x / 2) < 0.01);
  assert.ok(Math.abs(img.box.width - original.width / 2) < 0.01);
  assert.deepEqual(
    pages[2].dropped.map((d) => [d.text, d.reason]),
    [['Company logo', 'unsupported-image']],
  );
});

test('colour modifiers: lighter and darker variants of a scheme colour', () => {
  const ctx = {
    scheme: { accent1: '#4472c4', dk1: '#000000' },
    clrMap: { tx1: 'dk1' },
  };
  const color = (xml) => colorOf(parseXml(xml), ctx);
  // PowerPoint's "Accent 1, lighter 40%" and "darker 50%".
  assert.equal(
    color(
      '<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>',
    ),
    '#8faadc',
  );
  assert.equal(
    color('<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>'),
    '#203864',
  );
  assert.equal(color('<a:schemeClr val="tx1"/>'), '#000000');
  assert.equal(
    color('<a:srgbClr val="FF0000"><a:shade val="50000"/></a:srgbClr>'),
    '#800000',
  );
  assert.equal(
    color('<a:sysClr val="windowText" lastClr="111111"/>'),
    '#111111',
  );
});

test('a `>` inside an attribute value does not end the tag', () => {
  const root = parseXml(
    `<p:pic><p:cNvPr descr="a > b" name='x>y'/><a:t>after</a:t></p:pic>`,
  );
  assert.deepEqual(
    root.children.map((c) => [c.name, c.attrs, c.text]),
    [
      ['p:cNvPr', { descr: 'a > b', name: 'x>y' }, ''],
      ['a:t', {}, 'after'],
    ],
  );
});
