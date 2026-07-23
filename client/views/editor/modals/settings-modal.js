import { createModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { createTagEditor } from '../../list/tag-editor.js';
import { createAndPopulateThemeSelect } from '../../../lib/theme/theme-select.js';
import { analyzeAndApplyThemeChange } from './change-theme-modal.js';
import {
  detectStreamProvider,
  POSITION_PRESET_LABELS,
  MOBILE_POSITIONS,
} from '../../../../shared/video-stream-providers.js';
import { calculateDeckTime, DEFAULT_ADVANCE_INTERVAL_SECONDS } from '../../../../shared/slide-timing.js';
import {
  REVEAL_STYLES,
  DEFAULT_REVEAL_STYLE,
  normalizeRevealStyle,
} from '../../../../shared/reveal-style.js';

export function openSettingsModal({
  h,
  root,
  pres,
  api,
  openOverlayClosers,
  markDirty,
  requestSave,
  toast,
  onThemeChanged,
  onNavigateToSlide,
} = {}) {
  const modal = createModal(h, {
    title: t('editor.deckSettings.title', 'Deck settings'),
  });

  // Normalize settings
  pres.settings =
    pres.settings && typeof pres.settings === 'object'
      ? pres.settings
      : {};
  pres.settings.stepParagraphs =
    !!pres.settings.stepParagraphs;
  pres.settings.revealStyle =
    normalizeRevealStyle(pres.settings.revealStyle) || DEFAULT_REVEAL_STYLE;
  pres.settings.transitions =
    pres.settings.transitions &&
    typeof pres.settings.transitions === 'object'
      ? pres.settings.transitions
      : {};
  const presetRaw = String(
    pres.settings.transitions.preset || ''
  ).trim();
  const allowedTransitionPresets = new Set([
    'none',
    'fade',
    'slide',
    'push',
    'morph',
    'cube',
  ]);
  const preset = allowedTransitionPresets.has(presetRaw)
    ? presetRaw
    : 'none';
  pres.settings.transitions.preset = preset;

  // OG Preview settings
  pres.settings.ogPreview =
    pres.settings.ogPreview &&
    typeof pres.settings.ogPreview === 'object'
      ? pres.settings.ogPreview
      : {};
  pres.settings.ogPreview.showAuthor =
    !!pres.settings.ogPreview.showAuthor;

  // Deck-level language hint
  const allowedLangs = new Set(['nl', 'en-GB']);
  const presLang = allowedLangs.has(
    String(pres?.lang || '').trim()
  )
    ? String(pres.lang).trim()
    : 'nl';
  pres.lang = presLang;

  // Deck description
  if (typeof pres.description !== 'string')
    pres.description = '';

  // Analytics options
  pres.settings.analyticsOptions =
    pres.settings.analyticsOptions &&
    typeof pres.settings.analyticsOptions === 'object'
      ? pres.settings.analyticsOptions
      : {};
  pres.settings.analyticsOptions.trackTeamViews =
    pres.settings.analyticsOptions.trackTeamViews !== false;
  pres.settings.analyticsOptions.showDetailedTeamAnalytics =
    !!pres.settings.analyticsOptions.showDetailedTeamAnalytics;

  // Live video settings
  pres.settings.liveVideo =
    pres.settings.liveVideo &&
    typeof pres.settings.liveVideo === 'object'
      ? pres.settings.liveVideo
      : {};
  pres.settings.liveVideo.enabled = !!pres.settings.liveVideo.enabled;
  pres.settings.liveVideo.streamUrl = String(pres.settings.liveVideo.streamUrl || '');
  pres.settings.liveVideo.provider = String(pres.settings.liveVideo.provider || '');
  pres.settings.liveVideo.defaultPosition = String(pres.settings.liveVideo.defaultPosition || 'pip-top-right');
  pres.settings.liveVideo.mobilePosition = String(pres.settings.liveVideo.mobilePosition || 'bottom');

  // Auto-advance settings
  pres.settings.autoAdvance =
    pres.settings.autoAdvance &&
    typeof pres.settings.autoAdvance === 'object'
      ? pres.settings.autoAdvance
      : {};
  pres.settings.autoAdvance.enabled = !!pres.settings.autoAdvance.enabled;
  pres.settings.autoAdvance.intervalSeconds =
    Number(pres.settings.autoAdvance.intervalSeconds) || DEFAULT_ADVANCE_INTERVAL_SECONDS;
  pres.settings.autoAdvance.loop = !!pres.settings.autoAdvance.loop;
  pres.settings.autoAdvance.showCountdown =
    pres.settings.autoAdvance.showCountdown !== false;
  pres.settings.autoAdvance.mode =
    pres.settings.autoAdvance.mode === 'pacing' ? 'pacing' : 'auto';
  pres.settings.autoAdvance.strict = !!pres.settings.autoAdvance.strict;

  // Q&A setting
  const qaRow = h('label', {
    class: 'row is-start editor-callout',
  });
  const qaCb = h('input', { type: 'checkbox' });
  qaCb.checked = pres.settings.qaEnabled !== false;
  const qaText = h('div', { class: 'stack is-gap-xs' }, [
    h('div', {
      class: 'field-label',
      text: t('editor.deckSettings.qa.title', 'Enable Q&A'),
    }),
    h('div', {
      class: 'help',
      text: t(
        'editor.deckSettings.qa.help',
        "When disabled, Q&A is hidden in follow-along (participants can't ask questions)."
      ),
    }),
  ]);
  qaRow.append(qaCb, qaText);
  qaCb.addEventListener('change', () => {
    pres.settings.qaEnabled = !!qaCb.checked;
    markDirty?.();
    requestSave?.();
  });

  // Builds (step paragraphs) setting
  const buildsRow = h('label', {
    class: 'row is-start editor-callout',
  });
  const buildsCb = h('input', { type: 'checkbox' });
  buildsCb.checked = !!pres.settings.stepParagraphs;
  const buildsText = h('div', { class: 'stack is-gap-xs' }, [
    h('div', {
      class: 'field-label',
      text: t('editor.deckSettings.builds.title', 'Builds'),
    }),
    h('div', {
      class: 'help',
      text: t(
        'editor.deckSettings.builds.help',
        'Reveal content step-by-step while presenting. Use ←/→ or space to advance.'
      ),
    }),
  ]);
  buildsRow.append(buildsCb, buildsText);
  buildsCb.addEventListener('change', () => {
    pres.settings.stepParagraphs = !!buildsCb.checked;
    markDirty?.();
    requestSave?.();
  });

  // Reveal style for builds: how each body fragment (bullet/paragraph) appears.
  const revealStyleWrap = h('div', { class: 'stack editor-callout' });
  const revealStyleLabel = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.revealStyle.title', 'Reveal style'),
  });
  const revealStyleHelp = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.revealStyle.help',
      'How each bullet appears when builds are on. Typewriter types text in character-by-character. Presenter only; falls back to instant with reduced motion.'
    ),
  });
  const REVEAL_STYLE_LABELS = {
    default: t('editor.deckSettings.revealStyle.default', 'Instant'),
    typewriter: t('editor.deckSettings.revealStyle.typewriter', 'Typewriter'),
  };
  const revealStyleSel = h('select', { class: 'form-input' });
  for (const style of REVEAL_STYLES) {
    revealStyleSel.append(
      h('option', { value: style, text: REVEAL_STYLE_LABELS[style] || style })
    );
  }
  revealStyleSel.value = pres.settings.revealStyle;
  revealStyleSel.addEventListener('change', () => {
    pres.settings.revealStyle =
      normalizeRevealStyle(revealStyleSel.value) || DEFAULT_REVEAL_STYLE;
    markDirty?.();
    requestSave?.();
  });
  revealStyleWrap.append(revealStyleLabel, revealStyleSel, revealStyleHelp);

  // Theme setting
  const themeWrap = h('div', { class: 'stack editor-callout' });
  const themeLabel = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.theme.title', 'Theme'),
  });
  const themeHelp = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.theme.help',
      'Visual styling for your presentation. Changing themes may affect some slides.'
    ),
  });

  // Theme selector
  let themeSelect = null;
  if (api) {
    const currentTheme = String(pres.themeId || 'deckyard').trim();
    const themeSelector = createAndPopulateThemeSelect({
      h,
      api,
      initialTheme: currentTheme,
      className: '',
      onChange: async (newThemeId) => {
        if (newThemeId === currentTheme) return;

        // Analyze and apply theme change
        const result = await analyzeAndApplyThemeChange({
          h,
          root,
          api,
          toast,
          pres,
          presId: pres.id,
          newThemeId,
          openOverlayClosers,
          onNavigateToSlide: (slideIndex) => {
            modal.close();
            onNavigateToSlide?.(slideIndex);
          },
          onThemeChanged: (updatedPres) => {
            // Update the local pres object
            pres.themeId = updatedPres.themeId;
            if (Array.isArray(updatedPres.slides)) {
              pres.slides = updatedPres.slides;
            }
            modal.close();
            onThemeChanged?.(updatedPres);
          },
        });

        // If cancelled or same theme, reset selector to current value
        if (!result?.ok) {
          themeSelector.setTheme(pres.themeId || 'deckyard');
        }
      },
    });
    themeSelect = themeSelector.select;
    themeWrap.append(themeLabel, themeSelect, themeHelp);
  } else {
    // If no API, show a disabled message
    themeWrap.append(
      themeLabel,
      h('div', {
        class: 'help',
        text: t('editor.deckSettings.theme.unavailable', 'Theme selection is not available.'),
      })
    );
  }

  // Show author on preview image setting
  const authorPreviewRow = h('label', {
    class: 'row is-start editor-callout',
  });
  const authorPreviewCb = h('input', { type: 'checkbox' });
  authorPreviewCb.checked = !!pres.settings.ogPreview.showAuthor;
  const authorPreviewText = h('div', { class: 'stack is-gap-xs' }, [
    h('div', {
      class: 'field-label',
      text: t('editor.deckSettings.authorPreview.title', 'Show author on preview'),
    }),
    h('div', {
      class: 'help',
      text: t(
        'editor.deckSettings.authorPreview.help',
        'Display your name and photo on the social media preview image when published.'
      ),
    }),
  ]);
  authorPreviewRow.append(authorPreviewCb, authorPreviewText);
  authorPreviewCb.addEventListener('change', () => {
    pres.settings.ogPreview.showAuthor = !!authorPreviewCb.checked;
    markDirty?.();
    requestSave?.();
  });

  // Transitions setting
  const transWrap = h('div', {
    class: 'stack editor-callout',
  });
  const transLabel = h('div', {
    class: 'field-label',
    text: t(
      'editor.deckSettings.transitions.title',
      'Presenter transition (slide → slide)'
    ),
  });
  const transHelp = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.transitions.help',
      'Presenter only. Editor and follow-along remain static by default.'
    ),
  });
  const transSel = h('select', { class: 'form-input' });
  transSel.append(
    h('option', {
      value: 'none',
      text: t('common.none', 'None'),
    }),
    h('option', {
      value: 'fade',
      text: t('editor.transitions.fade', 'Fade'),
    }),
    h('option', {
      value: 'slide',
      text: t('editor.transitions.slide', 'Slide'),
    }),
    h('option', {
      value: 'push',
      text: t('editor.transitions.push', 'Push'),
    }),
    h('option', {
      value: 'morph',
      text: t('editor.transitions.morph', 'Morph'),
    }),
    h('option', {
      value: 'cube',
      text: t('editor.transitions.cube', '3D (Cube)'),
    })
  );
  transSel.value = preset;
  transSel.addEventListener('change', () => {
    const v = String(transSel.value || '').trim();
    pres.settings.transitions.preset =
      allowedTransitionPresets.has(v) ? v : 'none';
    markDirty?.();
    requestSave?.();
  });
  transWrap.append(transLabel, transSel, transHelp);

  // Language setting
  const langWrap = h('div', {
    class: 'stack editor-callout',
  });
  const langLabel = h('div', {
    class: 'field-label',
    text: t(
      'editor.deckSettings.lang.title',
      'Document language'
    ),
  });
  const langHelp = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.lang.help',
      'Used for public sharing and exports (HTML lang attribute).'
    ),
  });
  const langSel = h('select', { class: 'form-input' });
  langSel.append(
    h('option', { value: 'nl', text: 'Nederlands (nl)' }),
    h('option', { value: 'en-GB', text: 'English (en-GB)' })
  );
  langSel.value = presLang;
  langSel.addEventListener('change', () => {
    const v = String(langSel.value || '').trim();
    pres.lang = allowedLangs.has(v) ? v : 'nl';
    markDirty?.();
    requestSave?.();
  });
  langWrap.append(langLabel, langSel, langHelp);

  // Description setting
  const descWrap = h('div', {
    class: 'stack editor-callout',
  });
  const descLabel = h('div', {
    class: 'field-label',
    text: t(
      'editor.deckSettings.description.title',
      'Description'
    ),
  });
  const descHelp = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.description.help',
      'Used as the public meta description when published. Keep it short (two sentences).'
    ),
  });
  const descTa = h('textarea', {
    class: 'form-input',
    style: 'min-height:96px;',
    placeholder: t(
      'editor.deckSettings.description.placeholder',
      'A short, two-sentence description of this presentation…'
    ),
    value: String(pres.description || ''),
  });
  const descStatus = h('div', { class: 'help', text: '' });
  const syncDescStatus = () => {
    const v = String(descTa.value || '');
    const n = v.length;
    const max = 600;
    descStatus.textContent =
      n > max
        ? t(
            'editor.deckSettings.description.tooLong',
            'Too long ({n}/{max}). Please shorten.',
            {
              n: String(n),
              max: String(max),
            }
          )
        : t(
            'editor.deckSettings.description.count',
            '{n}/{max} characters',
            {
              n: String(n),
              max: String(max),
            }
          );
  };
  syncDescStatus();
  descTa.addEventListener('input', () => {
    pres.description = String(descTa.value || '');
    markDirty?.();
    syncDescStatus();
  });
  descTa.addEventListener('blur', () => {
    requestSave?.();
  });
  descWrap.append(descLabel, descTa, descHelp, descStatus);

  // Tags setting
  const tagsWrap = h('div', {
    class: 'stack editor-callout',
  });
  const tagsLabel = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.tags.title', 'Tags'),
  });
  const tagsHelp = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.tags.help',
      'Add tags to organize and filter presentations. Press Enter or comma to add.'
    ),
  });

  // Always add the label first
  tagsWrap.append(tagsLabel);

  // Initialize tags array if not present
  const initialTags = Array.isArray(pres.tags)
    ? pres.tags.map((tag) => (typeof tag === 'string' ? tag : tag.name))
    : [];

  let tagEditorInstance = null;
  if (api) {
    try {
      tagEditorInstance = createTagEditor({
        api,
        initialTags,
        onChange: async (newTags) => {
          try {
            // Save tags to the server
            await api(`/api/presentations/${pres.id}/tags`, {
              method: 'PUT',
              body: { tags: newTags },
            });
            // Update local state
            pres.tags = newTags.map((name) => ({ name }));
          } catch (err) {
            console.error('Failed to save tags:', err);
          }
        },
      });
      tagsWrap.append(tagEditorInstance.el, tagsHelp);
    } catch (err) {
      console.error('Failed to create tag editor:', err);
      tagsWrap.append(h('div', {
        class: 'help',
        text: t('editor.deckSettings.tags.error', 'Failed to load tag editor.'),
      }));
    }
  } else {
    // If no API, show a disabled message
    tagsWrap.append(h('div', {
      class: 'help',
      text: t('editor.deckSettings.tags.unavailable', 'Tags are not available in this mode.'),
    }));
  }

  // Analytics options section
  const analyticsWrap = h('div', {
    class: 'stack editor-callout',
  });
  const analyticsLabel = h('div', {
    class: 'field-label',
    text: t(
      'editor.deckSettings.analytics.title',
      'Engagement Insights'
    ),
  });
  const analyticsHelp = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.analytics.help',
      'Control how engagement data is collected and displayed for this presentation.'
    ),
  });

  // Track team views checkbox
  const trackTeamCb = h('input', { type: 'checkbox' });
  trackTeamCb.checked = pres.settings.analyticsOptions.trackTeamViews;
  const trackTeamLabel = h('label', {
    class: 'row is-start is-gap-xs',
    style: 'margin-top: var(--ps-space-2);',
  }, [
    trackTeamCb,
    h('span', {
      text: t('editor.deckSettings.analytics.trackTeam', 'Include team member views in analytics'),
    }),
  ]);
  trackTeamCb.addEventListener('change', () => {
    pres.settings.analyticsOptions.trackTeamViews = !!trackTeamCb.checked;
    markDirty?.();
    requestSave?.();
  });

  // Show detailed team analytics checkbox
  const detailedTeamCb = h('input', { type: 'checkbox' });
  detailedTeamCb.checked = pres.settings.analyticsOptions.showDetailedTeamAnalytics;
  const detailedTeamLabel = h('label', {
    class: 'row is-start is-gap-xs',
  }, [
    detailedTeamCb,
    h('span', {
      text: t('editor.deckSettings.analytics.showDetailed', 'Show attributed team viewer names'),
    }),
  ]);
  const detailedTeamHelp = h('div', {
    class: 'help',
    style: 'margin-left: var(--ps-space-5);',
    text: t(
      'editor.deckSettings.analytics.showDetailedHelp',
      'Only shows names of team members who have opted in to attribution.'
    ),
  });
  detailedTeamCb.addEventListener('change', () => {
    pres.settings.analyticsOptions.showDetailedTeamAnalytics = !!detailedTeamCb.checked;
    markDirty?.();
    requestSave?.();
  });

  analyticsWrap.append(
    analyticsLabel,
    analyticsHelp,
    trackTeamLabel,
    detailedTeamLabel,
    detailedTeamHelp
  );

  // Live Video section
  const liveVideoWrap = h('div', { class: 'stack editor-callout' });
  const liveVideoLabel = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.liveVideo.title', 'Live Video'),
  });

  // Enable toggle
  const liveVideoEnableRow = h('label', {
    class: 'row is-start is-gap-xs',
    style: 'margin-top: var(--ps-space-2);',
  });
  const liveVideoCb = h('input', { type: 'checkbox' });
  liveVideoCb.checked = pres.settings.liveVideo.enabled;
  liveVideoEnableRow.append(
    liveVideoCb,
    h('span', {
      text: t('editor.deckSettings.liveVideo.enable', 'Enable video overlay'),
    })
  );
  liveVideoCb.addEventListener('change', () => {
    pres.settings.liveVideo.enabled = !!liveVideoCb.checked;
    liveVideoFields.style.display = liveVideoCb.checked ? '' : 'none';
    markDirty?.();
    requestSave?.();
  });

  // Fields container (hidden when disabled)
  const liveVideoFields = h('div', {
    class: 'stack is-gap-xs',
    style: liveVideoCb.checked ? '' : 'display:none;',
  });

  // Stream URL input
  const urlLabel = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.liveVideo.urlHelp',
      'Paste a YouTube Live, Vimeo, Bunny, Mux, Cloudflare, or HLS stream URL.'
    ),
  });
  const urlInput = h('input', {
    type: 'url',
    class: 'form-input',
    placeholder: 'https://www.youtube.com/watch?v=...',
    value: pres.settings.liveVideo.streamUrl,
  });
  const providerHint = h('div', {
    class: 'help',
    text: '',
  });
  const syncProviderHint = () => {
    const url = String(urlInput.value || '').trim();
    const prov = url ? detectStreamProvider(url) : null;
    if (prov) {
      pres.settings.liveVideo.provider = prov;
      providerHint.textContent = t(
        'editor.deckSettings.liveVideo.detected',
        'Detected: {provider}',
        { provider: prov }
      );
    } else if (url) {
      pres.settings.liveVideo.provider = '';
      providerHint.textContent = t(
        'editor.deckSettings.liveVideo.unrecognized',
        'Unrecognized URL. Supported: YouTube, Vimeo, Bunny, Mux, Cloudflare, .m3u8'
      );
    } else {
      pres.settings.liveVideo.provider = '';
      providerHint.textContent = '';
    }
  };
  syncProviderHint();
  urlInput.addEventListener('input', () => {
    pres.settings.liveVideo.streamUrl = String(urlInput.value || '').trim();
    syncProviderHint();
    markDirty?.();
  });
  urlInput.addEventListener('blur', () => {
    requestSave?.();
  });

  // Default position preset
  const posLabel = h('div', {
    class: 'help',
    text: t('editor.deckSettings.liveVideo.position', 'Default position'),
  });
  const posSel = h('select', { class: 'form-input' });
  for (const [value, label] of Object.entries(POSITION_PRESET_LABELS)) {
    posSel.append(h('option', { value, text: label }));
  }
  posSel.value = pres.settings.liveVideo.defaultPosition;
  posSel.addEventListener('change', () => {
    pres.settings.liveVideo.defaultPosition = String(posSel.value || 'pip-top-right');
    markDirty?.();
    requestSave?.();
  });

  // Mobile position
  const mobilePosLabel = h('div', {
    class: 'help',
    text: t('editor.deckSettings.liveVideo.mobilePosition', 'Mobile position'),
  });
  const mobilePosSel = h('select', { class: 'form-input' });
  for (const [value, label] of Object.entries(MOBILE_POSITIONS)) {
    mobilePosSel.append(h('option', { value, text: label }));
  }
  mobilePosSel.value = pres.settings.liveVideo.mobilePosition;
  mobilePosSel.addEventListener('change', () => {
    pres.settings.liveVideo.mobilePosition = String(mobilePosSel.value || 'bottom');
    markDirty?.();
    requestSave?.();
  });

  liveVideoFields.append(urlLabel, urlInput, providerHint, posLabel, posSel, mobilePosLabel, mobilePosSel);
  liveVideoWrap.append(liveVideoLabel, liveVideoEnableRow, liveVideoFields);

  // Auto-advance section
  const autoAdvanceWrap = h('div', { class: 'stack editor-callout' });
  const autoAdvanceLabel = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.autoAdvance.title', 'Auto-advance'),
  });

  // Enable toggle
  const autoAdvanceEnableRow = h('label', {
    class: 'row is-start is-gap-xs',
    style: 'margin-top: var(--ps-space-2);',
  });
  const autoAdvanceCb = h('input', { type: 'checkbox' });
  autoAdvanceCb.checked = pres.settings.autoAdvance.enabled;
  autoAdvanceEnableRow.append(
    autoAdvanceCb,
    h('span', {
      text: t('editor.deckSettings.autoAdvance.enable', 'Enable timed slides'),
    })
  );
  autoAdvanceCb.addEventListener('change', () => {
    pres.settings.autoAdvance.enabled = !!autoAdvanceCb.checked;
    autoAdvanceFields.style.display = autoAdvanceCb.checked ? '' : 'none';
    markDirty?.();
    requestSave?.();
  });

  // Fields container (hidden when disabled)
  const autoAdvanceFields = h('div', {
    class: 'stack is-gap-xs',
    style: autoAdvanceCb.checked ? '' : 'display:none;',
  });

  // Interval input
  const intervalLabel = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.autoAdvance.intervalHelp',
      'Seconds per slide (1–300)'
    ),
  });
  const intervalInput = h('input', {
    type: 'number',
    class: 'form-input',
    min: '1',
    max: '300',
    step: '1',
    value: String(pres.settings.autoAdvance.intervalSeconds),
  });

  // Total deck time display (updated live)
  const totalTimeEl = h('div', { class: 'help', text: '' });
  const syncTotalTime = () => {
    const interval = pres.settings.autoAdvance.intervalSeconds || DEFAULT_ADVANCE_INTERVAL_SECONDS;
    const slides = Array.isArray(pres.slides) ? pres.slides : [];
    const { formatted } = calculateDeckTime(slides, interval);
    const hasOverrides = slides.some((s) => s.duration != null);
    const detail = hasOverrides
      ? ''
      : ` (${slides.length} slides × ${interval}s)`;
    totalTimeEl.textContent = t(
      'editor.deckSettings.autoAdvance.totalTime',
      'Total deck time: {time}{detail}',
      { time: formatted, detail }
    );
  };
  syncTotalTime();

  intervalInput.addEventListener('input', () => {
    const v = Number(intervalInput.value);
    if (Number.isFinite(v) && v >= 1 && v <= 300) {
      pres.settings.autoAdvance.intervalSeconds = Math.round(v);
      markDirty?.();
      syncTotalTime();
      syncPreset();
    }
  });
  intervalInput.addEventListener('blur', () => {
    // Clamp on blur
    let v = Number(intervalInput.value);
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > 300) v = 300;
    v = Math.round(v);
    intervalInput.value = String(v);
    pres.settings.autoAdvance.intervalSeconds = v;
    markDirty?.();
    requestSave?.();
    syncTotalTime();
    syncPreset();
  });

  // Mode selector (auto-advance vs pacing timer)
  const modeLabel = h('div', {
    class: 'help',
    text: t('editor.deckSettings.autoAdvance.modeLabel', 'Timer behavior'),
  });
  const modeSel = h('select', { class: 'form-input' });
  modeSel.append(
    h('option', {
      value: 'auto',
      text: t('editor.deckSettings.autoAdvance.modeAuto', 'Auto-advance (advance slides automatically)'),
    }),
    h('option', {
      value: 'pacing',
      text: t('editor.deckSettings.autoAdvance.modePacing', 'Pacing timer (shows timer, you advance manually)'),
    })
  );
  modeSel.value = pres.settings.autoAdvance.mode;

  // Loop checkbox (hidden in pacing mode)
  const loopRow = h('label', {
    class: 'row is-start is-gap-xs',
    style: pres.settings.autoAdvance.mode === 'pacing' ? 'display:none;' : '',
  });
  const loopCb = h('input', { type: 'checkbox' });
  loopCb.checked = pres.settings.autoAdvance.loop;
  loopRow.append(
    loopCb,
    h('span', {
      text: t('editor.deckSettings.autoAdvance.loop', 'Loop (restart from first slide)'),
    })
  );
  loopCb.addEventListener('change', () => {
    pres.settings.autoAdvance.loop = !!loopCb.checked;
    markDirty?.();
    requestSave?.();
    syncPreset();
  });

  modeSel.addEventListener('change', () => {
    const v = modeSel.value === 'pacing' ? 'pacing' : 'auto';
    pres.settings.autoAdvance.mode = v;
    // Hide loop + strict in pacing mode (neither has effect when slides don't
    // auto-advance; strict would trap the deck with no way to move).
    loopRow.style.display = v === 'pacing' ? 'none' : '';
    strictRow.style.display = v === 'pacing' ? 'none' : '';
    markDirty?.();
    requestSave?.();
    syncPreset();
  });

  // Show countdown checkbox
  const countdownRow = h('label', {
    class: 'row is-start is-gap-xs',
  });
  const countdownCb = h('input', { type: 'checkbox' });
  countdownCb.checked = pres.settings.autoAdvance.showCountdown;
  countdownRow.append(
    countdownCb,
    h('span', {
      text: t('editor.deckSettings.autoAdvance.showCountdown', 'Show countdown bar'),
    })
  );
  countdownCb.addEventListener('change', () => {
    pres.settings.autoAdvance.showCountdown = !!countdownCb.checked;
    markDirty?.();
    requestSave?.();
  });

  // Named presets: fill interval + loop + auto mode in one pick.
  // "Custom" is the catch-all for any values that don't match a preset.
  const AUTO_ADVANCE_PRESETS = [
    { id: 'pecha-kucha', intervalSeconds: 20, loop: true },
    { id: 'ignite', intervalSeconds: 15, loop: true },
    { id: 'kiosk', intervalSeconds: 10, loop: true },
  ];
  const presetLabelText = {
    'pecha-kucha': t('editor.deckSettings.autoAdvance.presetPechaKucha', 'Pecha Kucha (20s, loop)'),
    ignite: t('editor.deckSettings.autoAdvance.presetIgnite', 'Ignite (15s, loop)'),
    kiosk: t('editor.deckSettings.autoAdvance.presetKiosk', 'Kiosk (10s, loop)'),
    custom: t('editor.deckSettings.autoAdvance.presetCustom', 'Custom'),
  };
  const presetLabel = h('div', {
    class: 'help',
    text: t('editor.deckSettings.autoAdvance.presetLabel', 'Preset'),
  });
  const presetSel = h('select', { class: 'form-input' });
  for (const p of AUTO_ADVANCE_PRESETS) {
    presetSel.append(h('option', { value: p.id, text: presetLabelText[p.id] }));
  }
  presetSel.append(h('option', { value: 'custom', text: presetLabelText.custom }));

  const matchPreset = () => {
    const aa = pres.settings.autoAdvance;
    if (aa.mode !== 'auto') return 'custom';
    const hit = AUTO_ADVANCE_PRESETS.find(
      (p) => p.intervalSeconds === aa.intervalSeconds && p.loop === !!aa.loop
    );
    return hit ? hit.id : 'custom';
  };
  const syncPreset = () => {
    presetSel.value = matchPreset();
  };
  syncPreset();

  presetSel.addEventListener('change', () => {
    const preset = AUTO_ADVANCE_PRESETS.find((p) => p.id === presetSel.value);
    if (!preset) return; // "custom": leave fields as-is
    pres.settings.autoAdvance.intervalSeconds = preset.intervalSeconds;
    pres.settings.autoAdvance.loop = preset.loop;
    pres.settings.autoAdvance.mode = 'auto';
    // Reflect into the individual controls
    intervalInput.value = String(preset.intervalSeconds);
    loopCb.checked = preset.loop;
    modeSel.value = 'auto';
    loopRow.style.display = '';
    strictRow.style.display = '';
    markDirty?.();
    requestSave?.();
    syncTotalTime();
  });

  // Strict mode: timer-only, disable manual navigation (auto mode only).
  const strictRow = h('label', {
    class: 'row is-start is-gap-xs',
    style: pres.settings.autoAdvance.mode === 'pacing' ? 'display:none;' : '',
  });
  const strictCb = h('input', { type: 'checkbox' });
  strictCb.checked = pres.settings.autoAdvance.strict;
  strictRow.append(
    strictCb,
    h('span', {
      text: t(
        'editor.deckSettings.autoAdvance.strict',
        'Strict (timer only — disable manual navigation)'
      ),
    })
  );
  strictCb.addEventListener('change', () => {
    pres.settings.autoAdvance.strict = !!strictCb.checked;
    markDirty?.();
    requestSave?.();
  });

  const autoAdvanceHint = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.autoAdvance.hint',
      'Tip: Pecha Kucha = 20s, Ignite = 15s. Press A to pause/resume while presenting.'
    ),
  });

  autoAdvanceFields.append(presetLabel, presetSel, intervalLabel, intervalInput, modeLabel, modeSel, loopRow, strictRow, countdownRow, autoAdvanceHint, totalTimeEl);
  autoAdvanceWrap.append(autoAdvanceLabel, autoAdvanceEnableRow, autoAdvanceFields);

  // Exclude from RSS feed (shown only when org has RSS enabled)
  const rssFeedRow = h('label', {
    class: 'row is-start editor-callout',
    style: 'display:none;',
  });
  const rssFeedCb = h('input', { type: 'checkbox' });
  rssFeedCb.checked = !!pres.settings.excludeFromFeed;
  const rssFeedText = h('div', { class: 'stack is-gap-xs' }, [
    h('div', {
      class: 'field-label',
      text: t('editor.deckSettings.rssFeed.title', 'Exclude from RSS feed'),
    }),
    h('div', {
      class: 'help',
      text: t(
        'editor.deckSettings.rssFeed.help',
        'When checked, this presentation will not appear in the public RSS feed.'
      ),
    }),
  ]);
  rssFeedRow.append(rssFeedCb, rssFeedText);
  rssFeedCb.addEventListener('change', () => {
    pres.settings.excludeFromFeed = !!rssFeedCb.checked;
    markDirty?.();
    requestSave?.();
  });
  if (api) {
    api('/api/settings/organization').then((resp) => {
      const orgSettings =
        resp?.settings && typeof resp.settings === 'object' ? resp.settings : {};
      if (orgSettings.rss?.enabled) {
        rssFeedRow.style.display = '';
      }
    }).catch(() => {});
  }

  // Two-column grid for compact settings on desktop
  const settingsGrid = h('div', { class: 'settings-modal-grid' }, [
    qaRow,
    buildsRow,
    revealStyleWrap,
    themeWrap,
    transWrap,
    langWrap,
    authorPreviewRow,
    rssFeedRow,
    analyticsWrap,
    liveVideoWrap,
    autoAdvanceWrap,
  ]);

  // Full-width sections
  modal.content.append(
    settingsGrid,
    tagsWrap,
    descWrap
  );

  // Add cleanup for tag editor when modal closes
  if (tagEditorInstance?.detach) {
    const origClose = modal.close;
    modal.close = () => {
      tagEditorInstance.detach();
      origClose?.call(modal);
    };
  }

  modal.show(root, openOverlayClosers);
}