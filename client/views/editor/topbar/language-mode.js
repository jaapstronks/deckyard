/**
 * The deck's language menu in the editor topbar.
 *
 * **One menu per deck, for every n** (D72 #1). The trigger names the language
 * being edited; opening it lists the versions this deck actually has — the
 * source version marked, every other one with its translation status — and,
 * under a separator, the workspace languages this deck has no version for yet.
 *
 * Choosing an existing version switches to it. Choosing one under "Add
 * language" is the same switch: the version is created on the spot
 * (structure-only, translatable fields empty) and the user lands in it
 * immediately. A non-blocking popover then offers to AI-translate the missing
 * texts - fields the user already filled in by hand are left alone (the
 * server's translate/missing endpoint only fills empty translatable fields).
 *
 * Under the list, on a version that is not the source, sits the one action that
 * moves the source: "Make this the source version" (B198). It is the only way
 * `i18n.dominant` moves - nothing else does it as a side effect (D74) - so a
 * deck begun in the wrong language can still say which version it is written
 * in.
 *
 * What it replaces is a fixed NL/EN segmented control, built on the assumption
 * that "the other language" is always nameable. It is not on the open deck-language
 * axis, which is why a German version used to be viewable but not editable (B182).
 */

import {
  getSupportedLangs,
  isSupportedLang,
} from '../../../lib/format/i18n.js';
import { getLangDisplayName } from '../../../lib/format/lang-selector.js';
import { confirmModal, createModal } from '../../../lib/dom/modal.js';
import { createDropdown } from '../../../lib/dom/dropdown.js';
import { makeDropdownCaret } from '../../../lib/dom/icons.js';
import { t } from '../../../lib/ui-i18n.js';
import { h } from '../../../lib/dom.js';
import {
  DEFAULT_DECK_LANG,
  translationSourceFor,
} from '../../../../shared/i18n-utils.js';
import {
  computeMissingTranslation,
  existingVersionLangs,
  pickVersion,
  translationProgress,
} from '../../../../shared/i18n-progress.js';
import { setQueryParams } from '../../../lib/state/router.js';

/**
 * Create the language menu component.
 *
 * @param {object} options
 * @param {HTMLElement} options.root - Root element for modals
 * @param {object} options.pres - Presentation object
 * @param {string} options.id - Presentation ID
 * @param {Function} options.api - API client
 * @param {Function} options.requestSave - Request save function
 * @param {Function} options.isDirty - Check if dirty
 * @param {Function} options.markDirty - Mark presentation dirty
 * @param {Function} options.normalizeLang - Normalize language code
 * @param {Function} options.getSelectedSlideId - Get selected slide ID
 * @param {Function} options.setSelectedSlideId - Set selected slide ID
 * @param {object} options.editorState - Editor state updater utility
 * @param {HTMLElement} options.topbarTitleEl - Title element to update
 * @param {Function} options.toast - Toast notifications
 * @returns {object} Language menu controller
 */
