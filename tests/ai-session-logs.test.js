/**
 * Whether an instance writes AI session logs is one setting (B661).
 *
 * `AI_SESSION_LOGS` decides; unset, only a development checkout logs, so
 * production, CI and `npm test` leave `server/logs/ai/` alone. The routes and
 * generators carry no switch of their own: every caller gets a session
 * logger, and only the two writers ask whether the instance logs. The
 * end-to-end guard, convert and the Notion import writing nothing, is in
 * `tests/ai-paths-org-registry.test.js`.
 *
 * Run with: node --test tests/ai-session-logs.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aiSessionLogsEnabled,
  createSessionLogger,
  logDeckGenerationSession,
  logLlmConversation,
} from '../server/utils/ai/logging.js';

/** Run `fn` with the two env vars set as given (undefined unsets). */
function withEnv(t, env) {
  const saved = {};
  for (const [name, value] of Object.entries(env)) {
    saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

for (const [label, env, expected] of [
  ['development logs by default', { NODE_ENV: 'development' }, true],
  ['production does not log by default', { NODE_ENV: 'production' }, false],
  [
    'an unset NODE_ENV (the suite, CI) does not log',
    { NODE_ENV: undefined },
    false,
  ],
  [
    'AI_SESSION_LOGS=false silences development',
    { NODE_ENV: 'development', AI_SESSION_LOGS: 'false' },
    false,
  ],
  [
    'AI_SESSION_LOGS=true turns production on',
    { NODE_ENV: 'production', AI_SESSION_LOGS: 'true' },
    true,
  ],
  [
    'an unreadable value falls back to the default',
    { NODE_ENV: 'production', AI_SESSION_LOGS: 'maybe' },
    false,
  ],
]) {
  test(label, (t) => {
    withEnv(t, { AI_SESSION_LOGS: undefined, ...env });
    assert.equal(aiSessionLogsEnabled(), expected);
  });
}

test('the direct writers refuse when the instance does not log', (t) => {
  withEnv(t, { NODE_ENV: 'development', AI_SESSION_LOGS: 'false' });
  assert.equal(logLlmConversation({ phase: 'outline', sessionId: 's1' }), null);
  assert.equal(logDeckGenerationSession({ sessionId: 's1' }), null);
});

test('a session logger writes nothing when the instance does not log', (t) => {
  withEnv(t, { NODE_ENV: 'development', AI_SESSION_LOGS: 'false' });
  const logger = createSessionLogger('s1');
  logger.logPhase1({ systemPrompt: 'x' });
  logger.logPhase2Call({ systemPrompt: 'y' });
  assert.equal(logger.finalize({ slides: [] }), null);
});
