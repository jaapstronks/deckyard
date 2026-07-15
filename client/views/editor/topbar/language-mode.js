/**
 * Language mode switching component for the editor topbar.
 *
 * Switching to a language version that doesn't exist yet is never blocked:
 * the version is created on the spot (structure-only, translatable fields
 * empty) and the user lands in it immediately. A non-blocking popover then
 * offers to AI-translate the missing texts - fields the user already filled
 * in by hand are left alone (the server's translate/missing endpoint only
 * fills empty translatable fields).
 */

import { getSupportedLangs, isSupportedLang } from '../../../lib/i18n.js';
import { confirmModal } from '../../../lib/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { SLIDE_TYPES } from '../../../../shared/slide-types.js';
import { translatableKeysForType } from '../translatable.js';

/**
 * Create the language mode switcher component.
 *
 * @param {object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.root - Root element for modals
 * @param {object} options.pres - Presentation object
 * @param {string} options.id - Presentation ID
 * @param {Function} options.api - API client
 * @param {Function} options.requestSave - Request save function
 * @param {Function} options.isDirty - Check if dirty
 * @param {Function} options.markDirty - Mark presentation dirty
 * @param {Function} options.normalizeLang - Normalize language code
 * @param {Function} options.otherLang - Get other language
 * @param {Function} options.getSelectedSlideId - Get selected slide ID
 * @param {Function} options.setSelectedSlideId - Set selected slide ID
 * @param {object} options.editorState - Editor state updater utility
 * @param {HTMLElement} options.topbarTitleEl - Title element to update
 * @param {Function} options.toast - Toast notifications
 * @returns {object} Language mode controller
 */
