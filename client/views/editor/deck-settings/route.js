import {
  claimQuery,
  historyBack,
  pushQueryParams,
  queryParam,
  setQueryParams,
} from '../../../lib/state/router.js';
import { resolveDeckSettingsSection } from './index.js';

/**
 * The address of the deck settings pane (B804):
 * `/app/:id?panel=settings&section=<key>`.
 *
 * - Opening pushes a history entry, so Back closes the pane again and
 *   Forward reopens it; switching sections replaces the entry (Back does not
 *   walk through every section looked at).
 * - A reload or a shared link opens the pane on the section it names. An
 *   unknown section, or one this installation does not show, is corrected to
 *   the first section in place.
 * - Back, Forward and closing keep the rest of the editor where it is: the
 *   router keeps the editor mounted for these keys, and keeps `slideId` and
 *   `lang` at what the editor shows (`claimQuery`). Only `panel` and
 *   `section` are ever written or removed here.
 */
export const DECK_SETTINGS_PANEL = 'settings';

/**
 * @param {object} options
 * @param {(section: string) => string} options.show - put the pane on screen
 *   on this section; returns the section shown
 * @param {() => void} options.hide - take the pane off screen
 * @param {() => void} [options.focus] - move focus into the pane
 * @param {() => boolean} [options.containsFocus] - focus is in the pane; only
 *   then does closing hand it back to the opener
 * @returns {{ open: Function, select: Function, close: Function, isOpen: Function, detach: Function }}
 */
/**
 * Where focus returns on close. An item in a dropdown menu (the ⋯ menu's
 * Settings) is gone once the menu folds, so the menu's trigger stands in.
 * @param {Element|null} el
 * @returns {Element|null}
 */
function openerOf(el) {
  return el?.closest?.('details')?.querySelector(':scope > summary') || el;
}

export function attachDeckSettingsRoute({ show, hide, focus, containsFocus }) {
  let open = false;
  /** The open pane's history entry was pushed in this document. */
  let ownEntry = false;
  /** Where focus goes back to when the pane closes. */
  let opener = null;

  const restoreFocus = () => {
    const target = opener;
    opener = null;
    if (target?.isConnected) target.focus?.({ preventScroll: true });
  };

  /** Show `section`, and write the corrected key if the URL named another. */
  const display = (section) => {
    const shown = show(section);
    open = true;
    if (queryParam('section') !== shown) setQueryParams({ section: shown });
    return shown;
  };

  const takeDown = () => {
    if (!open) return;
    open = false;
    const hadFocus = containsFocus?.() ?? true;
    hide();
    if (hadFocus) restoreFocus();
    else opener = null;
  };

  const onStep = ({ panel, section }) => {
    if (panel === DECK_SETTINGS_PANEL) {
      ownEntry = true;
      display(section);
      return;
    }
    ownEntry = false;
    takeDown();
  };

  const release = claimQuery({
    navigable: ['panel', 'section'],
    sticky: ['slideId', 'lang'],
    onStep,
  });

  if (queryParam('panel') === DECK_SETTINGS_PANEL) {
    display(queryParam('section'));
  }

  return {
    /**
     * Open the pane (or move it to `section` when it is open already).
     * @param {string} [section]
     */
    open: (section) => {
      if (open) {
        display(resolveDeckSettingsSection(section || queryParam('section')));
        focus?.();
        return;
      }
      opener = openerOf(document.activeElement);
      const resolved = resolveDeckSettingsSection(section);
      pushQueryParams({ panel: DECK_SETTINGS_PANEL, section: resolved });
      ownEntry = true;
      display(resolved);
      focus?.();
    },
    /** @param {string} section */
    select: (section) => {
      if (open) display(section);
    },
    /**
     * Close the pane. With its own entry on top this is a Back, so the next
     * Back does not land on the same editor once more; otherwise (opened by
     * reload or link) the keys are removed in place.
     */
    close: () => {
      if (!open) return;
      takeDown();
      if (ownEntry) {
        ownEntry = false;
        historyBack();
      } else {
        setQueryParams({ panel: null, section: null });
      }
    },
    isOpen: () => open,
    detach: () => {
      release();
      open = false;
      opener = null;
    },
  };
}
