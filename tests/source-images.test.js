/**
 * Images from a source document are candidates the model places (B775).
 *
 * A PDF's pictures never reached the model, a Word document's fell away
 * with its HTML, and a Notion page put every image but the first at the end
 * of the deck ("for now"). Now each source marks its pictures where they
 * stand (`[IMAGE n: …]`), the outline ties an image to a slide, phase 2
 * writes `source-image:n` in an image field, and `generateSlides()` uploads
 * only what a slide uses. Pinned here:
 *
 *   - the resolver uploads a chosen image once, never an unchosen one, and
 *     empties an unknown reference with an `_aiWarnings` line;
 *   - a PDF keeps its photos as figures and leaves icons, letterhead logos,
 *     backgrounds and running logos out; a Word document keeps its pictures;
 *   - the outline keeps only images the source has, each on one slide, and
 *     the prompts speak of images only when there are any;
 *   - end to end, a PDF and a Notion page with three images each give a deck
 *     with the chosen image on its slide and the others never uploaded.
 *
 * The model (and the Notion API) answer through a `globalThis.fetch` stub;
 * uploads go to the local media provider in a temp dir. No network.
 *
 * Run with: node --test tests/source-images.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';

for (const key of Object.keys(process.env)) {
  if (key.startsWith('IMAGEKIT_')) delete process.env[key];
}
process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
process.env.NOTION_SECRET = 'test-notion-secret';

const { resolveSourceImages, sourceImageMarker, uploadOnce } =
  await import('../server/utils/ai/source-images.js');
const { documentFigures } =
  await import('../server/utils/pdf-extract/index.js');
const { readPdf } = await import('../server/utils/convert-file/pdf-reader.js');
const { parseDocx } =
  await import('../server/utils/convert-file/docx-parser.js');
const { normalizeAnalysis, normalizeStructure } =
  await import('../server/utils/ai/generate-outline.js');
const { prompts } = await import('../server/utils/ai/prompts/index.js');
const { convertFile } = await import('../server/utils/convert-file/index.js');
const { convertNotionPage } = await import('../server/utils/convert-notion.js');
const { initializeMediaProvider } = await import('../server/media/index.js');
const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');

const FIXTURE = path.join(
  import.meta.dirname,
  'fixtures',
  'report-with-images.pdf',
);

let tmpRoot;
test.before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'b775-media-'));
  await initializeMediaProvider(tmpRoot);
});
test.after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** The files the local media provider holds. */
async function uploadedFiles() {
  const dir = path.join(tmpRoot, 'server', 'uploads');
  const files = await fs.readdir(dir, { recursive: true }).catch(() => []);
  const out = [];
  for (const f of files) {
    if ((await fs.stat(path.join(dir, f))).isFile()) out.push(f);
  }
  return out;
}

async function clearUploads() {
  await fs.rm(path.join(tmpRoot, 'server', 'uploads'), {
    recursive: true,
    force: true,
  });
}

// ── The resolver ──────────────────────────────────────────────────────────

function candidates(count, uploads) {
  return Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    caption: `image ${i + 1}`,
    upload: uploadOnce(async () => {
      uploads.push(i + 1);
      return `/uploads/img-${i + 1}.png`;
    }),
  }));
}

test('only the chosen image is uploaded, once, however many slides use it', async () => {
  const uploads = [];
  const slides = [
    { content: { image: 'source-image:2', alt: 'Two' } },
    { content: { items: [{ image: 'source-image:2' }] } },
    { content: { title: 'No image' } },
  ];
  const { used } = await resolveSourceImages(slides, candidates(3, uploads));
  assert.deepEqual(uploads, [2]);
  assert.deepEqual(used, [2]);
  assert.equal(slides[0].content.image, '/uploads/img-2.png');
  assert.equal(slides[1].content.items[0].image, '/uploads/img-2.png');
  assert.equal(
    slides.some((s) => s._aiWarnings),
    false,
  );
});

test('an unknown source-image:N is emptied with an _aiWarnings line', async () => {
  const uploads = [];
  const slides = [
    {
      content: { image: 'source-image:9', title: 'source-image:9 in prose' },
      _aiWarnings: ['earlier warning'],
    },
  ];
  await resolveSourceImages(slides, candidates(3, uploads));
  assert.deepEqual(uploads, []);
  assert.equal(slides[0].content.image, '');
  assert.equal(slides[0].content.title, 'source-image:9 in prose');
  assert.equal(slides[0]._aiWarnings.length, 2);
  assert.match(slides[0]._aiWarnings[1], /source image 9/);
});

