import { SLIDE_TYPES as LOCAL_SLIDE_TYPES } from '../../../shared/slide-schemas.js';
import { api as defaultApi } from '../../lib/api.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import {
  initNewDeckTitlePromptFlag,
  initPresentationI18n,
  loadEditorAssets,
  loadSlideTypes,
  normalizeSlideNotes,
} from './bootstrap.js';

export async function loadEditorModel({
  id,
  api = defaultApi,
  startUrl = null,
  initialPres = null,
} = {}) {
  if (!id) throw new Error('loadEditorModel: id is required');

  const url = startUrl || new URL(location.href);
  const initialLang = url.searchParams.get('lang');
  const langParam =
    initialLang === 'nl' || initialLang === 'en-GB'
      ? `?lang=${encodeURIComponent(initialLang)}`
      : '';

  // The route handler already fetched the presentation for its permission
  // check (same id + lang): accept it via initialPres so long decks aren't
  // downloaded twice back-to-back.
  const pres =
    initialPres || (await api(`/api/presentations/${id}${langParam}`));

  // Theme, slide-type meta and editor assets don't depend on each other.
  const [theme, SLIDE_TYPES, { PARTNER_LOGOS, BACKGROUNDS }] =
    await Promise.all([
      loadThemeById(pres?.theme),
      // Load slide type meta from server so the editor UI can't get out of
      // sync with validation.
      loadSlideTypes({ api, LOCAL_SLIDE_TYPES }),
      loadEditorAssets({ api }),
    ]);

  const { newTitleKey } = initNewDeckTitlePromptFlag({
    startUrl: url,
    id,
  });
  initPresentationI18n({ pres, initialLang });
  normalizeSlideNotes(pres);

  return {
    startUrl: url,
    initialLang,
    pres,
    theme,
    SLIDE_TYPES,
    PARTNER_LOGOS,
    BACKGROUNDS,
    newTitleKey,
  };
}
