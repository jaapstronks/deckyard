import { buildStandaloneHtml } from './html.js';
import { buildPptxBuffer } from './pptx.js';
import { buildNotesDocxBuffer, buildNotesMarkdown } from './notes.js';
import { renderSlideToPngBuffer } from '../render/png.js';
import { renderSlidesToPdfBuffer } from '../render/pdf.js';
import { stripLiveOnlySlidesFromPresentation } from '../utils/public-output.js';

function safeScale(n) {
  const s = Number(n) || 2;
  return Math.max(1, Math.min(3, s));
}

async function loadJsZip() {
  const mod = await import('jszip');
  return mod?.default || mod;
}

function buildReadmeMd({
  title,
  slideCount,
  lang,
  scale,
  filenames,
}) {
  const lines = [];
  lines.push(`# Presentation handoff bundle`);
  lines.push('');
  lines.push(`- Title: **${title || 'Presentation'}**`);
  if (lang) lines.push(`- Language: **${lang}**`);
  lines.push(`- Slides: **${slideCount}**`);
  lines.push(`- PNG scale: **${scale}x**`);
  lines.push('');
  lines.push('## Contents');
  lines.push('');
  lines.push(`- **${filenames.pptx}**: PowerPoint (each slide is a PNG image inside PPTX).`);
  lines.push(`- **${filenames.pdf}**: PDF (one slide per page).`);
  lines.push(`- **${filenames.html}**: Standalone HTML viewer (offline, assets embedded).`);
  lines.push(`- **${filenames.pngDir}/**: Individual PNG slides.`);
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Bunny videos may be embedded as MP4 in PPTX (if BUNNY_PULLZONE is configured).');
  lines.push('- YouTube/Vimeo videos are exported as placeholders with instructions.');
  lines.push('- Video slides in PNG/PDF remain static placeholders.');
  lines.push('- If a conference system needs "native" editable PPTX elements, that is a separate (future) fidelity project.');
  lines.push('');
  return lines.join('\n');
}

export async function buildHandoffZipBuffer(
  repoRoot,
  pres,
  { theme = null, scale = 2, lang = '', slideTypes = null } = {}
) {
  const filteredPres = stripLiveOnlySlidesFromPresentation(pres);
  const slides = Array.isArray(filteredPres?.slides) ? filteredPres.slides : [];
  const s = safeScale(scale);

  const title = String(filteredPres?.title || 'presentation');
  const base = 'handoff';
  const filenames = {
    pptx: `${base}.pptx`,
    pdf: `${base}.pdf`,
    html: `${base}.html`,
    pngDir: 'png',
  };

  const JSZip = await loadJsZip();
  const zip = new JSZip();

  // Build core artifacts
  const notesMd = buildNotesMarkdown(filteredPres, { includeEmpty: true });
  const [pptxResult, pdfBuf, html, notesDocxBuf] = await Promise.all([
    buildPptxBuffer(repoRoot, filteredPres, { scale: s, theme, slideTypes }),
    renderSlidesToPdfBuffer(repoRoot, filteredPres, { theme, slideTypes }),
    buildStandaloneHtml(repoRoot, filteredPres, { theme, slideTypes }),
    buildNotesDocxBuffer(notesMd),
  ]);

  zip.file(filenames.pptx, pptxResult.buffer);
  zip.file(filenames.pdf, pdfBuf);
  zip.file(filenames.html, html);
  zip.file('notes.md', notesMd);
  zip.file('notes.docx', notesDocxBuf);

  const pngFolder = zip.folder(filenames.pngDir);
  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    const buf = await renderSlideToPngBuffer(repoRoot, slide, { scale: s, theme, slideTypes });
    const name = `slide-${String(i + 1).padStart(2, '0')}.png`;
    pngFolder.file(name, buf);
  }

  zip.file(
    'README.md',
    buildReadmeMd({
      title,
      slideCount: slides.length,
      lang: String(lang || ''),
      scale: s,
      filenames,
    })
  );

  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return out;
}
