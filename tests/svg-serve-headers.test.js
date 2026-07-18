import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { serveFile } from '../server/utils/http.js';

/**
 * Security hardening 4: user-uploaded SVG must be served inert (CSP sandbox +
 * Content-Disposition: attachment) so embedded <script> can't execute in the
 * app origin, while inline <img> use (which ignores these headers) still works.
 */

function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(buf) {
      this.body = buf;
    },
  };
}

async function tmpFile(name, content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-svg-'));
  const p = path.join(dir, name);
  await fs.writeFile(p, content);
  return p;
}

test('user-uploaded SVG is served inert', async () => {
  const p = await tmpFile(
    'evil.svg',
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
  );
  const res = mockRes();
  await serveFile(res, p, { userUpload: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/svg+xml');
  assert.match(res.headers['Content-Security-Policy'], /sandbox/);
  assert.equal(res.headers['Content-Disposition'], 'attachment');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
});

test('non-SVG user upload keeps nosniff but no attachment/CSP', async () => {
  const p = await tmpFile('pic.png', 'x');
  const res = mockRes();
  await serveFile(res, p, { userUpload: true });
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['Content-Disposition'], undefined);
  assert.equal(res.headers['Content-Security-Policy'], undefined);
});

test('app-asset SVG (not user upload) is not force-downloaded', async () => {
  const p = await tmpFile('icon.svg', '<svg></svg>');
  const res = mockRes();
  await serveFile(res, p, { userUpload: false });
  assert.equal(res.headers['Content-Disposition'], undefined);
  assert.equal(res.headers['Content-Security-Policy'], undefined);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
});
