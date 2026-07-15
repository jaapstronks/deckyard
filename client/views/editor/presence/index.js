/**
 * Editor presence bootstrap (feature-flagged: features.collab).
 *
 * This module — and through it the vendored yjs/hocuspocus bundle — is only
 * ever loaded via dynamic import from the editor controller when the collab
 * feature flag is on, so flag-off sessions pay nothing.
 */

import { createPresenceSession } from '../../../lib/collab/presence-session.js';
import { createPresenceUI } from './presence-ui.js';

/**
 * Start a presence session + UI for the open editor.
 *
 * @param {Object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Object} opts.pres - presentation (needs .id)
 * @param {{ email: string, name?: string }} opts.user - current user
 * @param {HTMLElement} opts.topbarEl
 * @param {HTMLElement} opts.listEl - slide list container
 * @param {HTMLElement} opts.thumb - preview slide container
 * @param {Function} opts.getSelectedSlideId
 * @returns {{ setViewSlide: Function, destroy: Function }}
 */
export function initEditorPresence({
  h,
  pres,
  user,
  topbarEl,
  listEl,
  thumb,
  getSelectedSlideId,
}) {
  const session = createPresenceSession({
    presentationId: pres.id,
    user,
  });

  const ui = createPresenceUI({
    h,
    session,
    topbarEl,
    listEl,
    thumb,
    getSelectedSlideId,
  });

  return {
    setViewSlide: (slideId) => session.setViewSlide(slideId),
    /** The underlying session — phase 2's live-edits binder shares its provider/doc. */
    session,
    destroy() {
      ui.destroy();
      session.destroy();
    },
  };
}
