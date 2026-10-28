/**
 * The installed shape of the operator runner: which systemd unit starts at
 * boot, and which host control modules the installation copies.
 *
 * The supervisor is the only unit with an `[Install]` section, so a host
 * reboot brings the runner back; the broker stays without one, because only
 * the supervisor may start it (`Restart=no`, no activation). And every
 * relative import of the installed runner code resolves inside what
 * `operator.js install` copies, so moving a module out of `runner/` cannot
 * leave the installation with a dangling import.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../server/render/renderer-bundle',
);
const RUNNER = path.join(BUNDLE, 'runner');
const unit = (name) => readFileSync(path.join(RUNNER, 'units', name), 'utf8');

/** `[Section]` → its `Key=value` lines, in order. */
function sections(text) {
  const out = {};
  let current = null;
  for (const line of text.split('\n')) {
    const header = /^\[(\w+)\]$/.exec(line);
    if (header) out[(current = header[1])] = [];
    else if (current && line.trim()) out[current].push(line.trim());
  }
  return out;
}

test('the supervisor starts at boot; the broker never starts on its own', () => {
  const supervisor = sections(unit('deckyard-render-supervisor.service'));
  assert.deepEqual(supervisor.Install, ['WantedBy=multi-user.target']);
  const broker = sections(unit('deckyard-render-broker.service'));
  assert.equal(broker.Install, undefined);
  assert.ok(broker.Service.includes('Restart=no'));
});

test('every relative import of the installed runner resolves inside the installation', () => {
  const operator = readFileSync(path.join(RUNNER, 'operator.js'), 'utf8');
  const list =
    /cpSync\(source, `\$\{code\}\/runner`[\s\S]*?for \(const name of \[([^\]]*)\]\)/.exec(
      operator,
    );
  assert.ok(list, 'operator.js names the sibling modules it installs');
  const siblings = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const installed = new Set([
    ...siblings.map((name) => path.join(BUNDLE, name)),
    ...readdirSync(RUNNER)
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(RUNNER, name)),
  ]);
  for (const file of installed) {
    assert.ok(existsSync(file), `${path.relative(BUNDLE, file)} exists`);
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(
      /(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g,
    )) {
      const target = path.resolve(path.dirname(file), specifier);
      assert.ok(
        installed.has(target),
        `${path.relative(BUNDLE, file)} imports ${specifier}, which the installation does not copy`,
      );
    }
  }
});
