/**
 * The email-template preview renders in a sandboxed frame, not in this
 * document (B154).
 *
 * `client/views/settings/email-templates/actions.js` used to do
 * `previewContent.innerHTML = resp.preview.htmlContent` — the one non-empty
 * `innerHTML` write in the client whose value was neither a static template,
 * `markdownToSafeHtml()` output, nor an escaping renderer. Two things were
 * wrong with it, and the second is the one that made the fix easy:
 *
 *  1. Admin-written markup with substituted fields, executing in the same
 *     origin as the session cookie. The old verdict (see the entry retired from
 *     tests/no-unsanitized-innerhtml.test.js) argued it was safe because writer
 *     and reader hold identical privilege. That is true and it is why this was
 *     never a privilege-escalation XSS — but it is an authorization claim, and
 *     it was the only one holding up an `innerHTML` site.
 *
 *  2. **It was not showing the email.** `buildPreviewHtml()` returns a whole
 *     document — `<!DOCTYPE html><html><head>…<body style="…">` — and the HTML
 *     parser discards that wrapper when it lands in a `<div>`, taking the
 *     `<body style>` that carries EMAIL_STYLES.body with it. What remained
 *     rendered under the settings page's own cascade.
 *
 * A `sandbox=""` iframe fed through `srcdoc` fixes both: the document renders
 * as the mail client will see it, in an opaque origin with no scripts, no
 * forms, no same-origin access and no top-level navigation.
 *
 * Run with: node --test tests/email-preview-sandboxed.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const VIEW_DIR = path.join(
  repoRoot,
  'client',
  'views',
  'settings',
  'email-templates',
);

/** @param {string} name @returns {string} */
function read(name) {
  return fs.readFileSync(path.join(VIEW_DIR, name), 'utf8');
}

test('the preview element is an iframe with every sandbox restriction on', () => {
  const src = read('index.js');
  const frame = src.match(/h\('iframe',\s*\{[^}]*\}/s);
  assert.ok(frame, 'the preview is built as an iframe');

  assert.match(
    frame[0],
    /sandbox:\s*''/,
    'sandbox must be the empty string — every restriction on. An `allow-*` ' +
      'token here is a security decision: `allow-scripts` alone lets the ' +
      'template run code, and `allow-scripts allow-same-origin` together let ' +
      'it remove its own sandbox.',
  );
  assert.match(frame[0], /referrerpolicy:\s*'no-referrer'/);
});

test('the preview is fed through srcdoc, never innerHTML', () => {
  const src = read('actions.js');
  assert.match(src, /previewFrame\.srcdoc = resp\.preview\.htmlContent/);
  assert.equal(
    /innerHTML/.test(src),
    false,
    'no innerHTML write may come back to this view',
  );
});

test('no email-templates file writes markup through innerHTML', () => {
  // `= ''` clears write no markup and are exempt everywhere (see
  // tests/no-unsanitized-innerhtml.test.js); anything else here is new.
  const offenders = [];
  for (const name of fs.readdirSync(VIEW_DIR)) {
    if (!name.endsWith('.js')) continue;
    read(name)
      .split('\n')
      .forEach((line, i) => {
        const m = line.match(/\binnerHTML\s*=\s*(.*)$/);
        if (!m) return;
        if (/^(''|"")\s*;?\s*$/.test(m[1].trim())) return;
        offenders.push(`${name}:${i + 1}  ${line.trim()}`);
      });
  }
  assert.deepEqual(
    offenders,
    [],
    'the email preview is the whole reason this directory had a markup-writing ' +
      'innerHTML site; a new one needs its own argument',
  );
});

test('the server still hands over a whole document, which is why a div was wrong', () => {
  // Pins the premise rather than the fix: if emailWrapper ever stops emitting a
  // full document, the "a div silently drops <body style>" argument above stops
  // being the reason, and this test should be re-read rather than deleted.
  const wrapper = fs.readFileSync(
    path.join(
      repoRoot,
      'server',
      'integrations',
      'email-templates',
      'helpers.js',
    ),
    'utf8',
  );
  assert.match(wrapper, /<!DOCTYPE html>/);
  assert.match(wrapper, /<body style="\$\{EMAIL_STYLES\.body\}">/);
});
