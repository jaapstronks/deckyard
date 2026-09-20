/**
 * Who may insert a slide type, and where that answer is allowed to live.
 *
 * `follow-invite-slide` carried two answers to one question (B368). Its
 * definition claimed "the app inserts and maintains this slide itself, right
 * after the title slide… The editor's picker disables insertion for the same
 * reason", while `isInsertableSlideType()` had no rule against it, the type
 * picker offered it on the Interaction shelf, and the server said the
 * opposite in its own words ("Does NOT auto-insert a slide if missing – users
 * add it manually", server/storage/presentations/i18n.js). The prose was the
 * part that was wrong: nothing places an invite automatically, and a deck
 * without interactive slides can still want one for follow mode and Q&A.
 *
 * Two halves, so it cannot drift back:
 *
 * 1. The contract itself — agent opt-out is not an insertion ban.
 * 2. The form — a type definition does not carry a second answer about the
 *    editor's insertion gate. A type that really is uninsertable declares it
 *    in shared/slide-types/policy.js, next to `custom-html-slide` and
 *    `deprecated`; prose beside `ai:` is not a gate and cannot be executed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { isInsertableSlideType } from '../shared/slide-types/policy.js';
import { isAgentOptOut } from '../server/utils/ai/slide-catalog/agent-catalog.js';
import { PICKER_GROUP_ORDER } from '../client/views/editor/slide-type-picker/data.js';

const TYPES_DIR = fileURLToPath(
  new URL('../shared/slide-types/types/', import.meta.url),
);

test('the follow-along invite is withheld from agents and offered to people', () => {
  const type = 'follow-invite-slide';
  const def = SLIDE_TYPES[type];
  assert.ok(def, 'follow-invite-slide must be registered');

  assert.equal(
    isAgentOptOut(def),
    true,
    'an agent has no live session to invite anyone into',
  );
  assert.equal(
    isInsertableSlideType({ type, def }),
    true,
    'a person inserts the invite themselves; nothing places one automatically',
  );

  const shelved = Object.values(PICKER_GROUP_ORDER).flat().includes(type);
  assert.equal(
    shelved,
    true,
    'the type picker is the only way a deck gets an invite, so it must offer one',
  );
});

test('no slide-type definition claims the picker refuses it', () => {
  // Substance, not wording: a claim that the picker *refuses to insert*.
  // "one picker tile", "the alignment picker", "which shelf offers this type"
  // all describe the type and are fine — the gate is isInsertableSlideType(),
  // and only a claim about that gate belongs elsewhere. See the docstring.
  const REFUSAL =
    /\bpicker\b[^.]{0,60}\b(disabl|refus|block|prevent|forbid)\w*\s+(insert|add)/i;
  const REVERSED =
    /\b(disabl|refus|block|prevent|forbid)\w*\s+(insertion|inserting|adding)[^.]{0,60}\bpicker\b/i;

  const offenders = [];
  for (const entry of readdirSync(TYPES_DIR, { withFileTypes: true })) {
    const files = entry.isDirectory()
      ? readdirSync(path.join(TYPES_DIR, entry.name))
          .filter((f) => f.endsWith('.js'))
          .map((f) => path.join(entry.name, f))
      : entry.name.endsWith('.js')
        ? [entry.name]
        : [];
    for (const rel of files) {
      const src = readFileSync(path.join(TYPES_DIR, rel), 'utf8');
      if (REFUSAL.test(src) || REVERSED.test(src)) offenders.push(rel);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a type definition must not describe the editor as refusing to insert it — ' +
      'declare it in shared/slide-types/policy.js § isInsertableSlideType instead, ' +
      'where the picker, the slides panel and the theme preview all read it',
  );
});
