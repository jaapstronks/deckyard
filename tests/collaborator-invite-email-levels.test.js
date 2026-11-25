/**
 * The collaborator invite names every level it can grant (DY-876).
 *
 * The invite mail had words for view, comment and edit only; an admin invite
 * fell back to "access" in the body and "view access" in the closing line, so
 * the mail promised less than was given. Each of the four levels now has its
 * own words, in English and Dutch, from one helper that the default template
 * and the custom-template variables share. An unknown level is refused rather
 * than dressed up as "view".
 *
 * Dutch puts the title before the verb ("om Q3 te bewerken"), in the HTML and
 * in the plain-text part alike (DY-877).
 *
 * Run with: node --test tests/collaborator-invite-email-levels.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTranslator } from '../server/i18n/index.js';
import {
  buildCollaboratorInviteEmail,
  collaboratorInviteWording,
} from '../server/integrations/email-templates/index.js';
import { ALL_PERMISSIONS } from '../shared/constants/permissions.js';

/** What each level's mail must say, per locale: body phrase, access line. */
const EXPECTED = {
  en: {
    view: [/invited you to view </, /You now have view access/],
    comment: [/to view and comment on </, /You now have commenting access/],
    edit: [/invited you to edit </, /You now have full editing access/],
    admin: [
      /invited you to edit and manage </,
      /You now have full editing and management access/,
    ],
  },
  nl: {
    view: [
      /uitgenodigd om <strong>Q3<\/strong> te bekijken\./,
      /Je hebt nu kijktoegang/,
    ],
    comment: [
      /uitgenodigd om <strong>Q3<\/strong> te bekijken en erop te reageren\./,
      /Je hebt nu reactietoegang/,
    ],
    edit: [
      /uitgenodigd om <strong>Q3<\/strong> te bewerken\./,
      /Je hebt nu volledige bewerkingstoegang/,
    ],
    admin: [
      /uitgenodigd om <strong>Q3<\/strong> te bewerken en te beheren\./,
      /Je hebt nu volledige bewerk- en beheertoegang/,
    ],
  },
};

function build(locale, permission) {
  return buildCollaboratorInviteEmail({
    tr: createTranslator(locale),
    name: 'Sarah',
    presTitle: 'Q3',
    inviter: 'Esther',
    permission,
    editUrl: 'https://deckyard.test/app/deck-1',
  });
}

for (const locale of Object.keys(EXPECTED)) {
  for (const permission of ALL_PERMISSIONS) {
    test(`${locale}: an invite as ${permission} says what it grants`, () => {
      const [bodyPattern, accessPattern] = EXPECTED[locale][permission];
      const { htmlContent, textContent } = build(locale, permission);
      assert.match(htmlContent, bodyPattern);
      assert.match(htmlContent, accessPattern);
      assert.match(textContent, accessPattern);
    });
  }
}

test('no level beyond view falls back to the view wording', () => {
  for (const locale of Object.keys(EXPECTED)) {
    const tr = createTranslator(locale);
    const view = collaboratorInviteWording(tr, 'view');
    for (const permission of ALL_PERMISSIONS.filter((p) => p !== 'view')) {
      const wording = collaboratorInviteWording(tr, permission);
      assert.notEqual(wording.accessLevel, view.accessLevel, permission);
      assert.notEqual(wording.permissionText, view.permissionText, permission);
    }
  }
});

test('nl: the plain-text part names the title before the verb', () => {
  for (const permission of ALL_PERMISSIONS) {
    const { textContent } = build('nl', permission);
    assert.match(textContent, /heeft je uitgenodigd om Q3 te /, permission);
  }
});

test('an unknown level is refused, not dressed up as view', () => {
  assert.throws(
    () => collaboratorInviteWording(createTranslator('en'), 'owner'),
    /Unknown collaborator permission/,
  );
});
