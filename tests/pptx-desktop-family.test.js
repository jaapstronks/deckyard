/**
 * B289 (D126) — an uploaded font family names the font as a desktop app knows
 * it, and the PPTX export writes that name instead of the CSS alias.
 *
 * The chain, end to end without a database:
 *
 *   1. `font_families.desktop_family` is stored for an uploaded family and
 *      refused for any other source, or for a value that is no font name.
 *   2. The theme carries it on the family's `embedFonts` entries.
 *   3. The template's layouts and document theme name it as `<a:latin>`; an
 *      uploaded family without one is written as Arial, a curated family as
 *      its own name.
 *
 * Run with: node --test tests/pptx-desktop-family.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.MULTI_ORG_ENABLED;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const repoRoot = process.cwd();

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { createFontFamily, updateFontFamily } =
  await import('../server/storage/font-families.js');
const { buildThemeConfig } = await import('../server/utils/theme-builder.js');
const { buildThemeTemplateBuffer, resolveThemeMaster } =
  await import('../server/export/pptx-theme.js');

const DESIGNER = {
  email: 'designer@example.com',
  name: 'Dana Designer',
  organizationId: ORG,
  isDesigner: true,
};
const scope = createStorageScope(DESIGNER, { repoRoot });

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'D', slug: 'd' }],
      font_families: [],
      font_variants: [],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test('an uploaded family stores its desktop name; an update can clear it', async () => {
  const created = await createFontFamily(scope, {
    name: 'GT America Extended',
    source: 'upload',
    desktopFamily: '  GT America LCG Ext Md ',
  });
  assert.equal(created.ok, true);
  assert.equal(created.fontFamily.desktopFamily, 'GT America LCG Ext Md');

  const id = created.fontFamily.id;
  const renamed = await updateFontFamily(scope, id, {
    desktopFamily: 'GT America LCG Ext Rg',
  });
  assert.equal(renamed.fontFamily.desktopFamily, 'GT America LCG Ext Rg');

  const cleared = await updateFontFamily(scope, id, { desktopFamily: null });
  assert.equal(cleared.fontFamily.desktopFamily, null);
});

test('a desktop name is refused, never repaired', async () => {
  const refused = { ok: false, reason: 'invalid', field: 'desktop_family' };

  // A hosted family's name is the vendor's own; there is no alias to correct.
  assert.deepEqual(
    await createFontFamily(scope, {
      name: 'Proxima Nova',
      source: 'adobe',
      desktopFamily: 'Proxima Nova',
    }),
    refused,
  );
  assert.deepEqual(
    await createFontFamily(scope, {
      name: 'Too Long',
      source: 'upload',
      desktopFamily: 'x'.repeat(256),
    }),
    refused,
  );
  assert.deepEqual(
    await createFontFamily(scope, {
      name: 'Control',
      source: 'upload',
      desktopFamily: 'Bad\nName',
    }),
    refused,
  );
  assert.deepEqual(
    await createFontFamily(scope, {
      name: 'Not A String',
      source: 'upload',
      desktopFamily: 42,
    }),
    refused,
  );

  const hosted = await createFontFamily(scope, {
    name: 'Hosted Sans',
    source: 'google',
  });
  assert.deepEqual(
    await updateFontFamily(scope, hosted.fontFamily.id, {
      desktopFamily: 'Hosted Sans',
    }),
    refused,
  );
});

/** A record theme whose heading is an uploaded family and body a curated one. */
function themeWithUploadedHeading(desktopFamily) {
  const familyId = '00000000-0000-4000-8000-0000000000f1';
  const family = {
    id: familyId,
    name: 'GT America Extended',
    source: 'upload',
    category: 'sans-serif',
    cssFallback: 'Arial, sans-serif',
    desktopFamily,
    variants: [
      {
        weight: 500,
        style: 'normal',
        format: 'woff2',
        url: '/fonts/managed/gt-america-extended-500.woff2',
      },
    ],
  };
  return buildThemeConfig(
    {
      id: '00000000-0000-4000-8000-0000000000ab',
      label: 'Desktop',
      colors: { primary: '#385c5c', background: '#ffffff' },
      fonts: {
        heading: family.name,
        headingFamilyId: familyId,
        body: 'Inter',
      },
    },
    { managedFonts: [family] },
  );
}

test("the theme carries the family's desktop name on its embedFonts", async () => {
  const theme = themeWithUploadedHeading('GT America LCG Ext Md');
  const entries = theme.embedFonts.filter(
    (f) => f.family === 'GT America Extended',
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].desktopFamily, 'GT America LCG Ext Md');

  const without = themeWithUploadedHeading(null);
  assert.equal(
    'desktopFamily' in
      without.embedFonts.find((f) => f.family === 'GT America Extended'),
    false,
  );
});

test('the template writes the desktop name, never the CSS alias', async () => {
  const theme = themeWithUploadedHeading('GT America LCG Ext Md');
  const zip = await JSZip.loadAsync(
    Buffer.from(await buildThemeTemplateBuffer(repoRoot, theme)),
  );
  const layouts = await Promise.all(
    Object.keys(zip.files)
      .filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f))
      .map((f) => zip.file(f).async('string')),
  );
  // pptxgenjs adds a `DEFAULT` layout of its own, with no placeholders.
  const themed = layouts.filter((xml) => !xml.includes('name="DEFAULT"'));
  assert.equal(themed.length, 3);
  for (const xml of themed) {
    assert.match(xml, /<a:latin typeface="GT America LCG Ext Md"/);
    assert.doesNotMatch(xml, /typeface="GT America Extended"/);
  }
  const themeXml = await zip.file('ppt/theme/theme1.xml').async('string');
  assert.match(
    themeXml,
    /<a:majorFont><a:latin typeface="GT America LCG Ext Md"\/>/,
  );
  // The sample slides name their own face too (B637), so the alias must not
  // reach them either.
  const slides = await Promise.all(
    Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .map((f) => zip.file(f).async('string')),
  );
  assert.ok(slides.length, 'the template carries sample slides');
  for (const xml of slides)
    assert.doesNotMatch(xml, /typeface="GT America Extended"/);
});

test('an uploaded family without a desktop name is written as Arial', async () => {
  const theme = themeWithUploadedHeading(null);
  const spec = resolveThemeMaster(theme);
  assert.equal(spec.headFont, 'Arial');
  // The body is a curated family: its CSS name is its desktop name.
  assert.equal(spec.bodyFont, 'Inter');
});

test('the typeface leaves the resolver attribute-safe', () => {
  const spec = resolveThemeMaster({
    cssVars: { '--t-font-heading': "'Acme', sans-serif" },
    embedFonts: [
      {
        family: 'Acme',
        url: '/fonts/managed/acme.woff2',
        desktopFamily: 'Acme "Pro" & Co',
      },
    ],
  });
  assert.equal(spec.headFont, 'Acme &quot;Pro&quot; &amp; Co');
});
