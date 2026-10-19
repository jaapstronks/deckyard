/**
 * A Word document keeps its outline on the way to the AI (B774).
 *
 * `parseDocx()` marks the text the way a report PDF is marked (B773): a
 * heading as `#` per level, a list item as `- ` or `1. `, nested items
 * indented. The fixture is built in the test: a docx is a zip of XML.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { parseDocx } from '../server/utils/convert-file/docx-parser.js';
import { formatSlidesForAi } from '../server/utils/convert-file/helpers.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** One paragraph, optionally styled or numbered (`[numId, level]`). */
function para(text, { style, list } = {}) {
  const props = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    list
      ? `<w:numPr><w:ilvl w:val="${list[1]}"/><w:numId w:val="${list[0]}"/></w:numPr>`
      : '',
  ].join('');
  const runs = Array.isArray(text) ? text : [text];
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs
    .map((r) =>
      typeof r === 'string'
        ? `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`
        : `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${r.bold}</w:t></w:r>`,
    )
    .join('')}</w:p>`;
}

/** A numbering part: numId 1 is bullets, numId 2 is decimal. */
const NUMBERING = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="${W}">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

/** A Word document with an h1, two h2's, a nested bullet list and steps. */
async function reportDocx() {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`,
  );
  zip.file('word/numbering.xml', NUMBERING);
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W}"><w:body>
  ${para('Annual report', { style: 'Heading1' })}
  ${para('The cooperative had a good year.')}
  ${para('Harvest', { style: 'Heading2' })}
  ${para(['We picked ', { bold: 'more apples' }, ' than ever.'])}
  ${para('Apples', { list: [1, 0] })}
  ${para('Cox', { list: [1, 1] })}
  ${para('Elstar', { list: [1, 1] })}
  ${para('Pears', { list: [1, 0] })}
  ${para('Plans', { style: 'Heading2' })}
  ${para('Build the barn', { list: [2, 0] })}
  ${para('Plant the orchard', { list: [2, 0] })}
</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('a Word document reaches the AI with its headings and lists', async () => {
  const docx = await parseDocx(await reportDocx());
  // mammoth warns that the fixture defines no styles; nothing failed.
  assert.ok(!docx.errors.some((e) => e.startsWith('Error')));
  const input = formatSlidesForAi(docx.slides, docx.metadata);

  for (const line of [
    '# Annual report',
    '## Harvest',
    '## Plans',
    '- Apples',
    '  - Cox',
    '  - Elstar',
    '- Pears',
    '1. Build the barn',
    '2. Plant the orchard',
  ]) {
    assert.ok(input.split('\n').includes(line), `missing line: ${line}`);
  }
  // A bold run stays inside its sentence; list items follow one another.
  assert.match(input, /^We picked more apples than ever\.$/m);
  assert.match(input, /^- Apples\n {2}- Cox\n {2}- Elstar\n- Pears$/m);
  // The title is the heading text, not its marker.
  assert.equal(docx.metadata.title, 'Annual report');
});
