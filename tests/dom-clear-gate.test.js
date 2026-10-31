import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const paths = [
  'client/views/editor/clear-probe.js',
  'client/lib/dom/modal.js',
  'client/lib/dom/index.js',
  'client/views/editor/index.js',
];

for (const filePath of paths) {
  test(`DOM clearing gate applies to ${filePath}`, async () => {
    for (const code of [
      "el.innerHTML = '';",
      'el.innerHTML = "";',
      "el['innerHTML'] = '';",
      'el["innerHTML"] = "";',
    ]) {
      const [result] = await eslint.lintText(code, { filePath });
      const messages = result.messages.filter((m) =>
        m.message.startsWith('Clear DOM nodes with replaceChildren()'),
      );
      assert.equal(messages.length, 1, code);
      assert.equal(messages[0].severity, 2);
    }
    for (const code of [
      'el.replaceChildren();',
      "el.innerHTML = '<svg></svg>';",
      "el.innerHTML === '';",
      "el.textContent = '';",
      "el.otherHTML = '';",
      "// el.innerHTML = '';",
      'el.innerHTML = html;',
    ]) {
      const [result] = await eslint.lintText(code, { filePath });
      assert.equal(
        result.messages.filter((m) =>
          m.message.startsWith('Clear DOM nodes with replaceChildren()'),
        ).length,
        0,
        code,
      );
    }
  });
}
