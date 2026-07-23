/**
 * Preferences Tab Component
 * UI locale + language mode + user notifications
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import {
  defaultLang,
  getSupportedLangs,
  readLangMode,
  writeLangMode,
} from '../../../lib/format/i18n.js';
import {
  fetchUiLocaleManifest,
  getUiLocale,
  setUiLocale,
} from '../../../lib/ui-i18n.js';
import {
  fetchAppSettings,
  fetchMySettings,
  invalidateSettingsCache,
  updateMySettings,
} from '../../../lib/net/settings.js';
import { getLangShortLabel, getLangDisplayName } from '../../../lib/format/lang-selector.js';
import { createUserNotificationsSection } from '../sections/index.js';
import { disableForSandbox } from '../sandbox-disable.js';
import { createColorPicker } from '../theme-editor/color-picker.js';

/**
 * Create the preferences tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @param {Function} options.nav - Navigation function
 * @returns {Object} { el, load }
 */
export function createPreferencesTab({ user, nav }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-preferences',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-preferences-btn',
    'data-tab': 'preferences',
  });

  const title = h('h2', {
    class: 'settings-tab-title',
    text: t('settings.tabs.preferences', 'Preferences'),
  });

  // UI Locale card
  const uiLocaleCard = h('div', { class: 'stack editor-card' });
  uiLocaleCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.uiLocale.title', 'Application language'),
    })
  );
  const uiLocaleSelect = h('select', { class: 'form-input settings-compact-control' });
  const uiLocaleHint = h('div', {
    class: 'help',
    text: t(
      'settings.uiLocale.hint',
      "The language of this application's interface, unrelated to the language used in slides."
    ),
  });
  uiLocaleCard.append(uiLocaleSelect, uiLocaleHint);

  // Language mode card
  const langCard = h('div', { class: 'stack editor-card' });
  langCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.slideLangMode.title', 'Slides language mode'),
    })
  );
  let langMode = readLangMode();
  let langControlEl = null;
  let langButtons = {};
  let useDropdownForLang = false;

  // Create language selector (will be rebuilt when supported langs are loaded)
  const langControlWrap = h('div', {
    title: t(
      'settings.slideLangMode.titleHint',
      'Language mode (default for new presentations and AI)'
    ),
  });

  const syncLangUi = () => {
    if (useDropdownForLang && langControlEl?.tagName === 'SELECT') {
      langControlEl.value = langMode;
    } else {
      for (const [code, btn] of Object.entries(langButtons)) {
        btn.classList.toggle('is-active', langMode === code);
        btn.setAttribute('aria-pressed', langMode === code ? 'true' : 'false');
      }
    }
  };

  const buildLangControl = (supportedList) => {
    langControlWrap.innerHTML = '';
    langButtons = {};
    const langs = Array.isArray(supportedList) && supportedList.length > 0
      ? supportedList
      : ['nl', 'en-GB'];

    useDropdownForLang = langs.length > 2;

    if (langs.length < 2) {
      langControlWrap.style.display = 'none';
      return;
    }
    langControlWrap.style.display = '';

    if (useDropdownForLang) {
      langControlEl = h('select', { class: 'form-input' });
      for (const code of langs) {
        const option = h('option', {
          value: code,
          text: getLangDisplayName(code),
        });
        langControlEl.append(option);
      }
      langControlEl.value = langMode;
      langControlEl.addEventListener('change', () => {
        langMode = langControlEl.value;
        syncLangUi();
      });
      langControlWrap.append(langControlEl);
    } else {
      const langSeg = h('div', { class: 'sb-segmented is-toggle' });
      for (const code of langs) {
        const btn = h('button', {
          class: 'sb-segmented-btn',
          type: 'button',
          text: getLangShortLabel(code),
          onclick: () => {
            langMode = code;
            syncLangUi();
          },
        });
        langButtons[code] = btn;
        langSeg.append(btn);
      }
      langControlEl = langSeg;
      langControlWrap.append(langSeg);
    }
    syncLangUi();
  };

  // Initialize with default langs
  buildLangControl(getSupportedLangs());

  const langHint = h('div', {
    class: 'help',
    text: t(
      'settings.slideLangMode.hint',
      'Used for the editor\'s "language mode", AI output, and slide translation tools.'
    ),
  });
  langCard.append(langControlWrap, langHint);

  // User notification preferences
  const userNotifications = createUserNotificationsSection({ h });

  // Privacy settings card
  const privacyCard = h('div', { class: 'stack editor-card' });
  privacyCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.privacy.title', 'Privacy'),
    })
  );
  const privacyHint = h('div', {
    class: 'help',
    text: t(
      'settings.privacy.hint',
      'Control how your engagement is tracked when viewing presentations.'
    ),
  });

  // Allow view attribution toggle
  const allowAttributionCheck = h('input', { type: 'checkbox' });
  const allowAttributionLabel = h('label', { class: 'admin-checkbox-item' }, [
    allowAttributionCheck,
    h('span', { text: t('settings.privacy.allowAttribution', 'Allow my name to be shown in engagement insights') }),
  ]);
  const allowAttributionHint = h('div', {
    class: 'help',
    text: t(
      'settings.privacy.allowAttributionHint',
      'When enabled, presenters can see your name instead of just "team member viewed".'
    ),
  });

  // Disable all tracking toggle
  const disableTrackingCheck = h('input', { type: 'checkbox' });
  const disableTrackingLabel = h('label', { class: 'admin-checkbox-item' }, [
    disableTrackingCheck,
    h('span', { text: t('settings.privacy.disableTracking', 'Opt out of all engagement tracking') }),
  ]);
  const disableTrackingHint = h('div', {
    class: 'help',
    text: t(
      'settings.privacy.disableTrackingHint',
      'When enabled, your views will not be recorded in any analytics.'
    ),
  });

  const privacyOptions = h('div', { class: 'stack gap-2' }, [
    allowAttributionLabel,
    allowAttributionHint,
    disableTrackingLabel,
    disableTrackingHint,
  ]);
  privacyCard.append(privacyHint, privacyOptions);

  // Weekly digest settings card
  const digestCard = h('div', { class: 'stack editor-card' });
  digestCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.digest.title', 'Weekly Digest'),
    })
  );
  const digestHint = h('div', {
    class: 'help',
    text: t(
      'settings.digest.hint',
      'Receive a weekly email summary of your presentation engagement.'
    ),
  });

  // Digest enabled toggle
  const digestEnabledCheck = h('input', { type: 'checkbox', checked: true });
  const digestEnabledLabel = h('label', { class: 'admin-checkbox-item' }, [
    digestEnabledCheck,
    h('span', { text: t('settings.digest.enabled', 'Send weekly engagement digest') }),
  ]);

  // Digest day of week
  const digestDaySelect = h('select', { class: 'select', 'aria-label': t('settings.digest.dayOfWeek', 'Send digest on') }, [
    h('option', { value: '0', text: t('settings.digest.dayOfWeek.0', 'Sunday') }),
    h('option', { value: '1', text: t('settings.digest.dayOfWeek.1', 'Monday') }),
    h('option', { value: '2', text: t('settings.digest.dayOfWeek.2', 'Tuesday') }),
    h('option', { value: '3', text: t('settings.digest.dayOfWeek.3', 'Wednesday') }),
    h('option', { value: '4', text: t('settings.digest.dayOfWeek.4', 'Thursday') }),
    h('option', { value: '5', text: t('settings.digest.dayOfWeek.5', 'Friday') }),
    h('option', { value: '6', text: t('settings.digest.dayOfWeek.6', 'Saturday') }),
  ]);
  digestDaySelect.value = '1'; // Default to Monday
  const digestDayField = h('label', { class: 'field-row' }, [
    h('span', { class: 'field-row-label', text: t('settings.digest.dayOfWeek', 'Send digest on') }),
    digestDaySelect,
  ]);

  // Include team analytics toggle
  const digestTeamCheck = h('input', { type: 'checkbox', checked: true });
  const digestTeamLabel = h('label', { class: 'admin-checkbox-item' }, [
    digestTeamCheck,
    h('span', { text: t('settings.digest.includeTeam', 'Include team engagement statistics') }),
  ]);

  const digestOptions = h('div', { class: 'stack gap-2' }, [
    digestEnabledLabel,
    digestDayField,
    digestTeamLabel,
  ]);
  digestCard.append(digestHint, digestOptions);

  // Highlighter settings card
  const highlighterCard = h('div', { class: 'stack editor-card' });
  highlighterCard.append(
    h('div', {
      class: 'field-label',
      text: t('settings.highlighter.title', 'Presenter Highlighter'),
    })
  );
  const highlighterHint = h('div', {
    class: 'help',
    text: t(
      'settings.highlighter.hint',
      'Customize the laser pointer and drawing tool colors and thickness.'
    ),
  });

  // Color picker
  const highlighterColorPicker = createColorPicker({
    label: t('settings.highlighter.color', 'Color'),
    value: '#ef4444',
    onChange: () => {},
  });

  // Thickness slider
  const thicknessLabel = h('label', { class: 'field-row' }, [
    h('span', { class: 'field-row-label', text: t('settings.highlighter.thickness', 'Thickness') }),
  ]);
  const thicknessValue = h('span', {
    class: 'settings-thickness-value',
    text: '4',
    style: 'min-width: 24px; text-align: right; font-variant-numeric: tabular-nums;',
  });
  const thicknessSlider = h('input', {
    type: 'range',
    min: '1',
    max: '10',
    step: '1',
    value: '4',
    class: 'form-range',
    style: 'flex: 1;',
    oninput: (e) => {
      thicknessValue.textContent = e.target.value;
    },
  });
  const thicknessRow = h('div', {
    class: 'row gap-2',
    style: 'align-items: center;',
  }, [thicknessSlider, thicknessValue]);
  thicknessLabel.append(thicknessRow);

  // Persistent draw toggle
  const persistentDrawCheck = h('input', { type: 'checkbox' });
  const persistentDrawLabel = h('label', { class: 'admin-checkbox-item' }, [
    persistentDrawCheck,
    h('span', { text: t('settings.highlighter.persistentDraw', 'Keep drawings visible until cleared') }),
  ]);
  const persistentDrawHint = h('div', {
    class: 'help',
    text: t(
      'settings.highlighter.persistentDrawHint',
      'Drawings stay on screen until you press C to clear or move to the next slide.'
    ),
  });

  const highlighterOptions = h('div', { class: 'stack gap-3' }, [
    highlighterColorPicker.el,
    thicknessLabel,
    h('div', { class: 'stack gap-1' }, [persistentDrawLabel, persistentDrawHint]),
  ]);
  highlighterCard.append(highlighterHint, highlighterOptions);

  // Save button
  const actions = h('div', { class: 'row is-end', style: 'margin-top: var(--ps-space-4);' });
  const btnSave = h('button', {
    class: 'btn btn-primary',
    text: t('common.save', 'Save'),
  });
  actions.append(btnSave);

  const cards = h('div', { class: 'settings-tab-cards' }, [
    uiLocaleCard,
    langCard,
    userNotifications.element,
    privacyCard,
    digestCard,
    highlighterCard,
  ]);

  container.append(title, cards, actions);

  // The weekly analytics digest emails a summary, which a sandbox guest (no
  // account, no email, throwaway decks) can't receive — grey it out with a
  // note, matching the notifications section. (Notifications itself is greyed
  // inside its own component.)
  disableForSandbox({
    content: digestCard,
    message: t(
      'sandbox.settings.digest',
      'The weekly digest is off in the sandbox — there’s no account to email. In your own Deckyard, get a weekly summary of how your decks are performing.'
    ),
  });

  let busy = false;
  let loaded = false;

  const applySupportedUi = (supportedList) => {
    const supported = new Set(Array.isArray(supportedList) ? supportedList : []);
    const supportedArr = Array.isArray(supportedList) ? supportedList : [];

    // Ensure langMode is valid for the supported set
    if (!supported.has(langMode)) {
      langMode = supportedArr[0] || defaultLang();
    }

    // Rebuild the language control with the new supported languages
    buildLangControl(supportedArr);
  };

  const setBusy = (v) => {
    busy = v;
    btnSave.disabled = busy;
    uiLocaleSelect.disabled = busy;
    // Disable language control
    if (useDropdownForLang && langControlEl?.tagName === 'SELECT') {
      langControlEl.disabled = busy;
    } else {
      for (const btn of Object.values(langButtons)) {
        btn.disabled = busy;
      }
    }
    userNotifications.setDisabled(busy);
    // Disable privacy controls
    allowAttributionCheck.disabled = busy;
    disableTrackingCheck.disabled = busy;
    // Disable digest controls
    digestEnabledCheck.disabled = busy;
    digestDaySelect.disabled = busy;
    digestTeamCheck.disabled = busy;
    // Disable highlighter controls
    thicknessSlider.disabled = busy;
    persistentDrawCheck.disabled = busy;
  };

  const load = async () => {
    if (loaded) return;
    loaded = true;

    try {
      const [my, app] = await Promise.all([fetchMySettings(), fetchAppSettings()]);
      if (typeof my?.uiLang === 'string') langMode = my.uiLang;
      const myUiLocale =
        typeof my?.uiLocale === 'string' ? my.uiLocale : getUiLocale();

      const supportedSlideLangs = Array.isArray(app?.supportedSlideLangs)
        ? app.supportedSlideLangs
        : getSupportedLangs();
      applySupportedUi(supportedSlideLangs);

      // User notification preferences (default to true if not set)
      const myNotif = my?.notifications && typeof my.notifications === 'object'
        ? my.notifications
        : {};
      userNotifications.setValues(myNotif);

      // Privacy settings
      const myPrivacy = my?.privacy && typeof my.privacy === 'object'
        ? my.privacy
        : {};
      allowAttributionCheck.checked = myPrivacy?.allowViewAttribution === true;
      disableTrackingCheck.checked = myPrivacy?.disableAllTracking === true;

      // Digest settings
      const myDigest = my?.digest && typeof my.digest === 'object'
        ? my.digest
        : {};
      digestEnabledCheck.checked = myDigest?.enabled !== false;
      digestDaySelect.value = String(myDigest?.dayOfWeek ?? 1);
      digestTeamCheck.checked = myDigest?.includeTeamAnalytics !== false;

      // Highlighter settings
      const myHighlighter = my?.highlighter && typeof my.highlighter === 'object'
        ? my.highlighter
        : {};
      highlighterColorPicker.setValue(myHighlighter?.color || '#ef4444');
      const thickness = parseInt(myHighlighter?.thickness, 10) || 4;
      thicknessSlider.value = String(thickness);
      thicknessValue.textContent = String(thickness);
      persistentDrawCheck.checked = myHighlighter?.persistentDraw === true;

      // UI locale selector options
      const manifest = await fetchUiLocaleManifest();
      const locales = Array.isArray(manifest?.locales) ? manifest.locales : [];
      uiLocaleSelect.innerHTML = '';
      if (!locales.length) {
        uiLocaleSelect.append(
          h('option', { value: 'en', text: 'English', selected: myUiLocale === 'en' }),
          h('option', { value: 'nl', text: 'Nederlands', selected: myUiLocale === 'nl' })
        );
      } else {
        for (const l of locales) {
          const id = String(l?.id || '').trim();
          const label = String(l?.label || '').trim();
          if (!id || !label) continue;
          const isSelected = id === myUiLocale;
          uiLocaleSelect.append(h('option', { value: id, text: label, selected: isSelected }));
        }
      }
      // Also set via property for browser compatibility
      uiLocaleSelect.value = String(myUiLocale || 'en');
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-load' });
    }
  };

  btnSave.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Use selectedOptions for more reliable value reading across browsers
      const selectedOption = uiLocaleSelect.selectedOptions?.[0];
      const uiLocale = String(selectedOption?.value || uiLocaleSelect.value || '').trim() || 'en';
      const userNotifValues = userNotifications.getValues();
      const updatedMe = await updateMySettings({
        uiLocale,
        uiLang: langMode,
        notifications: userNotifValues,
        privacy: {
          allowViewAttribution: allowAttributionCheck.checked,
          disableAllTracking: disableTrackingCheck.checked,
        },
        digest: {
          enabled: digestEnabledCheck.checked,
          dayOfWeek: parseInt(digestDaySelect.value, 10) || 1,
          includeTeamAnalytics: digestTeamCheck.checked,
        },
        highlighter: {
          color: highlighterColorPicker.getValue(),
          thickness: parseInt(thicknessSlider.value, 10) || 4,
          persistentDraw: persistentDrawCheck.checked,
        },
      });

      // Keep local language mode in sync with saved settings (and supported set).
      if (typeof updatedMe?.uiLang === 'string') writeLangMode(updatedMe.uiLang);
      else writeLangMode(defaultLang());

      invalidateSettingsCache();
      toast.success(t('settings.saved', 'Saved.'), {
        id: 'settings-save',
        durationMs: 1800,
      });

      // Apply locale immediately - use the saved value from server or fallback to what user selected
      const finalLocale = typeof updatedMe?.uiLocale === 'string' ? updatedMe.uiLocale : uiLocale;
      await setUiLocale(finalLocale);

      // Re-render current route (important if UI locale changed).
      nav?.(location.pathname + (location.search || '') + (location.hash || ''));
    } catch (e) {
      toast.error(String(e?.message || e), { id: 'settings-save' });
    } finally {
      setBusy(false);
    }
  });

  syncLangUi();

  return {
    el: container,
    load,
  };
}