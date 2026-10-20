import { createFakeDb } from './fake-db.js';
import { userRows, userIdFor } from './identity-fixtures.js';
import { brandSeedRow } from './theme-seed.js';
import { testScope } from './storage-scope.js';
import { __setTestDb } from '../../server/db/client.js';
import { initializeStorage } from '../../server/db/lifecycle.js';
import { createPresentation } from '../../server/storage/presentations/index.js';
import { invalidatePermission } from '../../server/storage/cache/permission-cache.js';
import { VISIBILITY_PRESETS } from '../../shared/slide-visibility.js';

export const READ_ORG = '00000000-0000-0000-0000-0000000000aa';
export const READ_EMAILS = Object.freeze({
  owner: 'read-owner@example.test',
  edit: 'read-editor@example.test',
  view: 'read-viewer@example.test',
  comment: 'read-commenter@example.test',
});
export const PRIVATE_MARKERS = [
  'PRIVATE-NOTE-B769',
  'PRIVATE-AI-B769',
  'HIDDEN-B769',
  'DE-ONLY-HIDDEN-B769',
];

/** Stored, unsanitized author material, including a third language-only secret. */
export async function seedViewerReadFixture(repoRoot = process.cwd()) {
  process.env.DEFAULT_ORGANIZATION_ID = READ_ORG;
  const db = createFakeDb({
    organizations: [
      { id: READ_ORG, name: 'Read boundary', slug: 'read-boundary' },
    ],
    themes: [await brandSeedRow()],
    users: userRows(...Object.values(READ_EMAILS)).map((row) => ({
      ...row,
      organization_id: READ_ORG,
    })),
    presentation_collaborators: [],
  });
  __setTestDb(db);
  await initializeStorage();
  const scope = { ...testScope(repoRoot), organizationId: READ_ORG };
  const created = await createPresentation(scope, {
    title: 'B769 synthetic read boundary',
    ownerEmail: READ_EMAILS.owner,
    theme: 'default',
    lang: 'nl',
    slides: [],
  });
  const slide = (id, title, visibility = {}) => ({
    id,
    parentId: null,
    type: 'content-slide',
    content: { title, body: 'Visible body' },
    visibility,
    notes: PRIVATE_MARKERS[0],
    _aiReasoning: PRIVATE_MARKERS[1],
    _aiAlternatives: [{ reason: PRIVATE_MARKERS[1] }],
    _aiWarnings: [PRIVATE_MARKERS[1]],
  });
  const slides = [
    slide('shown', 'VISIBLE-B769'),
    slide('hidden', PRIVATE_MARKERS[2], { hideFromViewers: true }),
    slide('target', 'TARGET-B769'),
    slide('draft', 'DRAFT-B769', VISIBILITY_PRESETS.draft),
    slide('published-only', 'PUBLISHED-FLAG-B769', { hideInPublished: true }),
    slide('export-only', 'EXPORT-FLAG-B769', { hideInExport: true }),
    slide('presentation-only', 'PRESENTATION-FLAG-B769', {
      hideInPresentation: true,
    }),
  ];
  slides[0].content.actions = [
    { label: 'Target', url: '#3' },
    { label: 'Hidden', url: '#2' },
  ];
  const versions = Object.fromEntries(
    ['nl', 'en-GB', 'de'].map((lang) => {
      const list = structuredClone(slides);
      list[0].content.title = `VISIBLE-B769 ${lang}`;
      if (lang === 'en-GB') {
        [list[1], list[2]] = [list[2], list[1]];
        list[0].content.actions[0].url = '#2';
        list[0].content.actions[1].url = '#3';
      }
      if (lang === 'de')
        list.push(
          slide('de-hidden', PRIVATE_MARKERS[3], { hideFromViewers: true }),
        );
      return [lang, { title: `Read boundary ${lang}`, slides: list }];
    }),
  );
  const row = db.__tables.presentations.find((row) => row.id === created.id);
  row.slides = versions.nl.slides;
  row.title = versions.nl.title;
  row.i18n = { dominant: 'nl', versions };
  for (const permission of ['edit', 'view', 'comment']) {
    const email = READ_EMAILS[permission];
    db.__tables.presentation_collaborators.push({
      id: `read-${permission}`,
      organization_id: READ_ORG,
      presentation_id: created.id,
      user_email: email,
      user_id: userIdFor(email),
      permission,
      invited_by: READ_EMAILS.owner,
      invited_at: '2026-10-20T00:00:00.000Z',
      accepted_at: null,
      revoked_at: null,
      revoked_by: null,
      revocation_message: null,
    });
    await invalidatePermission(created.id, email);
  }
  return { db, scope, deckId: created.id, row };
}
