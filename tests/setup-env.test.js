import test from 'node:test';
import assert from 'node:assert/strict';

import {
  upsertEnv,
  generateSecret,
  parseFlags,
  flagUpdates,
  hasEnvValue,
  strayAiKeyWarnings,
} from '../scripts/setup.js';

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

test('parseFlags handles --flag=value, --flag value, and bare flags', () => {
  const flags = parseFlags(['--ai=claude', '--ai-key', 'sk-ant-x', '--yes', '--auth', 'on']);
  assert.deepEqual(flags, { ai: 'claude', 'ai-key': 'sk-ant-x', yes: 'true', auth: 'on' });
});

test('parseFlags does not swallow a following flag as a value', () => {
  assert.deepEqual(parseFlags(['--yes', '--ai=openai']), { yes: 'true', ai: 'openai' });
});

test('flagUpdates with no flags = safe local default (auth off, no AI)', () => {
  assert.deepEqual(flagUpdates({}), {
    PORT: '4177',
    AUTH_ENABLED: 'false',
    APP_URL: 'http://localhost:4177',
  });
});

test('flagUpdates defaults APP_URL to localhost with the chosen port (auth off)', () => {
  assert.equal(flagUpdates({ port: '5000' }).APP_URL, 'http://localhost:5000');
});

test('flagUpdates omits the localhost APP_URL default when auth is on', () => {
  assert.equal(flagUpdates({ auth: 'on' }).APP_URL, undefined);
});

test('flagUpdates honors an explicit --app-url over the localhost default', () => {
  assert.equal(
    flagUpdates({ 'app-url': 'https://slides.example.com' }).APP_URL,
    'https://slides.example.com',
  );
});

test('flagUpdates maps provider + key to the right env var', () => {
  const u = flagUpdates({ ai: 'claude', 'ai-key': 'sk-ant-x' });
  assert.equal(u.CLAUDE_API, 'sk-ant-x');
  assert.equal(u.AUTH_ENABLED, 'false');
});

test('flagUpdates --auth on generates a secret and omits AUTH_ENABLED', () => {
  const u = flagUpdates({ auth: 'on', 'admin-email': 'a@b.com' });
  assert.ok(u.AUTH_SECRET.length >= 32);
  assert.equal(u.AUTH_ADMIN_EMAIL, 'a@b.com');
  assert.equal(u.AUTH_ENABLED, undefined);
});

test('flagUpdates ignores a provider key without a value, and default theme', () => {
  const u = flagUpdates({ ai: 'openai', theme: 'deckyard' });
  assert.equal(u.OPENAI_API, undefined); // no --ai-key given
  assert.equal(u.DEFAULT_THEME, undefined); // default theme not written
});

test('strayAiKeyWarnings flags OPENAI_API_KEY when OPENAI_API is absent', () => {
  const warnings = strayAiKeyWarnings('OPENAI_API_KEY=sk-live\nPORT=4177');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /OPENAI_API_KEY/);
  assert.match(warnings[0], /OPENAI_API\b/);
});

test('strayAiKeyWarnings stays silent when the canonical name is present', () => {
  // User set both the stray and the canonical name — the app reads the
  // canonical one, so nothing is silently ignored.
  const warnings = strayAiKeyWarnings('OPENAI_API_KEY=sk-a\nOPENAI_API=sk-b');
  assert.deepEqual(warnings, []);
});

test('strayAiKeyWarnings flags ANTHROPIC_API_KEY -> CLAUDE_API', () => {
  const warnings = strayAiKeyWarnings('ANTHROPIC_API_KEY=sk-ant-xyz');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CLAUDE_API/);
});

test('strayAiKeyWarnings ignores commented and empty values', () => {
  assert.deepEqual(strayAiKeyWarnings('# OPENAI_API_KEY=sk-live'), []);
  assert.deepEqual(strayAiKeyWarnings('OPENAI_API_KEY='), []);
});

test('hasEnvValue only matches a non-empty uncommented assignment', () => {
  assert.equal(hasEnvValue('FOO=bar', 'FOO'), true);
  assert.equal(hasEnvValue('# FOO=bar', 'FOO'), false);
  assert.equal(hasEnvValue('FOO=', 'FOO'), false);
  assert.equal(hasEnvValue('FOOBAR=x', 'FOO'), false);
});
