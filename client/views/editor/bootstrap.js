import { storage } from '../../lib/storage.js';

export function createSlidesCollapsedPreference({
  storageKey = 'ps:slides-collapsed',
  rootEl = document.documentElement,
  className = 'is-slides-collapsed',
} = {}) {
  const apply = (collapsed) => {
    rootEl.classList.toggle(className, Boolean(collapsed));
  };

  const loadInitial = () => {
    apply(storage.getBool(storageKey, false));
  };

  const set = (collapsed) => {
    storage.setBool(storageKey, collapsed);
    apply(collapsed);
  };

  const clearClass = () => {
    try {
      rootEl.classList.remove(className);
    } catch {
      // ignore
    }
  };

  return { loadInitial, set, clearClass };
}

export function createPreviewCollapsedPreference({
  storageKey = 'ps:preview-collapsed',
  rootEl = document.documentElement,
  className = 'is-preview-collapsed',
} = {}) {
  const apply = (collapsed) => {
    rootEl.classList.toggle(className, Boolean(collapsed));
  };

  const loadInitial = () => {
    apply(storage.getBool(storageKey, false));
  };

  const set = (collapsed) => {
    storage.setBool(storageKey, collapsed);
    apply(collapsed);
  };

  const clearClass = () => {
    try {
      rootEl.classList.remove(className);
    } catch {
      // ignore
    }
  };

  return { loadInitial, set, clearClass };
}

export function initNewDeckTitlePromptFlag({ startUrl, id } = {}) {
  const newTitleKey = `ps:new-title:${id}`;
  const newFlag = startUrl?.searchParams?.get?.('new') === '1';
  if (!newFlag) return { newTitleKey, newFlag: false };

  try {
    sessionStorage.setItem(newTitleKey, '1');
    startUrl.searchParams.delete('new');
    history.replaceState(null, '', startUrl.toString());
  } catch {
    // ignore
  }

  return { newTitleKey, newFlag: true };
}

export function initPresentationI18n({ pres, initialLang } = {}) {
  pres.i18n =
    pres.i18n && typeof pres.i18n === 'object' ? pres.i18n : {};
  pres.i18n.versions =
    pres.i18n.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : {};

  if (pres.i18n.active !== 'nl' && pres.i18n.active !== 'en-GB') {
    pres.i18n.active =
      initialLang === 'nl' || initialLang === 'en-GB'
        ? initialLang
        : pres.i18n.dominant === 'nl' || pres.i18n.dominant === 'en-GB'
        ? pres.i18n.dominant
        : 'nl';
  }
  if (pres.i18n.dominant !== 'nl' && pres.i18n.dominant !== 'en-GB') {
    pres.i18n.dominant = pres.i18n.active;
  }

  // Single source of truth: one "language mode" for both edit & present.
  pres.i18n.dominant = pres.i18n.active;

  // Ensure the active version exists and references the current editable buffers.
  if (!pres.i18n.versions[pres.i18n.active]) {
    pres.i18n.versions[pres.i18n.active] = {
      title: pres.title,
      slides: pres.slides,
    };
  } else {
    pres.i18n.versions[pres.i18n.active].title = pres.title;
    pres.i18n.versions[pres.i18n.active].slides = pres.slides;
  }
  if (!pres.i18n.versions[pres.i18n.dominant]) {
    pres.i18n.versions[pres.i18n.dominant] = {
      title: pres.title,
      slides: pres.slides,
    };
  }
}

export function normalizeSlideNotes(pres) {
  // Back-compat: notes are optional; normalize to empty string
  for (const s of pres?.slides || []) {
    if (!s || typeof s !== 'object') continue;
    if (typeof s.notes !== 'string') s.notes = '';
  }
}

export async function loadSlideTypes({ api, LOCAL_SLIDE_TYPES } = {}) {
  try {
    return await api('/api/slide-types');
  } catch {
    // Back-compat fallback (older server).
    return Object.fromEntries(
      Object.entries(LOCAL_SLIDE_TYPES).map(([k, v]) => [
        k,
        {
          label: v.label,
          fields: v.fields,
          defaults: v.defaults,
        },
      ])
    );
  }
}

export async function loadEditorAssets({ api } = {}) {
  const normalizeUrlList = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((x) => {
        if (typeof x === 'string') return x;
        if (x && typeof x === 'object' && typeof x.url === 'string')
          return x.url;
        return '';
      })
      .map((s) => String(s || '').trim())
      .filter(Boolean);

  let PARTNER_LOGOS = [];
  try {
    const resp = await api('/api/assets/partnerlogos');
    PARTNER_LOGOS = normalizeUrlList(resp?.logos);
  } catch {
    PARTNER_LOGOS = [];
  }

  let BACKGROUNDS = [];
  try {
    const resp = await api('/api/assets/backgrounds');
    BACKGROUNDS = normalizeUrlList(resp?.backgrounds);
  } catch {
    BACKGROUNDS = [];
  }

  return { PARTNER_LOGOS, BACKGROUNDS };
}

export function createNotesSessionEnsurer({ api, presentationId } = {}) {
  let notesSessionId = null;
  let notesSessionInFlight = null;

  const ensureNotesSession = async () => {
    if (notesSessionId) return notesSessionId;
    if (notesSessionInFlight) return notesSessionInFlight;
    notesSessionInFlight = (async () => {
      const created = await api('/api/present-sessions', {
        method: 'POST',
        body: JSON.stringify({ presentationId }),
      });
      const sid = created?.sessionId;
      if (!sid) throw new Error('No sessionId');
      notesSessionId = sid;
      return sid;
    })();
    try {
      return await notesSessionInFlight;
    } finally {
      notesSessionInFlight = null;
    }
  };

  return {
    ensureNotesSession,
    getNotesSessionId: () => notesSessionId,
  };
}