test('a failed upload empties the field with a warning; an abort propagates', async () => {
  const failing = [
    { n: 1, upload: async () => Promise.reject(new Error('disk full')) },
  ];
  const slides = [{ content: { image: 'source-image:1' } }];
  await resolveSourceImages(slides, failing);
  assert.equal(slides[0].content.image, '');
  assert.match(slides[0]._aiWarnings[0], /could not be uploaded/);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    resolveSourceImages(
      [{ content: { image: 'source-image:1' } }],
      candidates(1, []),
      { signal: controller.signal },
    ),
  );
});

test('the marker names the number, caption, page and size', () => {
  assert.equal(
    sourceImageMarker({
      n: 3,
      caption: 'A barn',
      page: 2,
      pixels: { width: 1200, height: 800 },
    }),
    '[IMAGE 3: A barn, page 2, 1200×800]',
  );
  assert.equal(sourceImageMarker({ n: 1 }), '[IMAGE 1: no caption]');
});

// ── The sources ───────────────────────────────────────────────────────────

/** A page model with the given images and one line of text. */
function pageModel(page, images) {
  return {
    page,
    width: 600,
    height: 800,
    lines: [{ text: 'Body', y: 400 }],
    images: images.map(([x, y, w, h, png]) => ({
      box: { x, y, width: w, height: h },
      png: Buffer.from(png),
      pixels: { width: w * 2, height: h * 2 },
    })),
  };
}

test('a PDF keeps its photos and leaves page design out', () => {
  const figures = documentFigures([
    pageModel(1, [
      [400, 10, 150, 80, 'letterhead'], // small, in the top band
      [50, 300, 300, 200, 'photo-a'],
      [10, 700, 20, 20, 'icon'], // under 1% of the page
    ]),
    pageModel(2, [
      [0, 0, 600, 800, 'background'], // behind the text
      [50, 500, 300, 200, 'running'],
      [50, 200, 300, 200, 'photo-b'],
    ]),
    pageModel(3, [[50, 500, 300, 200, 'running']]), // on two pages
  ]);
  assert.deepEqual(
    figures.map((f) => [f.n, f.page, f.png.toString()]),
    [
      [1, 1, 'photo-a'],
      [2, 2, 'photo-b'],
    ],
  );
});

test('a report PDF marks its three photos where they stand, the logo not', async () => {
  const pdf = await readPdf(await fs.readFile(FIXTURE));
  assert.equal(pdf.shape, 'document');
  assert.deepEqual(
    pdf.figures.map((f) => [f.n, f.page, f.alt]),
    [
      [1, 1, 'Members picking apples in the north orchard'],
      [2, 2, 'The new barn seen from the road'],
      [3, 3, 'Map of the planned extension'],
    ],
  );
  const markers = pdf.document.match(/\[IMAGE \d+:[^\]]*\]/g);
  assert.deepEqual(markers, [
    '[IMAGE 1: Members picking apples in the north orchard, page 1, 480×300]',
    '[IMAGE 2: The new barn seen from the road, page 2, 480×300]',
    '[IMAGE 3: Map of the planned extension, page 3, 480×300]',
  ]);
  // Each photo stands in its own section, before the next heading.
  assert.ok(
    pdf.document.indexOf('[IMAGE 1:') < pdf.document.indexOf('## New barn'),
  );
  assert.ok(
    pdf.document.indexOf('## New barn') < pdf.document.indexOf('[IMAGE 2:'),
  );
});

