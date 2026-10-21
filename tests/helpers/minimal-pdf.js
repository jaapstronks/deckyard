/**
 * A hand-written, untagged PDF for tests that need a page shape the Chrome
 * fixture does not have, without a browser: text in Helvetica at given
 * positions, optionally a number of stroked paths (a stand-in for a
 * vector drawing) and pictures: one solid-colour RGB image, painted
 * into each given box (B831: a logo repeated on every page). Untagged, so `extractPdfPages()` reads it by geometry, the
 * way it reads a Keynote export.
 *
 * Text is Latin-1 in the standard WinAnsi encoding: write list markers as
 * `-`, not `•`.
 */

/**
 * @param {Array<{ texts?: Array<{ text: string, size: number, x: number, y: number, bold?: boolean }>, paths?: number, images?: Array<{ x: number, y: number, width: number, height: number }> }>} pages
 *   `y` is the baseline of a text and the top of an image box, from the top
 *   of the page, like the page model.
 * @param {{ width?: number, height?: number }} [size] - in pt; 16:9 by default
 * @returns {Buffer}
 */
export function minimalPdf(pages, { width = 720, height = 405 } = {}) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pageTree = add(null);
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const bold = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  );
  // 40×40 pixels of one colour (the extractor's least, `MIN_IMAGE_PIXELS`),
  // uncompressed: the same picture on every page.
  const pixels = Buffer.from('cc2233'.repeat(40 * 40), 'hex').toString(
    'latin1',
  );
  const picture = add(
    `<< /Type /XObject /Subtype /Image /Width 40 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`,
  );
  const kids = [];
  for (const page of pages) {
    const ops = (page.texts || []).map((t) => {
      const text = t.text.replace(/[\\()]/g, '\\$&');
      return `BT /${t.bold ? 'F2' : 'F1'} ${t.size} Tf ${t.x} ${height - t.y} Td (${text}) Tj ET`;
    });
    for (let i = 0; i < (page.paths || 0); i++) {
      const x = 400 + (i % 50) * 5;
      ops.push(`${x} ${50 + i} m ${x + 5} ${60 + i} l S`);
    }
    for (const img of page.images || []) {
      ops.push(
        `q ${img.width} 0 0 ${img.height} ${img.x} ${height - img.y - img.height} cm /Im1 Do Q`,
      );
    }
    const stream = ops.join('\n');
    const content = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
    kids.push(
      add(
        `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> /XObject << /Im1 ${picture} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = Buffer.byteLength(out, 'latin1');
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
