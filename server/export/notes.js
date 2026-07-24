import JSZip from 'jszip';
import { SLIDE_TYPES } from '../../shared/slide-types.js';

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slideTitleCandidate(slide) {
  const c = slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const candidates = [
    c.title,
    c.heading,
    c.subheading,
    c.question,
    c.prompt,
    c.statement,
    c.quote,
  ]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  if (candidates.length) return candidates[0];
  return '';
}

function slideLabel(slide) {
  const def = SLIDE_TYPES?.[slide?.type];
  const label = typeof def?.label === 'string' ? def.label.trim() : '';
  return label || String(slide?.type || 'slide');
}

export function buildNotesMarkdown(pres, { includeEmpty = true } = {}) {
  const title = String(pres?.title || 'Presentation').trim();
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];

  const out = [];
  out.push(`# Speaker notes`);
  out.push('');
  out.push(`**Deck:** ${title}`);
  out.push(`**Slides:** ${slides.length}`);
  out.push('');

  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    const n = i + 1;
    const t = slideTitleCandidate(slide);
    const type = slideLabel(slide);
    const notes = typeof slide?.notes === 'string' ? slide.notes : '';
    const notesTrimmed = notes.trim();
    if (!includeEmpty && !notesTrimmed) continue;

    out.push(`## Slide ${n}${t ? ` — ${t}` : ''}`);
    out.push('');
    out.push(`- Type: \`${type}\``);
    out.push(`- Slide ID: \`${String(slide?.id || '')}\``);
    out.push('');
    if (notesTrimmed) out.push(notesTrimmed);
    else out.push('_No notes for this slide._');
    out.push('');
  }

  return out.join('\n');
}

function docxXmlFromPlainText(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const paras = lines
    .map((line) => {
      const t = escapeXml(line);
      // Preserve empty lines as empty paragraphs.
      return `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  mc:Ignorable="w14 wp14">
  <w:body>
    ${paras}
    <w:sectPr>
      <w:pgSz w:w="16838" w:h="11906"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

export async function buildNotesDocxBuffer(markdownText) {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.folder('_rels').file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  zip.folder('word').file(
    'document.xml',
    docxXmlFromPlainText(String(markdownText || ''))
  );

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return out;
}
