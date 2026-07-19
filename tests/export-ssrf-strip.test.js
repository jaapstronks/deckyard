import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSlidesPdfHtml } from '../server/export/pdf-slides.js';
import { embedImgSrcDataUrls } from '../server/utils/html-utils.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

/**
 * Security hardening 2 (acceptance): a slide whose image points at the cloud
 * metadata address must NOT survive into the export HTML handed to headless
 * Chrome, so Chrome never fetches it (SSRF).
 */
test('metadata-IP image src is stripped from PDF export HTML', async () => {
  const pres = {
    title: 'SSRF test',
    slides: [
      {
        id: 's1',
        type: 'image-slide',
        content: {
          title: 'Hello',
          image: 'http://169.254.169.254/latest/meta-data/iam/',
          alt: 'x',
        },
      },
    ],
  };

  const html = await buildSlidesPdfHtml(repoRoot, pres, {});
  assert.ok(
    !html.includes('169.254.169.254'),
    'export HTML must not reference the metadata IP'
  );
});

test('embedImgSrcDataUrls safety net strips a raw remote <img> metadata src', async () => {
  // Custom-HTML slide types can emit real <img> markup into the final HTML.
  // With embedRemote, a metadata-IP src must be removed so Chrome can't fetch.
  const html = '<div><img src="http://169.254.169.254/x.png" alt="a"></div>';
  const out = await embedImgSrcDataUrls('/repo', html, {
    includeClient: true,
    embedRemote: true,
  });
  assert.ok(!out.includes('169.254.169.254'), 'metadata src must be stripped');
});

test('embedImgSrcDataUrls without embedRemote leaves remote <img> untouched', async () => {
  const html = '<img src="https://cdn.example.com/logo.png">';
  const out = await embedImgSrcDataUrls('/repo', html, { includeClient: true });
  assert.equal(out, html);
});
