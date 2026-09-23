/**
 * The refusal behind the sandbox's "no sharing between guests" declaration
 * (D181, `sharingEnabled()` in `server/config/sandbox.js`).
 *
 * Every route that would let one person put work in front of another — open a
 * deck to the organization, invite a collaborator, transfer ownership, write to
 * the organization shelf — calls {@link assertSharingEnabled} before it does anything.
 * User search is the one path that answers with an empty list instead of a
 * refusal: there is nobody to find, which is not an error.
 *
 * On the wire this is the plain 403 `forbidden`: a feature switched off for
 * the instance is a permission refusal, one code per meaning
 * (docs/reference/api-error-format.md § 401 vs 403), the same answer the
 * sandbox gives to publishing. The class exists so the refusal has one
 * message and one place, not so it can carry a second code.
 *
 * @module server/sandbox/sharing
 */

import { ForbiddenError } from '../utils/errors.js';
import { sharingEnabled } from '../config/sandbox.js';

/** The message of every sharing refusal. */
export const SHARING_DISABLED_MESSAGE =
  'Sharing between people is off in the sandbox';

/** A sharing action on an instance that declares sharing off. HTTP 403. */
export class SharingDisabledError extends ForbiddenError {
  constructor() {
    super(SHARING_DISABLED_MESSAGE);
  }
}

/**
 * Refuse a sharing action where the instance declares sharing off.
 * @returns {void}
 * @throws {SharingDisabledError}
 */
export function assertSharingEnabled() {
  if (!sharingEnabled()) throw new SharingDisabledError();
}
