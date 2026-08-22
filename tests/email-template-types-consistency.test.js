/**
 * Guards the single canonical email-template type list.
 *
 * There used to be three lists that disagreed: the shared `TEMPLATE_TYPES`
 * (UI selector), the server `TEMPLATE_METADATA` (API validation + resolver),
 * and ad-hoc `templateType` strings in the senders. `leadNotification` (since
 * removed with lead capture) was in metadata but not the UI list
 * (admin-invisible), and `exportReady` was sent by a sender but existed in
 * neither list (a silently dead custom-template path). This test pins the
 * invariants that keep them from drifting apart:
 *
 *  1. `TEMPLATE_TYPES` is exactly `Object.keys(TEMPLATE_METADATA)` — one list,
 *     derived, not hand-maintained.
 *  2. every customizable type resolves to a non-empty subject with no DB
 *     (i.e. has a code default in the resolver's TEMPLATE_I18N_MAP). This is
 *     what `exportReady` lacked; it would fail here if re-added to metadata
 *     without wiring its defaults.
 *
 * Run with: node --test tests/email-template-types-consistency.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  TEMPLATE_TYPES,
  TEMPLATE_METADATA,
} from '../shared/constants/email-templates.js';
import { resolveTemplate } from '../server/integrations/email-template-resolver.js';

describe('email template types are one canonical list', () => {
  it('TEMPLATE_TYPES is derived from TEMPLATE_METADATA', () => {
    assert.deepStrictEqual(TEMPLATE_TYPES, Object.keys(TEMPLATE_METADATA));
  });

  it('every customizable type has a code default (non-empty subject) without a DB', async () => {
    for (const type of TEMPLATE_TYPES) {
      const resolved = await resolveTemplate(null, type, 'en');
      assert.ok(
        typeof resolved.fields.subject === 'string' &&
          resolved.fields.subject.length > 0,
        `template "${type}" resolves to an empty subject — missing a TEMPLATE_I18N_MAP default`,
      );
    }
  });
});