/** A Word document with a heading, text and one picture with alt text. */
async function docxWithImage() {
  const png = await sharp({
    create: { width: 300, height: 200, channels: 3, background: '#c33' },
  })
    .png()
    .toBuffer();
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
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
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`,
  );
  zip.file('word/media/image1.png', png);
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>The new barn</w:t></w:r></w:p>
    <w:p><w:r><w:t>We built a barn this year.</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:inline>
      <wp:extent cx="2857500" cy="1905000"/>
      <wp:docPr id="1" name="Picture 1" descr="The barn from the road"/>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic>
      </a:graphicData></a:graphic>
    </wp:inline></w:drawing></w:r></w:p>
    <w:p><w:r><w:t>It holds the harvest.</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), png };
}

test('a Word document marks its picture where it stands', async () => {
  const { buffer, png } = await docxWithImage();
  const docx = await parseDocx(buffer);
  assert.equal(docx.figures.length, 1);
  assert.equal(docx.figures[0].caption, 'The barn from the road');
  assert.deepEqual(docx.figures[0].pixels, { width: 300, height: 200 });
  assert.ok(docx.figures[0].buffer.equals(png));
  const text = docx.slides.map((s) => s.textContent).join('\n');
  assert.match(
    text,
    /We built a barn this year\.\s+\[IMAGE 1: The barn from the road, 300×200\]\s+It holds the harvest\./,
  );
});

// ── The outline and the prompts ───────────────────────────────────────────

const IMAGES = [
  { n: 1, caption: 'Apples', upload: async () => '' },
  { n: 2, caption: 'Barn', upload: async () => '' },
];

test('the outline keeps only known images, each on one content slide', () => {
  const analysis = normalizeAnalysis(
    {
      title: 'Report',
      sections: [
        { heading: 'Harvest', keyPoints: ['a'], images: [1, 7, 1] },
        { heading: 'Barn', keyPoints: ['b'], images: [2] },
      ],
    },
    { sourceImages: IMAGES },
  );
  assert.deepEqual(
    analysis.sections.map((s) => s.images.map((i) => i.n)),
    [[1], [2]],
  );
  const slides = normalizeStructure(
    {
      slides: [
        { intent: 'content', section: 0, roughContent: 'x', image: 1 },
        { intent: 'content', section: 0, roughContent: 'y', image: 1 },
        { intent: 'chapter', section: 1, roughContent: 'Barn', image: 2 },
        { intent: 'content', section: 1, roughContent: 'z', image: 5 },
      ],
    },
    analysis,
  );
  assert.deepEqual(
    slides.map((s) => s.sourceImage?.n ?? null),
    [1, null, null, null],
  );
  assert.equal(slides[0].sourceImage.description, 'Apples');
});

test('the prompts speak of images only when the source has them', () => {
  const plain = prompts.buildAnalysisUserPrompt({ rawContent: 'Text' });
  const withImages = prompts.buildAnalysisUserPrompt({
    rawContent: 'Text [IMAGE 1: Apples]',
    sourceImages: IMAGES,
  });
  assert.doesNotMatch(plain, /SOURCE IMAGES/);
  assert.match(withImages, /SOURCE IMAGES/);

  const section = { heading: 'H', importance: 'high', keyPoints: ['p'] };
  const structure = (images) =>
    prompts.buildStructureUserPrompt({
      analysis: {
        title: 'T',
        sections: [{ ...section, quotes: [], images }],
      },
    });
  assert.doesNotMatch(structure([]), /IMAGE/);
  assert.match(structure([{ n: 2, description: 'Barn' }]), /IMAGE 2: Barn/);

  const phase2 = (sourceImage) =>
    prompts.buildPhase2UserPrompt({
      slides: [
        {
          index: 0,
          intent: 'content',
          hints: [],
          roughContent: 'Barn',
          ...(sourceImage ? { sourceImage } : {}),
        },
      ],
      groupId: 'g',
    });
  assert.doesNotMatch(phase2(null), /source-image/);
  assert.match(
    phase2({ n: 2, description: 'Barn' }),
    /source-image:2 \(Barn\)/,
  );
});

// ── End to end ────────────────────────────────────────────────────────────

/**
 * Answer the model: the analysis ties all three images to the one section,
 * the plan puts image 2 on the first slide, and phase 2 writes it there, plus
 * a second slide with a reference to an image the source does not have.
 * Returns the model request bodies.
 */
function stubModel(t, { notion = null } = {}) {
  const saved = globalThis.fetch;
  const bodies = [];
  const imageFetches = [];
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (notion && new URL(href).hostname === 'api.notion.com') {
      return notion(href);
    }
    if (notion && href.startsWith('https://8.8.8.8/')) {
      imageFetches.push(href);
      return new Response(Buffer.from('GIF89a\x01\x00\x01\x00'), {
        status: 200,
        headers: { 'Content-Type': 'image/gif' },
      });
    }
    const body = String(init?.body ?? '');
    bodies.push(body);
    const indexes = [...body.matchAll(/originalIndex: (\d+)\)/g)].map((m) =>
      Number(m[1]),
    );
    const answer = {
      title: 'Cooperative report',
      summary: 'What the cooperative did',
      sections: [
        {
          heading: 'The year',
          keyPoints: ['Harvest, barn, plan'],
          images: [1, 2, 3],
        },
      ],
      slides: [
        {
          intent: 'content',
          section: 0,
          roughContent: 'The new barn',
          image: 2,
          originalIndex: 0,
          type: 'image-text-slide',
          content: {
            title: 'The new barn',
            body: '- Built this year',
            image: 'source-image:2',
            alt: 'The barn',
          },
        },
        {
          intent: 'content',
          section: 0,
          roughContent: 'Next year',
          originalIndex: 1,
          type: 'image-text-slide',
          content: {
            title: 'Next year',
            body: '- Extend the orchard',
            image: 'source-image:9',
            alt: 'A map',
          },
        },
      ].filter(
        (slide) =>
          !body.includes('PRESENTATION CONTEXT') ||
          indexes.includes(slide.originalIndex),
      ),
    };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(answer) } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return { bodies, imageFetches };
}

/** The deck's slides that came from the model, in order. */
const modelSlides = (deck) =>
  deck.slides.filter((s) => s.type === 'image-text-slide');

test('a PDF with three images: the chosen one on its slide, the others never uploaded', async (t) => {
  await clearUploads();
  const { bodies } = stubModel(t);
  const { deck, report } = await convertFile(await fs.readFile(FIXTURE), {
    filename: 'report.pdf',
    lang: 'en-GB',
    slideTypes: SLIDE_TYPES,
  });
  assert.ok(deck, JSON.stringify(report.errors));

  const analysisCall = bodies.find((b) => b.includes('Analyse this source.'));
  assert.match(analysisCall, /\[IMAGE 3: Map of the planned extension/);
  assert.ok(bodies.some((b) => b.includes('source-image:2 (The new barn')));

  const [barn, plan] = modelSlides(deck);
  assert.match(barn.content.image, /^\/uploads\/.*report-image-2-.*\.png$/);
  assert.equal(plan.content.image, '');
  assert.ok(
    plan._aiWarnings.some((w) => /source image 9/.test(w)),
    JSON.stringify(plan._aiWarnings),
  );

  const files = await uploadedFiles();
  assert.equal(files.length, 1, `uploads: ${files.join(', ')}`);
  assert.deepEqual(deck._generationMeta.sourceImages, {
    offered: 3,
    used: [2],
  });
});

/** A Notion page: an intro, then three sections each with one image. */
function notionPage(href) {
  const json = (payload) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  if (!href.includes('/children')) {
    return json({
      id: '11111111222233334444555566667777',
      last_edited_time: '2026-10-01T00:00:00.000Z',
      properties: {
        title: { type: 'title', title: [{ plain_text: 'Cooperative' }] },
      },
    });
  }
  const text = (s) => ({ rich_text: [{ plain_text: s }] });
  const blocks = [
    { type: 'paragraph', paragraph: text('What the cooperative did.') },
  ];
  for (const [i, heading] of ['Harvest', 'Barn', 'Plan'].entries()) {
    blocks.push(
      { type: 'heading_2', heading_2: text(heading) },
      { type: 'paragraph', paragraph: text(`${heading} in a paragraph.`) },
      {
        type: 'image',
        image: {
          type: 'external',
          external: { url: `https://8.8.8.8/image-${i + 1}.gif` },
          caption: [{ plain_text: `${heading} photo` }],
        },
      },
    );
  }
  return json({
    results: blocks.map((b, i) => ({
      id: `block-${i}`,
      has_children: false,
      ...b,
    })),
    has_more: false,
    next_cursor: null,
  });
}

test('a Notion page with three images: the chosen one on its slide, nothing appended', async (t) => {
  await clearUploads();
  const { bodies, imageFetches } = stubModel(t, { notion: notionPage });
  const { deck, report } = await convertNotionPage(
    '11111111222233334444555566667777',
    { lang: 'en-GB', slideTypes: SLIDE_TYPES },
  );
  assert.ok(deck, JSON.stringify(report.errors));

  const analysisCall = bodies.find((b) => b.includes('Analyse this source.'));
  assert.match(analysisCall, /Barn in a paragraph\.\\n\[IMAGE 2: Barn photo\]/);

  assert.deepEqual(imageFetches, ['https://8.8.8.8/image-2.gif']);
  const [barn, plan] = modelSlides(deck);
  assert.match(barn.content.image, /^\/uploads\//);
  assert.equal(plan.content.image, '');
  assert.ok(plan._aiWarnings.some((w) => /source image 9/.test(w)));
  assert.equal(
    deck.slides.filter((s) => s.type === 'image-slide').length,
    0,
    'no image slides appended at the end',
  );
  assert.equal(deck.slides[0].content.background, 'lime');
  assert.equal((await uploadedFiles()).length, 1);
});
