/**
 * Identity fields do not belong in a version snapshot (T10, PR D).
 *
 * A snapshot embeds the whole presentation object as one jsonb bag
 * (`presentation_versions.presentation_data`), and a presentation object
 * carries who owns it, who made it and who last touched it — see
 * `mapPresentationRow` in `server/storage/presentations/index.js`. Storing that copy per
 * snapshot has two consequences, and neither of them is wanted:
 *
 *  1. **Every historical copy stamps a person's e-mail.** A deck with fifty
 *     snapshots holds fifty copies of its owner's address, in a table nothing
 *     ever erases from. Identity should live in exactly one place per deck.
 *  2. **After an ownership transfer, every old snapshot names the previous
 *     owner.** The deck moved; its history did not. Any surface that read
 *     identity out of a snapshot would answer with someone who has not owned
 *     this deck for months.
 *
 * ## Restore re-derives identity from the living deck, it does not carry it
 *
 * The reason stripping is safe is that restore *already* ignores these fields.
 * Restoring a version is `updatePresentation(storageScope, id, snapshot, …)`, and that
 * write path consumes only `title`, `description`, `settings`, `i18n`,
 * `slides` and `published`; ownership moves solely through the transfer route's
 * `allowOwnerChange` opt-in, and `updated_by` comes from the acting user, not
 * from the body (`server/storage/presentations/index.js`). Restore
 * moves slides, never ownership — so the identity of a restored deck is the
 * living deck's, before and after this change. `tests/pg/version-snapshot-identity.pgtest.js`
 * pins that, including for the identity-bearing rows written before this PR.
 *
 * ## What is deliberately *not* stripped
 *
 *  - **`presentation_versions.created_by`** (and its paired
 *    `created_by_user_id`, migration 069) — a first-class column, not part of
 *    the embedded copy, holding who *took* the snapshot. The version list shows
 *    it ("Alice, 3 days ago"). It is dual-keyed in its own right (T10 PR F1)
 *    and stays put; only the embedded copy is stripped here.
 *  - **`organizationId`** — tenancy, not identity, and the restore write is
 *    org-scoped through the caller's own storageScope rather than through the body.
 *
 * @module storage/presentations/snapshot-identity
 */

/**
 * The identity fields a presentation object carries, as one list.
 *
 * Both halves of each dual key are named: dropping the e-mail and keeping the
 * id would leave a stable pointer to a person in every historical row, which is
 * the same problem one indirection further out.
 *
 * The list is a **superset** of what a presentation carries today: a field the
 * mapper has since retired must stay on it, because stored snapshots written
 * before the retirement still contain it. Stripping an absent key is a no-op,
 * so the cost of keeping one is nothing and the cost of dropping one is a
 * person's identity frozen into history.
 *
 * @type {readonly string[]}
 */
export const SNAPSHOT_IDENTITY_FIELDS = Object.freeze([
  'ownerId',
  'ownerEmail',
  'createdById',
  'createdBy',
  // `updatedBy` is a display pair `{ id, displayName }` since D22, so the id
  // half now travels inside it. `updatedById` is kept on the list as a
  // **retired field name**: decks snapshotted before D22 still carry it, and a
  // list that only covers today's shape would leave those rows stamped
  // forever — the exact defect this module exists to prevent.
  'updatedBy',
  'updatedById',
  'trashedBy',
  // `trashedBy` gained an id half in T10 PR F2 (migration 070). Like every
  // other dual key here, both halves are stripped — keeping the id would leave
  // a stable person-pointer in history.
  'trashedById',
]);

/**
 * Return a copy of a presentation object with its identity fields removed.
 *
 * Copies rather than mutates: callers hand in the live presentation object they
 * just read, which may be a cache entry and is often used again afterwards.
 *
 * @param {Object|null|undefined} pres - The presentation object to snapshot.
 * @returns {Object|null|undefined} A copy without identity fields, or the input
 *   unchanged when it is not an object.
 */
export function stripIdentityForSnapshot(pres) {
  if (!pres || typeof pres !== 'object') return pres;
  const copy = { ...pres };
  for (const field of SNAPSHOT_IDENTITY_FIELDS) delete copy[field];
  return copy;
}
