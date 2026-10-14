/**
 * Executable probes for native dialogs and pure slide-type definitions.
 * Run with: node --test tests/convention-gates.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint();
async function restrictions(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-globals');
}

for (const name of ['confirm', 'prompt']) {
  for (const prefix of ['', 'window.', 'globalThis.']) {
    test(`native dialog ${prefix}${name} is refused`, async () => {
      assert.equal(
        (
          await restrictions(
            `export const f = () => ${prefix}${name}('Continue?');`,
            'client/views/gate-probe.js',
          )
        ).length,
        1,
      );
    });
  }
}

test('a local prompt and the modal helpers are allowed', async () => {
  assert.deepEqual(
    await restrictions(
      'export const f = (prompt, confirmModal, createTextInput) => [prompt(), confirmModal(), createTextInput()];',
      'client/views/gate-probe.js',
    ),
    [],
  );
});

for (const expression of [
  'document.body',
  'window.innerWidth',
  'fetch("/")',
  'setTimeout(() => {}, 1)',
  'globalThis.setInterval(() => {}, 1)',
  'new ResizeObserver(() => {})',
]) {
  test(`type modules refuse ${expression}`, async () => {
    assert.equal(
      (
        await restrictions(
          `export const render = () => ${expression};`,
          'shared/slide-types/types/gate-probe.js',
        )
      ).length,
      1,
    );
  });
}

test('pure rendering stays legal and client runtime keeps browser effects', async () => {
  assert.deepEqual(
    await restrictions(
      'export const render = (text) => `<p>${text}</p>`;',
      'shared/slide-types/types/gate-probe.js',
    ),
    [],
  );
  assert.deepEqual(
    await restrictions(
      'export const attach = () => setTimeout(() => document.body, 1);',
      'client/lib/slide-runtime/gate-probe.js',
    ),
    [],
  );
});
