/**
 * Source of tests/fixtures/slide-deck.pptx (B828): the four pages of
 * `slide-deck-tagged.html` written by pptxgenjs, plus a chart, a page on a
 * coloured background and a hidden slide. The deck is committed; the tests
 * read it and never run this script. pptxgenjs writes no placeholders, so
 * every heading here is a plain text box: the extractor finds it by size and
 * position, where the Keynote fixture gives it as a placeholder.
 *
 * Regenerate from the core root (pptxgenjs is an optional dependency):
 *
 *   node tests/fixtures/slide-deck-pptx.js
 */

import fs from 'node:fs/promises';
import sharp from 'sharp';
import PptxGenJS from 'pptxgenjs';

/** The 120×80 picture of the HTML fixture, as a JPEG: the extractor converts it. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAMAAADlRUG7AAAABlBMVEXmeB4oWqC8wsucAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAjUlEQVRoge3SQQrAMAwDQfn/n+5ZvpgYoha6cw1kQVj1EhFOUazUEI5RLuUIxyiXcoRjlEs5wjH6alh7hB1TdxzXgWHKGt73CDum7jiuA8OUNbzvEXZM3XFcB4Ypa3jfI+yYuuO4DgxT1vC+R9gxdfe/47pG974m7Jg6RrmUIxyjXMoRjlEu5QjHvDb1A3aEHIQCP7nxAAAAAElFTkSuQmCC';
const jpeg = await sharp(Buffer.from(PNG, 'base64')).jpeg().toBuffer();

const HEADING = { x: 0.75, y: 0.5, w: 8.5, h: 0.8, fontSize: 33, bold: true };
const BODY = { fontSize: 18, color: '111111' };

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';
pptx.title = 'Fixture deck';
pptx.author = 'Deckyard tests';

let slide = pptx.addSlide();
slide.addText('Quarterly results 2025', { ...HEADING, y: 1.6 });
slide.addText('Growth across every region', {
  x: 0.75,
  y: 2.5,
  w: 8.5,
  h: 0.6,
  fontSize: 21,
});
slide.addText('17 October 2025', {
  x: 0.75,
  y: 3.1,
  w: 8.5,
  h: 0.5,
  fontSize: 15,
  color: '555555',
});

slide = pptx.addSlide();
slide.addText('What we learned', HEADING);
slide.addText(
  [
    'Customers want faster onboarding',
    'Pricing is clear enough',
    'Support response times improved',
    'Mobile usage doubled',
  ].map((text) => ({ text, options: { bullet: true, breakLine: true } })),
  { x: 0.75, y: 1.5, w: 8.5, h: 2.5, valign: 'top', ...BODY },
);
slide.slideNumber = { x: 9.2, y: 5.2, w: 0.5, h: 0.3, fontSize: 10 };

slide = pptx.addSlide();
slide.addText('Our new office', HEADING);
slide.addText('The team moved into a brighter space in the city centre.', {
  x: 0.75,
  y: 1.5,
  w: 4.5,
  h: 1.2,
  valign: 'top',
  ...BODY,
});
slide.addImage({
  data: `image/jpeg;base64,${jpeg.toString('base64')}`,
  x: 5.75,
  y: 1.5,
  w: 3.5,
  h: 2.333,
  altText: 'Floor plan of the new office',
});

slide = pptx.addSlide();
slide.addText('Revenue by region', HEADING);
const header = { bold: true, fill: { color: 'E6E6E6' } };
slide.addTable(
  [
    [
      { text: 'Region', options: header },
      { text: 'Q3', options: header },
      { text: 'Q4', options: header },
    ],
    ['North', '1.2', '1.4'],
    ['South', '0.9', '1.1'],
    ['West', '1.5', '1.6'],
  ],
  { x: 0.75, y: 1.5, w: 6, colW: [3, 1.5, 1.5], ...BODY },
);

slide = pptx.addSlide();
slide.addText('Hidden draft', HEADING);
slide.hidden = true;

slide = pptx.addSlide();
slide.addText('Growth per quarter', HEADING);
slide.addChart(
  pptx.charts.BAR,
  [{ name: 'Revenue', labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [4, 6, 5, 8] }],
  { x: 0.75, y: 1.5, w: 8.5, h: 3.6 },
);

slide = pptx.addSlide();
slide.background = { color: '0B5ED7' };
slide.addText('Chapter two', {
  x: 0.75,
  y: 2.2,
  w: 8.5,
  h: 1.2,
  fontSize: 40,
  bold: true,
  color: 'FFFFFF',
});
slide.addText('Looking ahead', {
  x: 0.75,
  y: 3.3,
  w: 8.5,
  h: 0.6,
  fontSize: 20,
  color: 'FFFFFF',
});

const out = new URL('./slide-deck.pptx', import.meta.url);
await fs.writeFile(out, await pptx.write({ outputType: 'nodebuffer' }));
console.log(`wrote ${out.pathname}`);
