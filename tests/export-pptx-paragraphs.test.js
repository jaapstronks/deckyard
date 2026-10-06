/** B598: DrawingML paragraphs keep one properties element before their runs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { initSanitizer } from '../shared/sanitize.js';
import {
  paragraphRuns,
  finishEditablePackage,
} from '../server/export/pptx-generic.js';
import { createWidePptx } from '../server/export/pptx-theme.js';
import { buildEditablePptxBuffer } from '../server/export/pptx.js';

await initSanitizer();
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function paragraphs(xml) {
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
  return [...doc.getElementsByTagNameNS(drawingNs, 'p')];
}

function onePropertiesFirst(p) {
  const properties = [...p.children].filter((el) => el.localName === 'pPr');
  assert.equal(properties.length, 1, p.textContent);
  assert.equal(p.firstElementChild, properties[0]);
  return properties[0];
}

async function slideXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('ppt/slides/slide1.xml').async('string');
}

test('mixed runs retain bullet, level, numbering, breaks and links in one paragraph', async () => {
  const pptx = await createWidePptx();
  pptx.addSlide().addText(
    paragraphRuns(
      [
        {
          lines: [[{ text: 'Plain bullet' }]],
          level: 0,
          bullet: { kind: 'bullet' },
        },
        {
          lines: [
            [
              { text: 'Mixed ' },
              { text: 'bold', bold: true },
              { text: ' link', href: 'https://example.com/b598' },
            ],
            [{ text: 'soft continuation', italic: true }],
          ],
          level: 1,
          bullet: { kind: 'bullet' },
        },
        {
          lines: [[{ text: 'Number ' }, { text: 'seven', bold: true }]],
          level: 0,
          bullet: { kind: 'number', n: 7 },
        },
        {
          lines: [[{ text: 'Ordinary ' }, { text: 'paragraph', italic: true }]],
          level: 0,
          bullet: null,
        },
      ],
      { pt: 24, color: '123456', face: 'Arial' },
    ),
    { x: 1, y: 1, w: 10, h: 5, margin: 0 },
  );
  const raw = await pptx.write({ outputType: 'nodebuffer' });
  const finished = await finishEditablePackage(raw);
  const ps = paragraphs(await slideXml(finished));
  assert.equal(ps.length, 4);
  const props = ps.map(onePropertiesFirst);
  assert.equal(props[0].getElementsByTagNameNS(drawingNs, 'buChar').length, 1);
  assert.equal(props[1].getAttribute('lvl'), '1');
  assert.equal(props[1].getElementsByTagNameNS(drawingNs, 'buChar').length, 1);
  assert.equal(props[1].getElementsByTagNameNS(drawingNs, 'spcAft').length, 1);
  assert.equal(
    props[2]
      .getElementsByTagNameNS(drawingNs, 'buAutoNum')[0]
      .getAttribute('startAt'),
    '7',
  );
  assert.equal(props[3].getElementsByTagNameNS(drawingNs, 'buNone').length, 1);
  assert.equal(ps[1].getElementsByTagNameNS(drawingNs, 'br').length, 1);
  const runs = [...ps[1].getElementsByTagNameNS(drawingNs, 'r')];
  assert.deepEqual(
    runs.map((r) => r.getElementsByTagNameNS(drawingNs, 't')[0].textContent),
    ['Mixed ', 'bold', ' link', 'soft continuation'],
  );
  assert.equal(runs[1].firstElementChild.getAttribute('b'), '1');
  assert.equal(runs[3].firstElementChild.getAttribute('i'), '1');
  assert.equal(
    runs[2].getElementsByTagNameNS(drawingNs, 'hlinkClick').length,
    1,
  );
  for (const run of runs) {
    assert.equal(
      run.getElementsByTagNameNS(drawingNs, 'srgbClr')[0].getAttribute('val'),
      '123456',
    );
  }
  const z = await JSZip.loadAsync(finished);
  assert.match(
    await z.file('ppt/slides/_rels/slide1.xml.rels').async('string'),
    /Target="https:\/\/example.com\/b598"/,
  );
  assert.deepEqual(
    await finishEditablePackage(finished),
    finished,
    'a canonical package is unchanged',
  );
});

for (const compose of ['generic', 'fidelity']) {
  test(`the ${compose} export keeps bullets on mixed markdown paragraphs`, async () => {
    const built = await buildEditablePptxBuffer(
      '.',
      {
        id: 'b598',
        title: 'Bullet regression',
        lang: 'en-GB',
        slides: [
          {
            id: 'c1',
            type: 'callout-slide',
            content: {
              variant: 'note',
              label: 'Paragraphs',
              body: '- Plain item\n- Mixed **bold** and [link](https://example.com/b598)\n- Last *italic* item',
            },
          },
        ],
      },
      { compose },
    );
    const ps = paragraphs(await slideXml(built.buffer));
    const items = ps.filter((p) =>
      /^(Plain item|Mixed |Last )/.test(p.textContent),
    );
    assert.equal(items.length, 3);
    for (const p of items) {
      const props = onePropertiesFirst(p);
      assert.equal(props.getElementsByTagNameNS(drawingNs, 'buChar').length, 1);
      assert.equal(props.getElementsByTagNameNS(drawingNs, 'buNone').length, 0);
    }
    assert.deepEqual(built.imageSlides, []);
  });
}