export function createLanguageMode({
  root,
  pres,
  id,
  api,
  requestSave,
  isDirty,
  markDirty,
  normalizeLang,
  getSelectedSlideId,
  setSelectedSlideId,
  editorState,
  topbarTitleEl,
  toast,
  // Live collaborative editing (collab fase 2): when set, language versions
  // are read from the live Y.Doc instead of the server JSON (which lags by
  // up to a persistence debounce window), and server translate responses are
  // pushed back into the doc so the next collab store can't overwrite them.
  // `{ loadLanguageVersion(lang) => presLike|null }`
  collabLanguage = null,
} = {}) {
  let translateBusy = false;

  /**
   * Best-effort display text for a thrown value. May legitimately come back
   * empty (a rejection with no message at all) - `toastStatus` supplies the
   * fallback so an error can never end up invisible.
   */
  const errorMessage = (e) => String(e?.message || e || '').trim();

  const setTranslateBusy = (busy) => {
    translateBusy = !!busy;
    syncLangUi();
  };

  const activeLang = () =>
    normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;

  /**
   * The languages the menu lists as existing versions.
   *
   * The active language is included even when its version buffer has not been
   * written yet (the moment right after a switch), so the trigger and the list
   * can never disagree about what is being edited.
   */
  const listedLangs = () => {
    const active = activeLang();
    const existing = existingVersionLangs(pres);
    return existing.includes(active) ? existing : [active, ...existing];
  };

  const ensureVersionBuffers = (lang) => {
    pres.i18n.versions =
      pres.i18n.versions && typeof pres.i18n.versions === 'object'
        ? pres.i18n.versions
        : {};
    return !!pres.i18n.versions[lang];
  };

  const setUrlLangParam = (lang) => {
    const next = normalizeLang(lang);
    if (!next) return;
    setQueryParams({ lang: next });
  };

  // Every status reported here becomes a visible toast. An empty message is
  // never silence: a rejection without a message (an aborted request, an error
  // body with no text) used to return early here, which is exactly how a failed
  // language switch could leave no trace at all.
  const toastStatus = (payload) => {
    const p =
      typeof payload === 'string'
        ? { level: 'info', msg: payload }
        : payload && typeof payload === 'object'
          ? payload
          : null;
    const msg =
      String(p?.msg || '').trim() || t('common.unknownError', 'Unknown error');
    const level =
      p?.level === 'success' || p?.level === 'error' ? p.level : 'info';
    const durationMs = typeof p?.durationMs === 'number' ? p.durationMs : 5200;
    if (level === 'success')
      toast.success(msg, { id: 'editor-translate', durationMs });
    else if (level === 'error') toast.error(msg, { id: 'editor-translate' });
    else toast.info(msg, { id: 'editor-translate', durationMs });
  };

  /**
   * One menu row for a language version the deck already has.
   *
   * The status half is the whole reason this is a menu and not the old toggle:
   * the source version is named as such, and every other version carries the
   * count of texts it is still missing (`translationProgress`, derived on read).
   *
   * Both halves are measured **from `progress.dominant` outwards**, and the row
   * title says so in words. `dominant` is the language the deck was written in
   * and it stays put while you edit another version (D74), so "source" names a
   * fixed version and a count is "texts the source has and this one does not" —
   * a number with a stationary zero point. Moving the source is a deliberate
   * action, never a side effect of opening a version: the "Make this the source
   * version" row below the list is the only thing that does it.
   */
  const versionItem = (lang, { active, progress }) => {
    const isActive = lang === active;
    const row = h('button', {
      class: `dropdown-item lang-menu-item${isActive ? ' is-active' : ''}`,
      type: 'button',
      disabled: translateBusy,
      onclick: () => {
        closeMenu();
        if (isActive) return;
        switchLanguageMode(lang, { onStatus: toastStatus });
      },
    });
    if (isActive) row.setAttribute('aria-current', 'true');
    row.append(
      h('span', { class: 'lang-menu-name', text: getLangDisplayName(lang) }),
    );

    if (lang === progress.dominant) {
      row.append(
        h('span', {
          class: 'lang-menu-status',
          text: t('editor.lang.sourceBadge', 'source'),
          title: t(
            'editor.lang.sourceBadgeTitle',
            'Translations are measured from this version.',
          ),
        }),
      );
      return row;
    }

    const missing = progress.missing?.[lang];
    if (typeof missing !== 'number') return row;
    const source = getLangDisplayName(progress.dominant);
    if (missing === 0) {
      row.append(
        h('span', {
          class: 'lang-menu-status is-complete',
          text: '✓',
          title: t(
            'editor.lang.completeTitle',
            'Nothing the {source} version has is missing here.',
            { source },
          ),
        }),
      );
    } else {
      row.append(
        h('span', {
          class: 'lang-menu-status',
          text: t('editor.lang.missingCount', '{n} missing', {
            n: String(missing),
          }),
          title: t(
            'editor.lang.missingCountTitle',
            '{n} texts the {source} version has and this one does not.',
            { n: String(missing), source },
          ),
        }),
      );
    }
    return row;
  };

  /**
   * Whether the deck can be told it is written in the version on screen.
   *
   * Two states have nothing to offer: the version being edited already *is* the
   * source, and a version whose buffer has not been written yet (the moment
   * between a switch and its load). The row is then absent rather than
   * disabled - a greyed-out "make this the source" on the source itself would
   * be a control describing the state it is already in.
   */
  const canMoveSourceHere = (active, dominant) =>
    !!active &&
    !!dominant &&
    active !== dominant &&
    !!pres?.i18n?.versions?.[active];

  /**
   * Point `i18n.dominant` at the version being edited.
   *
   * Everything downstream reads the move on its own: `translationProgress`
   * re-measures every other version from here, the server's `normalizeI18n`
   * keeps top-level `title`/`slides` on the new source (which is what the deck
   * list preview and a viewer link without `?lang=` read), and the collab
   * binder mirrors a changed `dominant` into the shared doc's `meta`. So this
   * writes one field and saves - a second repair anywhere would be a second
   * place the source could be decided.
   */
  const makeActiveTheSource = async ({ onStatus } = {}) => {
    const next = activeLang();
    const previous = normalizeLang(pres?.i18n?.dominant) || null;
    if (!canMoveSourceHere(next, previous)) return;
    if (translateBusy) {
      onStatus?.({
        level: 'info',
        msg: t('editor.translate.busy', 'Translating…'),
      });
      return;
    }

    const lang = getLangDisplayName(next);
    const current = getLangDisplayName(previous);
    const ok = await confirmModal(root || document.body, {
      title: t(
        'editor.lang.makeSourceTitle',
        'Make {lang} the source version',
        {
          lang,
        },
      ),
      message: t(
        'editor.lang.makeSourceConfirm',
        'The deck is written in {lang} from now on: translation counts are measured from this version, and the deck list preview and a link without a language show it. Nothing is translated or overwritten, so {current} keeps its texts and gets a count of its own.',
        { lang, current },
      ),
      confirmLabel: t(
        'editor.lang.makeSourceConfirmBtn',
        'Make source version',
      ),
    });
    if (!ok) return;

    pres.i18n.dominant = next;
    markDirty?.();
    syncLangUi();
    if (isDirty?.()) {
      await requestSave?.();
      // requestSave reports its own failures; all that is left here is not
      // claiming success over one.
      if (isDirty?.()) return;
    }
    onStatus?.({
      level: 'success',
      msg: t(
        'editor.lang.makeSourceDone',
        '{lang} is now the source version.',
        {
          lang,
        },
      ),
    });
  };

  /** The "Make this the source version" row, shown under the version list. */
  const makeSourceItem = (active, dominant) =>
    h('button', {
      class: 'dropdown-item lang-menu-action',
      type: 'button',
      disabled: translateBusy,
      title: t(
        'editor.lang.makeSourceHint',
        'Translations are measured from {current} now. Measure them from {lang} instead.',
        {
          current: getLangDisplayName(dominant),
          lang: getLangDisplayName(active),
        },
      ),
      onclick: () => {
        closeMenu();
        makeActiveTheSource({ onStatus: toastStatus });
      },
      text: t('editor.lang.makeSource', 'Make this the source version'),
    });

  /** One menu row under "Add language…": a workspace language with no version yet. */
  const addItem = (lang) =>
    h('button', {
      class: 'dropdown-item lang-menu-item',
      type: 'button',
      disabled: translateBusy,
      onclick: () => {
        closeMenu();
        switchLanguageMode(lang, { onStatus: toastStatus });
      },
      text: getLangDisplayName(lang),
    });

  /**
   * Rebuild the menu from state. Called on every open and on every UI sync, so
   * a version created (or filled) since the last look is listed as it is now.
   */
  const buildMenu = () => {
    const active = activeLang();
    const progress = translationProgress(pres);
    const listed = listedLangs();
    const items = listed.map((lang) => versionItem(lang, { active, progress }));

    // Directly under the list it belongs to: the row it moves the "source"
    // badge onto is the one the eye just passed.
    if (canMoveSourceHere(active, progress.dominant)) {
      items.push(h('div', { class: 'dropdown-sep' }));
      items.push(makeSourceItem(active, progress.dominant));
    }

    const addable = getSupportedLangs().filter((l) => !listed.includes(l));
    if (addable.length) {
      items.push(h('div', { class: 'dropdown-sep' }));
      items.push(
        h('div', {
          class: 'dropdown-help',
          text: t('editor.lang.addLanguage', 'Add language…'),
        }),
      );
      for (const lang of addable) items.push(addItem(lang));
    }
    menu.replaceChildren(...items);
  };

  // Single place that derives the trigger from state: which language is active,
  // and whether a translation is running. While it runs the menu is disabled
  // with the reason on the trigger (a disabled control swallows its own
  // tooltip), so a click that can't work explains itself instead of
  // disappearing under the busy modal's backdrop.
  const syncLangUi = () => {
    langMenuLabel.textContent = getLangDisplayName(activeLang());
    langMenu.summary.setAttribute(
      'aria-busy',
      translateBusy ? 'true' : 'false',
    );
    langMenu.summary.classList.toggle('is-disabled', translateBusy);
    langMenu.summary.title = translateBusy
      ? t(
          'editor.translate.busyLangSwitch',
          'Translating… you can switch language again when it is done.',
        )
      : t('editor.langMode.title', 'Language mode (edit + present)');
    if (translateBusy) closeMenu();
    buildMenu();
  };

  // Apply server-enforced metadata after a server-side write (translate
  // endpoints call updatePresentation, which bumps the revision - without
  // taking the new revision over, the next client save would 409).
  const applyServerMeta = (updated) => {
    if (!updated || typeof updated !== 'object') return;
    if (typeof updated.revision === 'number') pres.revision = updated.revision;
    else if (typeof updated.revision === 'string' && updated.revision.trim())
      pres.revision = Number(updated.revision) || pres.revision;
    if (typeof updated.modified === 'string') pres.modified = updated.modified;
    if (updated.updatedBy !== undefined) pres.updatedBy = updated.updatedBy;
  };

  /**
   * Fetch a language version from the server and make it the active editing
   * buffer (title, slides, selection, URL, UI refresh).
   */
  const loadLanguageIntoView = async (lang, { onStatus } = {}) => {
    const next = normalizeLang(lang);
    if (!next) return false;
    const prevSelectedSlideId = String(getSelectedSlideId?.() || '');
    try {
      // Live-edit mode: project the version from the live doc (fresh; the
      // server JSON can lag a debounce window). Falls back to the server
      // fetch when the doc isn't synced yet.
      let refreshed = null;
      if (collabLanguage?.loadLanguageVersion) {
        try {
          refreshed = collabLanguage.loadLanguageVersion(next) || null;
        } catch {
          refreshed = null;
        }
      }
      if (!refreshed) {
        refreshed = await api?.(
          `/api/presentations/${id}?lang=${encodeURIComponent(next)}`,
        );
      }
      // A load that does not carry the version is a failed switch, not a
      // partial one: the live-doc projection returns a deck even when the
      // version is absent (a just-created buffer that has not reached the
      // doc yet), and adopting it would leave `active` pointing at slides in
      // another language - which the next save would then sync as if they
      // were this version's own.
      if (!refreshed?.i18n?.versions?.[next]) {
        throw new Error(
          t(
            'editor.lang.versionNotLoaded',
            'The {lang} version could not be loaded.',
            { lang: getLangDisplayName(next) },
          ),
        );
      }
      pres.i18n = refreshed.i18n;
      pres.title = refreshed.title;
      pres.slides = refreshed.slides;
      pres.theme = refreshed.theme;
      applyServerMeta(refreshed);
    } catch (e) {
      onStatus?.({ level: 'error', msg: errorMessage(e) });
      return false;
    }

    // Only `active` moves: the source version the counts are measured from is
    // whatever the server just handed back in `refreshed.i18n.dominant` (D74).
    pres.i18n.active = next;
    pres.i18n.versions[next].title = pres.title;
    pres.i18n.versions[next].slides = pres.slides;
    if (topbarTitleEl) {
      topbarTitleEl.textContent = pres.title;
      topbarTitleEl.title = pres.title;
    }

    const sameSlideExists = prevSelectedSlideId
      ? (pres.slides || []).some((s) => s?.id === prevSelectedSlideId)
      : false;
    setSelectedSlideId?.(
      sameSlideExists ? prevSelectedSlideId : pres.slides?.[0]?.id || null,
    );
    setUrlLangParam(next);
    editorState.refreshAll();
    syncLangUi();
    // Live-edit mode: the switch itself (a just-created version) must reach the
    // shared doc — the autosave path that used to persist it is inert with the
    // flag on.
    if (collabLanguage) markDirty?.();
    return true;
  };

  /**
   * The switch itself. Throws freely - `switchLanguageMode` is the only caller
   * and turns every failure into a visible status.
   */
  const runLanguageSwitch = async (nextLang, { onStatus } = {}) => {
    const next = normalizeLang(nextLang);
    if (!next) return;
    // The admin subset gates which versions can be *added*; a version the
    // deck already has is always editable, or the menu would list a language
    // it then refuses (the B182 defect in a new shape).
    if (!isSupportedLang(next) && !pres?.i18n?.versions?.[next]) {
      onStatus?.({
        level: 'info',
        msg: t(
          'editor.lang.disabledByAdmin',
          'This language is disabled in admin settings.',
        ),
      });
      return;
    }
    if (next === pres.i18n.active) return;
    if (translateBusy) {
      onStatus?.({
        level: 'info',
        msg: t('editor.translate.busy', 'Translating…'),
      });
      return;
    }

    // The version this one will be translated FROM. Read before the switch so
    // the answer is the deck as it stands, not as the reload leaves it: the
    // load replaces `pres.i18n` wholesale with the server's block.
    const sourceLang = translationSourceFor(pres, next);

    // Create a missing version on the spot instead of blocking the switch.
    // Structure only: the save sync copies slide ids/layout and non-translatable
    // content, leaving translatable fields empty ("missing") so the AI fill and
    // the inline ghosts both know what still needs words. The deck title is
    // copied as-is - titles often stay the same across languages.
    const justCreated = !ensureVersionBuffers(next);
    if (justCreated) {
      pres.i18n.versions[next] = { title: pres.title || '', slides: [] };
      markDirty?.();
    }

    if (isDirty?.()) {
      onStatus?.({
        level: 'info',
        msg: t('common.savingFirst', 'Saving first…'),
      });
      await requestSave?.();
      if (isDirty?.()) {
        onStatus?.({
          level: 'error',
          msg: t(
            'editor.lang.switchAborted',
            'Could not save; language switch aborted.',
          ),
        });
        return;
      }
    }

    const ok = await loadLanguageIntoView(next, { onStatus });
    if (!ok) return;

    // Invite (non-blocking, dismissible) to AI-translate what's still missing -
    // right after creating the version, but also on later switches while the
    // version still has untranslated texts. Manual translations are never
    // overwritten, so the invite stays safe to accept at any time.
    if (!sourceLang) return;
    if (justCreated) {
      showTranslateInvite(
        t(
          'editor.lang.versionCreatedInvite',
          'The {lang} version was just created and has no texts yet. Translate them automatically? Fields you fill in yourself are never overwritten.',
          { lang: getLangDisplayName(next) },
        ),
        sourceLang,
      );
    } else if (versionHasMissingTexts(next, sourceLang)) {
      showTranslateInvite(
        t(
          'editor.lang.versionIncompleteInvite',
          'This {lang} version still has untranslated texts. Translate them automatically? Fields you filled in yourself are never overwritten.',
          { lang: getLangDisplayName(next) },
        ),
        sourceLang,
      );
    }
  };

  /**
   * Switch the editor to another language version.
   *
   * Nothing in this path may fail silently: the onclick handlers don't await
   * the returned promise, so without this catch a throw anywhere below (a
   * failed fetch, a version buffer the server didn't return) would vanish as an
   * unhandled rejection and leave a dead-looking menu behind.
   */
  const switchLanguageMode = async (nextLang, { onStatus } = {}) => {
    try {
      await runLanguageSwitch(nextLang, { onStatus });
    } catch (e) {
      onStatus?.({ level: 'error', msg: errorMessage(e) });
    }
  };

  /**
   * Whether `lang` still has empty translatable fields that `sourceLang` fills.
   *
   * The same scan the menu's status counts use, asked about one pair - the
   * hand-rolled top-level-only mirror it replaces missed prose nested in
   * `rows[].blocks[]` and reported such a version complete.
   */
  const versionHasMissingTexts = (lang, sourceLang) => {
    if (!sourceLang || sourceLang === lang) return false;
    if (!pres?.i18n?.versions?.[lang] || !pres?.i18n?.versions?.[sourceLang])
      return false;
    return (
      computeMissingTranslation({
        source: pickVersion(pres, sourceLang),
        target: pickVersion(pres, lang),
      }).missingCount > 0
    );
  };

  /**
   * AI-translate only the MISSING texts of the active language. Manually
   * translated fields are untouched.
   *
   * @param {object} [opts]
   * @param {string} [opts.from] - source version; defaults to the deck's own
   *   answer for "what is this language translated from" (`translationSourceFor`).
   */
  const translateMissingForActive = async ({ onStatus, from } = {}) => {
    const to = activeLang();
    const source = normalizeLang(from) || translationSourceFor(pres, to);
    if (!source) {
      onStatus?.({
        level: 'info',
        msg: t(
          'editor.translate.disabled',
          'Translation is disabled (only one language enabled).',
        ),
      });
      return;
    }
    if (translateBusy) {
      onStatus?.({
        level: 'info',
        msg: t('editor.translate.busy', 'Translating…'),
      });
      return;
    }
    if (isDirty?.()) {
      onStatus?.({
        level: 'info',
        msg: t('common.savingFirst', 'Saving first…'),
      });
      await requestSave?.();
      if (isDirty?.()) {
        onStatus?.({
          level: 'error',
          msg: t(
            'editor.translate.abortedSaveFailed',
            'Could not save; translation aborted.',
          ),
        });
        return;
      }
    }

    setTranslateBusy(true);
    const busyModal = openBusyModal();
    try {
      // fillMissing keeps every field the user already wrote by hand (top-level
      // AND per-item texts) and only translates the empty ones from `source`.
      const resp = await api?.(`/api/presentations/${id}/translate`, {
        method: 'POST',
        body: JSON.stringify({
          from: source,
          to,
          overwrite: false,
          fillMissing: true,
        }),
      });
      applyServerMeta(resp?.presentation);
      // Live-edit mode: the server applied the translation to the live doc
      // itself (step-4 server-as-collaborator seam); it reaches this client
      // as a regular remote update. The doc-based load below may briefly
      // show the pre-translate state until that update lands, after which
      // the binder re-renders.
      await loadLanguageIntoView(to, { onStatus });
      onStatus?.({
        level: 'success',
        msg: t('editor.translate.done', 'Translation ready.'),
      });
    } catch (e) {
      onStatus?.({ level: 'error', msg: errorMessage(e) });
    } finally {
      setTranslateBusy(false);
      busyModal.close();
    }
  };

  /**
   * The languages a full-deck retranslate would write into: every version the
   * deck has besides the one on screen.
   *
   * "The other language" had one answer while the chrome was bilingual; on the
   * open axis the honest generalization is "all the others". Creating a version
   * is deliberately NOT part of it any more — that is what the menu's "Add
   * language…" does, and it comes with the fill-missing invite. So this action
   * refreshes what exists and never invents a target (D72 #1).
   */
  const retranslateTargets = () => {
    const active = activeLang();
    return existingVersionLangs(pres).filter((l) => l !== active);
  };

  /**
   * Full-deck retranslate of every other existing version (the ⋯ menu action).
   * Overwrites: these versions exist, so there is nothing to create and the
   * confirm names every one of them.
   */
  const translateOtherLanguage = async ({ onStatus } = {}) => {
    const from = activeLang();
    const targets = retranslateTargets();
    if (!targets.length) {
      onStatus?.({
        level: 'info',
        msg: t(
          'editor.translate.noOtherVersions',
          'This deck has no other language version yet. Add one from the language menu.',
        ),
      });
      return;
    }
    const langList = targets.map(getLangDisplayName).join(', ');
    const ok = await confirmModal(root || document.body, {
      title: t('editor.translate.overwrite', 'Overwrite translation'),
      message: t(
        'editor.translate.overwriteConfirm',
        'This replaces the existing translation of {lang}. Continue?',
        { lang: langList },
      ),
      confirmLabel: t('editor.translate.overwrite', 'Overwrite translation'),
      danger: true,
    });
    if (!ok) return;
    if (isDirty?.()) {
      onStatus?.({
        level: 'info',
        msg: t('common.savingFirst', 'Saving first…'),
      });
      await requestSave?.();
      if (isDirty?.()) {
        onStatus?.({
          level: 'error',
          msg: t(
            'editor.translate.abortedSaveFailed',
            'Could not save; translation aborted.',
          ),
        });
        return;
      }
    }
    onStatus?.({
      level: 'info',
      msg: t('editor.translate.busy', 'Translating…'),
    });
    setTranslateBusy(true);
    const busyModal = openBusyModal();
    try {
      // Sequential on purpose: each call bumps the deck revision, so two in
      // flight would race for it and the second would 409.
      for (const to of targets) {
        const resp = await api?.(`/api/presentations/${id}/translate`, {
          method: 'POST',
          body: JSON.stringify({
            from,
            to,
            overwrite: true,
            fillMissing: false,
          }),
        });
        const updated = resp?.presentation;
        if (updated?.i18n) pres.i18n = updated.i18n;
        applyServerMeta(updated);
      }
      // Live-edit mode: the server applied the translation to the live doc
      // (step-4 seam), so it syncs to every client — no local doc write here
      // (a duplicate write would double-insert the same text via the CRDT).
      onStatus?.({
        level: 'success',
        msg: t('editor.translate.done', 'Translation ready.'),
      });
    } catch (e) {
      onStatus?.({ level: 'error', msg: errorMessage(e) });
    } finally {
      setTranslateBusy(false);
      busyModal.close();
    }
  };

  /** Dismissible "busy" modal shown while a translation request runs. */
  function openBusyModal() {
    const modal = createModal({
      title: t('editor.translate.modalTitle', 'Translating…'),
    });
    modal.append(
      h('div', {
        class: 'help',
        text: t(
          'editor.translate.modalHelp',
          'Please wait. You can keep using the editor once translation is done.',
        ),
      }),
    );
    modal.show(root);
    return modal;
  }

  // Post-switch invite popover: offer to AI-translate the missing texts of a
  // freshly created (or still incomplete) language version. Non-blocking.
  const langPopoverMsg = h('div', { class: 'lang-popover-msg' });
  const langPopoverBtn = h('button', {
    class: 'btn btn-primary btn-sm lang-popover-btn',
    type: 'button',
    text: t('editor.translate.missingBtn', 'Translate with AI'),
  });
  const langPopoverDismiss = h('button', {
    class: 'btn btn-secondary btn-sm lang-popover-btn',
    type: 'button',
    text: t('editor.lang.notNow', 'Not now, I’ll write it myself'),
  });
  const langPopover = h('div', { class: 'lang-popover' }, [
    langPopoverMsg,
    langPopoverBtn,
    langPopoverDismiss,
  ]);
  let langPopoverTimeout = null;
  // The version the invite offers to translate FROM, pinned when it is shown:
  // by the time the button is clicked the deck's own source answer has moved on.
  let langPopoverSource = null;

  const showTranslateInvite = (msg, sourceLang) => {
    if (langPopoverTimeout) clearTimeout(langPopoverTimeout);
    langPopoverMsg.textContent = msg;
    langPopoverSource = sourceLang || null;
    langPopover.classList.add('is-visible');
    langPopoverTimeout = setTimeout(() => {
      langPopover.classList.remove('is-visible');
    }, 15000);
  };

  const hideLangPopover = () => {
    if (langPopoverTimeout) clearTimeout(langPopoverTimeout);
    langPopover.classList.remove('is-visible');
  };

  langPopoverBtn.onclick = () => {
    const from = langPopoverSource;
    hideLangPopover();
    translateMissingForActive({ onStatus: toastStatus, from });
  };
  langPopoverDismiss.onclick = () => hideLangPopover();

  // UI elements
  const langMenuWrapper = h('div', { class: 'lang-menu-wrapper' });
  const langMenuLabel = h('span', { class: 'lang-menu-label' });
  // Title is set by syncLangUi (it doubles as the busy explanation).
  const langMenu = createDropdown({
    triggerClass: 'btn btn-secondary is-compact',
    triggerContent: [langMenuLabel, makeDropdownCaret()],
    detailsClass: 'lang-menu',
    ariaLabel: t('editor.langMode.title', 'Language mode (edit + present)'),
  });
  const menu = langMenu.menu;
  const closeMenu = langMenu.close;
  // Rebuilt on every open: a version created or filled since the last look is
  // listed as it is now, not as it was when the topbar was built.
  langMenu.details.addEventListener('toggle', () => {
    if (langMenu.details.open) buildMenu();
  });

  langMenuWrapper.append(langMenu.el, langPopover);

  syncLangUi();

  return {
    el: langMenuWrapper,
    syncLangUi,
    detach: () => {
      hideLangPopover();
      langMenu.detach();
    },
    translateOtherLanguage: () =>
      translateOtherLanguage({ onStatus: toastStatus }),
    translateMissingForActive: () =>
      translateMissingForActive({ onStatus: toastStatus }),
    canTranslate: () => retranslateTargets().length > 0,
  };
}