export function createLanguageMode({
  h,
  root,
  pres,
  id,
  api,
  requestSave,
  isDirty,
  markDirty,
  normalizeLang,
  otherLang,
  getSelectedSlideId,
  setSelectedSlideId,
  editorState,
  topbarTitleEl,
  toast,
  // Live collaborative editing (collab fase 2): when set, language versions
  // are read from the live Y.Doc instead of the server JSON (which lags by
  // up to a persistence debounce window), and server translate responses are
  // pushed back into the doc so the next collab store can't overwrite them.
  // `{ loadLanguageVersion(lang) => presLike|null, adoptLanguageVersion(lang, version) }`
  collabLanguage = null,
} = {}) {
  let translateBusy = false;

  const langLabel = (lang) =>
    lang === 'nl'
      ? t('editor.lang.dutch', 'Dutch')
      : t('editor.lang.english', 'English');

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
    try {
      const u = new URL(location.href);
      u.searchParams.set('lang', next);
      history.replaceState(null, '', u.toString());
    } catch {
      // ignore
    }
  };

  const toastStatus = (payload) => {
    const p =
      typeof payload === 'string'
        ? { level: 'info', msg: payload }
        : payload && typeof payload === 'object'
          ? payload
          : null;
    const msg = String(p?.msg || '').trim();
    if (!msg) return;
    const level = p?.level === 'success' || p?.level === 'error' ? p.level : 'info';
    const durationMs = typeof p?.durationMs === 'number' ? p.durationMs : 5200;
    if (level === 'success') toast.success(msg, { id: 'editor-translate', durationMs });
    else if (level === 'error') toast.error(msg, { id: 'editor-translate' });
    else toast.info(msg, { id: 'editor-translate', durationMs });
  };

  const syncLangUi = () => {
    const a = normalizeLang(pres?.i18n?.active) || 'nl';
    btnNl.classList.toggle('is-active', a === 'nl');
    btnEn.classList.toggle('is-active', a === 'en-GB');
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
    if (typeof updated.updatedBy === 'string') pres.updatedBy = updated.updatedBy;
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
          `/api/presentations/${id}?lang=${encodeURIComponent(next)}`
        );
      }
      pres.i18n = refreshed.i18n;
      pres.title = refreshed.title;
      pres.slides = refreshed.slides;
      pres.theme = refreshed.theme;
      applyServerMeta(refreshed);
    } catch (e) {
      onStatus?.(String(e?.message || e));
      return false;
    }

    pres.i18n.active = next;
    pres.i18n.dominant = next;
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
      sameSlideExists ? prevSelectedSlideId : pres.slides?.[0]?.id || null
    );
    setUrlLangParam(next);
    editorState.refreshAll();
    syncLangUi();
    // Live-edit mode: the switch itself (dominant, a just-created version)
    // must reach the shared doc — the autosave path that used to persist it
    // is inert with the flag on.
    if (collabLanguage) markDirty?.();
    return true;
  };

  const switchLanguageMode = async (nextLang, { onStatus } = {}) => {
    const next = normalizeLang(nextLang);
    if (!next) return;
    if (!isSupportedLang(next) && next !== pres?.i18n?.active) {
      onStatus?.({
        level: 'info',
        msg: t(
          'editor.lang.disabledByAdmin',
          'This language is disabled in admin settings.'
        ),
      });
      return;
    }
    if (next === pres.i18n.active) return;
    if (translateBusy) {
      onStatus?.({ level: 'info', msg: t('editor.translate.busy', 'Translating…') });
      return;
    }

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
      onStatus?.({ level: 'info', msg: t('common.savingFirst', 'Saving first…') });
      await requestSave?.();
      if (isDirty?.()) {
        onStatus?.({
          level: 'error',
          msg: t(
            'editor.lang.switchAborted',
            'Could not save; language switch aborted.'
          ),
        });
        return;
      }
    }

    const ok = await loadLanguageIntoView(next, { onStatus });
    if (!ok) return;
    onStatus?.({ level: 'info', msg: '' });

    // Invite (non-blocking, dismissible) to AI-translate what's still missing -
    // right after creating the version, but also on later switches while the
    // version still has untranslated texts. Manual translations are never
    // overwritten, so the invite stays safe to accept at any time.
    if (justCreated) {
      showTranslateInvite(
        t(
          'editor.lang.versionCreatedInvite',
          'The {lang} version was just created and has no texts yet. Translate them automatically? Fields you fill in yourself are never overwritten.',
          { lang: langLabel(next) }
        )
      );
    } else if (versionHasMissingTexts(next)) {
      showTranslateInvite(
        t(
          'editor.lang.versionIncompleteInvite',
          'This {lang} version still has untranslated texts. Translate them automatically? Fields you filled in yourself are never overwritten.',
          { lang: langLabel(next) }
        )
      );
    }
  };

  /**
   * Whether the given language version still has empty translatable fields for
   * which the other language DOES have text (top-level string/markdown fields;
   * a cheap client-side mirror of the server's missing-translation check).
   */
  const versionHasMissingTexts = (lang) => {
    const from = otherLang(lang);
    const src = pres?.i18n?.versions?.[from];
    const tgt = pres?.i18n?.versions?.[lang];
    if (!src || !tgt) return false;
    const tgtById = new Map(
      (Array.isArray(tgt.slides) ? tgt.slides : [])
        .filter((s) => s && typeof s.id === 'string')
        .map((s) => [s.id, s])
    );
    for (const s of Array.isArray(src.slides) ? src.slides : []) {
      if (!s || typeof s !== 'object') continue;
      const keys = translatableKeysForType({ SLIDE_TYPES, type: s.type });
      if (!keys.length) continue;
      const tgtContent = tgtById.get(s.id)?.content || {};
      for (const k of keys) {
        const sv = s.content?.[k];
        const tv = tgtContent[k];
        if (
          typeof sv === 'string' && sv.trim() &&
          !(typeof tv === 'string' && tv.trim())
        ) {
          return true;
        }
      }
    }
    return false;
  };

  /**
   * AI-translate only the MISSING texts of the active language, using the
   * other language as the source. Manually translated fields are untouched.
   */
  const translateMissingForActive = async ({ onStatus } = {}) => {
    const to = normalizeLang(pres.i18n.active) || 'nl';
    const from = otherLang(to);
    if (!from) {
      onStatus?.({
        level: 'info',
        msg: t(
          'editor.translate.disabled',
          'Translation is disabled (only one language enabled).'
        ),
      });
      return;
    }
    if (translateBusy) {
      onStatus?.({ level: 'info', msg: t('editor.translate.busy', 'Translating…') });
      return;
    }
    if (isDirty?.()) {
      onStatus?.({ level: 'info', msg: t('common.savingFirst', 'Saving first…') });
      await requestSave?.();
      if (isDirty?.()) {
        onStatus?.({
          level: 'error',
          msg: t(
            'editor.translate.abortedSaveFailed',
            'Could not save; translation aborted.'
          ),
        });
        return;
      }
    }

    translateBusy = true;
    const backdrop = buildBusyModal();
    root.append(backdrop);
    try {
      // fillMissing keeps every field the user already wrote by hand (top-level
      // AND per-item texts) and only translates the empty ones from `from`.
      const resp = await api?.(`/api/presentations/${id}/translate`, {
        method: 'POST',
        body: JSON.stringify({
          from,
          to,
          overwrite: false,
          fillMissing: true,
        }),
      });
      applyServerMeta(resp?.presentation);
      // Live-edit mode: the translate endpoint only updated the stored JSON;
      // push the translated version into the live doc, then the doc-based
      // load below shows it.
      collabLanguage?.adoptLanguageVersion?.(
        to,
        resp?.presentation?.i18n?.versions?.[to]
      );
      await loadLanguageIntoView(to, { onStatus });
      onStatus?.({
        level: 'success',
        msg: t('editor.translate.done', 'Translation ready.'),
      });
    } catch (e) {
      onStatus?.({ level: 'error', msg: String(e?.message || e) });
    } finally {
      translateBusy = false;
      backdrop.remove();
    }
  };

  /**
   * Full-deck translate into the other language (the topbar menu action).
   */
  const translateOtherLanguage = async ({ onStatus } = {}) => {
    const from = normalizeLang(pres.i18n.active) || 'nl';
    const to = otherLang(from);
    if (!to) {
      onStatus?.({
        level: 'info',
        msg: t(
          'editor.translate.disabled',
          'Translation is disabled (only one language enabled).'
        ),
      });
      return;
    }
    const overwrite = !!pres.i18n.versions?.[to];
    if (overwrite) {
      const ok = await confirmModal(h, root || document.body, {
        title: t('editor.translate.overwrite', 'Overwrite translation'),
        message: t(
          'editor.translate.overwriteConfirm',
          'The {lang} version already exists. Overwrite?',
          { lang: to === 'nl' ? 'NL' : 'EN' }
        ),
        confirmLabel: t('editor.translate.overwrite', 'Overwrite translation'),
        danger: true,
      });
      if (!ok) return;
    }
    if (isDirty?.()) {
      onStatus?.({ level: 'info', msg: t('common.savingFirst', 'Saving first…') });
      await requestSave?.();
      if (isDirty?.()) {
        onStatus?.({
          level: 'error',
          msg: t(
            'editor.translate.abortedSaveFailed',
            'Could not save; translation aborted.'
          ),
        });
        return;
      }
    }
    onStatus?.({ level: 'info', msg: t('editor.translate.busy', 'Translating…') });
    translateBusy = true;
    const backdrop = buildBusyModal();
    root.append(backdrop);
    try {
      const resp = await api?.(`/api/presentations/${id}/translate`, {
        method: 'POST',
        body: JSON.stringify({
          from,
          to,
          overwrite,
          fillMissing: !overwrite,
        }),
      });
      const updated = resp?.presentation;
      if (updated?.i18n) pres.i18n = updated.i18n;
      applyServerMeta(updated);
      // Live-edit mode: see translateMissingForActive — without this the
      // next collab store would overwrite the server-side translation.
      collabLanguage?.adoptLanguageVersion?.(to, updated?.i18n?.versions?.[to]);
      onStatus?.({ level: 'success', msg: t('editor.translate.done', 'Translation ready.') });
    } catch (e) {
      onStatus?.(String(e?.message || e));
    } finally {
      translateBusy = false;
      backdrop.remove();
    }
  };

  /** Dismissible "busy" modal shown while a translation request runs. */
  function buildBusyModal() {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const modal = h('div', { class: 'modal' });
    modal.append(
      h('button', {
        class: 'modal-close',
        type: 'button',
        'aria-label': t('common.close', 'Close'),
        onclick: () => backdrop.remove(),
      }),
      h('h2', { text: t('editor.translate.modalTitle', 'Translating…') }),
      h('div', {
        class: 'help is-mt-8',
        text: t(
          'editor.translate.modalHelp',
          'Please wait. You can keep using the editor once translation is done.'
        ),
      })
    );
    backdrop.append(modal);
    const handleEscape = (e) => {
      if (e.key === 'Escape') backdrop.remove();
    };
    document.addEventListener('keydown', handleEscape);
    const origRemove = backdrop.remove.bind(backdrop);
    backdrop.remove = () => {
      document.removeEventListener('keydown', handleEscape);
      origRemove();
    };
    return backdrop;
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

  const showTranslateInvite = (msg) => {
    if (langPopoverTimeout) clearTimeout(langPopoverTimeout);
    langPopoverMsg.textContent = msg;
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
    hideLangPopover();
    translateMissingForActive({ onStatus: toastStatus });
  };
  langPopoverDismiss.onclick = () => hideLangPopover();

  // UI elements
  const langSegWrapper = h('div', { class: 'lang-seg-wrapper' });
  const langSeg = h('div', {
    class: 'sb-segmented is-toggle is-compact',
    title: t('editor.langMode.title', 'Language mode (edit + present)'),
  });

  const btnNl = h('button', {
    class: 'sb-segmented-btn',
    type: 'button',
    text: 'NL',
    onclick: () => switchLanguageMode('nl', { onStatus: toastStatus }),
  });

  const btnEn = h('button', {
    class: 'sb-segmented-btn',
    type: 'button',
    text: 'EN',
    onclick: () => switchLanguageMode('en-GB', { onStatus: toastStatus }),
  });

  langSeg.append(btnNl, btnEn);
  langSegWrapper.append(langSeg, langPopover);

  // Initialize button states
  const supported = new Set(getSupportedLangs());
  const active = normalizeLang(pres?.i18n?.active);
  btnNl.hidden = !(supported.has('nl') || active === 'nl');
  btnEn.hidden = !(supported.has('en-GB') || active === 'en-GB');
  btnNl.disabled = !supported.has('nl');
  btnEn.disabled = !supported.has('en-GB');

  return {
    el: langSegWrapper,
    syncLangUi,
    translateOtherLanguage: () => translateOtherLanguage({ onStatus: toastStatus }),
    translateMissingForActive: () =>
      translateMissingForActive({ onStatus: toastStatus }),
    canTranslate: () => !!otherLang(normalizeLang(pres?.i18n?.active) || 'nl'),
  };
}
