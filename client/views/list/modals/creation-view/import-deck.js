/**
 * The `.deck` import in the creation view: pick a bundle, optionally install
 * the theme and slide types it carries, and land in the editor of the new deck.
 *
 * The bundle is posted as raw bytes to `POST /api/presentations/import/deck`
 * (docs/reference/deck-bundle-format.md § Import). What the import did with the
 * carried theme and slide types comes back as `bundledTheme` /
 * `bundledSlideTypes`; that outcome is not on screen once the editor opens, so
 * it is one passing message (`toast`). A bundle the server refuses is a state
 * of this form: an inline error at the file input, cleared at the next attempt
 * (docs/reference/feedback-surfaces.md).
 *
 * Installing is one choice, not two (D91: one rule for carried definitions),
 * and it is offered only to a user who may manage them — the same `canManage`
 * the route checks, which `/api/auth/me` reports as `isDesigner`.
 */

import { h } from '../../../../lib/dom.js';
import { t } from '../../../../lib/ui-i18n.js';
import { toast } from '../../../../lib/dom/toast.js';
import { createInlineError } from '../../../../lib/dom/inline-error.js';
import { nav } from '../../../../lib/state/router.js';
import { DECK_MIMETYPE } from '../../../../../shared/slide-types/deck-format-id.js';

/** What the install choice asks for (D90, D91). */
const INSTALL_ALL = 'theme,slideTypes';

let seq = 0;

/**
 * The labels of the carried definitions with a given status, quoted.
 * @param {Array<{label?: string, slug: string, status: string}>} items
 * @param {string} status
 * @returns {string}
 */
function labelsWith(items, status) {
  return items
    .filter((item) => item.status === status)
    .map((item) => `“${item.label || item.slug}”`)
    .join(', ');
}

/**
 * The passing message for what a `.deck` import did with what it carried, or
 * null when it carried nothing to report (the deck on screen says it all).
 *
 * @param {Object} created - The import response.
 * @param {{slug: string, label?: string, status: string, reason?: string,
 *   fontsMissing?: string[]}} [created.bundledTheme]
 * @param {Array<{slug: string, label?: string, status: string,
 *   reason?: string}>} [created.bundledSlideTypes]
 * @param {Array<{ref: string}>} [created.failedAssets]
 * @returns {{type: 'success'|'warning', message: string} | null}
 */
export function deckImportOutcome(created) {
  const theme = created?.bundledTheme || null;
  const types = Array.isArray(created?.bundledSlideTypes)
    ? created.bundledSlideTypes
    : [];
  const failed = Array.isArray(created?.failedAssets)
    ? created.failedAssets
    : [];
  const sentences = [];
  let warn = false;

  if (theme) {
    const name = `“${theme.label || theme.slug}”`;
    if (theme.status === 'installed') {
      sentences.push(
        t('list.deckImport.themeInstalled', 'Theme {name} installed.', {
          name,
        }),
      );
    } else if (theme.status === 'existing') {
      sentences.push(
        t(
          'list.deckImport.themeExisting',
          'Uses theme {name}, already in your workspace.',
          { name },
        ),
      );
    } else {
      warn = true;
      sentences.push(
        t(
          'list.deckImport.themeNotInstalled',
          'Theme {name} is in the file but not installed, so the deck uses the default theme.',
          { name },
        ),
      );
    }
    if (Array.isArray(theme.fontsMissing) && theme.fontsMissing.length) {
      warn = true;
      sentences.push(
        t(
          'list.deckImport.fontsMissing',
          'Not available here, so a default font is used: {fonts}.',
          { fonts: theme.fontsMissing.join(', ') },
        ),
      );
    }
  }

  const installed = labelsWith(types, 'installed');
  if (installed) {
    sentences.push(
      t('list.deckImport.typesInstalled', 'Slide types installed: {names}.', {
        names: installed,
      }),
    );
  }
  const existing = labelsWith(types, 'existing');
  if (existing) {
    sentences.push(
      t(
        'list.deckImport.typesExisting',
        'Slide types already in your workspace: {names}.',
        { names: existing },
      ),
    );
  }
  const notInstalled = labelsWith(types, 'not-installed');
  if (notInstalled) {
    warn = true;
    sentences.push(
      t(
        'list.deckImport.typesNotInstalled',
        'Slide types in the file but not installed, shown as placeholders: {names}.',
        { names: notInstalled },
      ),
    );
  }

  const notPermitted =
    theme?.reason === 'not-permitted' ||
    types.some((type) => type.reason === 'not-permitted');
  const notRequested =
    theme?.reason === 'install-not-requested' ||
    types.some((type) => type.reason === 'install-not-requested');
  if (notPermitted) {
    sentences.push(
      t(
        'list.deckImport.askDesigner',
        'A designer in your workspace can install them by importing the file again.',
      ),
    );
  } else if (notRequested) {
    sentences.push(
      t(
        'list.deckImport.importAgain',
        'Import the file again with the install option ticked to add them.',
      ),
    );
  }

  if (failed.length) {
    warn = true;
    sentences.push(
      t(
        'list.deckImport.assetsFailed',
        '{count} file(s) could not be imported.',
        { count: String(failed.length) },
      ),
    );
  }

  if (!sentences.length) return null;
  return { type: warn ? 'warning' : 'success', message: sentences.join(' ') };
}

