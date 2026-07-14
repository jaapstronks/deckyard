import { SLIDE_TYPES as LOCAL_SLIDE_TYPES } from '../../../shared/slide-schemas.js';
import { api as defaultApi } from '../../lib/api.js';
import { loadThemeById } from '../../lib/theme.js';
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
} = {}) {
  if (!id) throw new Error('loadEditorModel: id is required');

  const url = startUrl || new URL(location.href);
  const initialLang = url.searchParams.get('lang');
  const langParam =
    initialLang === 'nl' || initialLang === 'en-GB'
      ? `?lang=${encodeURIComponent(initialLang)}`
      : '';

  const pres = await api(`/api/presentations/${id}${langParam}`);
  const theme = await loadThemeById(pres?.theme);

  const { newTitleKey } = initNewDeckTitlePromptFlag({
    startUrl: url,
    id,
  });
  initPresentationI18n({ pres, initialLang });
  normalizeSlideNotes(pres);

  // Load slide type meta from server so the editor UI can't get out of sync with validation.
  const SLIDE_TYPES = await loadSlideTypes({
    api,
    LOCAL_SLIDE_TYPES,
  });
  const { PARTNER_LOGOS, BACKGROUNDS } = await loadEditorAssets({ api });

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
