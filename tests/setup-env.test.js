import test from 'node:test';
import assert from 'node:assert/strict';

import { upsertEnv, generateSecret } from '../scripts/setup.js';

test('upsertEnv uncomments and sets a commented template line in place', () => {
  const example = ['# PORT=4177', '# DEFAULT_THEME=deckyard'].join('\n');
  const out = upsertEnv(example, { PORT: '5000' });
  assert.equal(out, ['PORT=5000', '# DEFAULT_THEME=deckyard'].join('\n'));
});

test('upsertEnv replaces an existing uncommented value', () => {
  const out = upsertEnv('PORT=4177\nAUTH_ENABLED=false', { PORT: '8080' });
  assert.equal(out, 'PORT=8080\nAUTH_ENABLED=false');
});

test('upsertEnv anchors keys exactly (OPENAI_API != OPENAI_COMPAT_API)', () => {
  const example = ['# OPENAI_API=sk-...', '# OPENAI_COMPAT_API='].join('\n');
  const out = upsertEnv(example, { OPENAI_API: 'sk-live' });
  assert.equal(out, ['OPENAI_API=sk-live', '# OPENAI_COMPAT_API='].join('\n'));
});

test('upsertEnv appends unknown keys under a footer', () => {
  const out = upsertEnv('PORT=4177', { NEW_KEY: 'x' });
  assert.match(out, /^PORT=4177\n\n# Added by scripts\/setup\.js\nNEW_KEY=x$/);
});

test('upsertEnv preserves unrelated lines and comments verbatim', () => {
  const src = ['# a comment', 'KEEP=1', '# PORT=4177'].join('\n');
  const out = upsertEnv(src, { PORT: '9000' });
  assert.equal(out, ['# a comment', 'KEEP=1', 'PORT=9000'].join('\n'));
});

test('upsertEnv only touches the first matching line for a key', () => {
  const src = ['# PORT=4177', 'PORT=5000'].join('\n');
  const out = upsertEnv(src, { PORT: '6000' });
  // First match (the commented template line) is rewritten; the later explicit
  // line is left as-is rather than producing two authoritative PORT lines here.
  assert.equal(out, ['PORT=6000', 'PORT=5000'].join('\n'));
});

test('generateSecret clears the 32-char boot floor and varies per call', () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.ok(a.length >= 32, `expected >= 32 chars, got ${a.length}`);
  assert.notEqual(a, b);
});