/**
 * The `.deck` sub-panel of the Import method.
 *
 * @param {Object} opts
 * @param {boolean} opts.canInstall - Whether the user may install carried
 *   definitions (`isDesigner` from `/api/auth/me`, the route's `canManage`).
 * @returns {{
 *   el: HTMLElement,
 *   run: (commonOpts: {api: Function, close: Function,
 *     setBusy: Function, setStatus: Function}) => Promise<void>
 * }}
 */
export function createDeckImportPanel({ canInstall }) {
  const el = h('div', { class: 'creation-subpanel' });
  const fileInput = h('input', {
    type: 'file',
    accept: `.deck,${DECK_MIMETYPE}`,
    class: 'form-input',
    'aria-label': t('list.deckImport.fileLabel', '.deck file'),
  });
  const fileInfo = h('div', { class: 'help', text: '' });
  const error = createInlineError();
  let selectedFile = null;
  fileInput.addEventListener('change', () => {
    selectedFile = fileInput.files?.[0] || null;
    fileInfo.textContent = selectedFile ? selectedFile.name : '';
  });

  el.append(
    h('div', {
      class: 'help modal-hint',
      text: t(
        'list.deckImport.help',
        'Import a presentation from a .deck file: every language, notes, images, and the theme and slide types it uses.',
      ),
    }),
    fileInput,
    fileInfo,
    error.el,
  );

  let installBox = null;
  if (canInstall) {
    const hint = h('div', {
      class: 'help',
      id: `deck-install-hint-${++seq}`,
      text: t(
        'list.deckImport.installHint',
        'Adds them to your workspace for everyone. Nothing already there is overwritten.',
      ),
    });
    installBox = h('input', { type: 'checkbox', 'aria-describedby': hint.id });
    el.append(
      h('label', { class: 'row is-center gap-2' }, [
        installBox,
        h('span', {
          text: t(
            'list.deckImport.install',
            'Install the theme and slide types it carries',
          ),
        }),
      ]),
      hint,
    );
  }

  /**
   * Post the selected bundle and open the new deck.
   * @param {Object} commonOpts
   */
  async function run({ api, close, setBusy, setStatus }) {
    error.clear();
    if (!selectedFile) {
      error.show(
        t('list.deckImport.selectFirst', 'Select a .deck file first.'),
        { control: fileInput },
      );
      return;
    }
    setBusy(true);
    setStatus(t('list.newPresentation.importing', 'Importing…'));
    const query = installBox?.checked ? `?install=${INSTALL_ALL}` : '';
    try {
      const created = await api(`/api/presentations/import/deck${query}`, {
        method: 'POST',
        headers: { 'Content-Type': DECK_MIMETYPE },
        body: selectedFile,
      });
      const outcome = deckImportOutcome(created);
      close();
      nav(`/app/${created.id}?lang=${encodeURIComponent(created.lang)}`);
      if (outcome) toast[outcome.type](outcome.message);
    } catch (err) {
      setStatus('');
      setBusy(false);
      error.show(err.message, { control: fileInput });
    }
  }

  return { el, run };
}
