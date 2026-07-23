import { createModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { buildQaSection, buildBuildsSection, buildAuthorPreviewSection, buildRssFeedSection } from './settings-modal/toggles.js';
import { buildRevealStyleSection } from './settings-modal/reveal-style.js';
import { buildThemeSection } from './settings-modal/theme.js';
import { buildTransitionsSection } from './settings-modal/transitions.js';
import { buildLanguageSection } from './settings-modal/language.js';
import { buildDescriptionSection } from './settings-modal/description.js';
import { buildTagsSection } from './settings-modal/tags.js';
import { buildAnalyticsSection } from './settings-modal/analytics.js';
import { buildLiveVideoSection } from './settings-modal/live-video.js';
import { buildAutoAdvanceSection } from './settings-modal/auto-advance.js';

/**
 * Open the deck settings modal. Assembles the form from independent section
 * builders (in ./settings-modal/), each of which normalizes its own slice of
 * `pres.settings`, builds its DOM, and wires change handlers to
 * markDirty/requestSave. Kept as the module entry point so importers are
 * unaffected by the internal split.
 */
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

  // Ensure settings is an object; each section normalizes its own slice.
  pres.settings =
    pres.settings && typeof pres.settings === 'object' ? pres.settings : {};

  const ctx = { h, pres, markDirty, requestSave };

  const qa = buildQaSection(ctx);
  const builds = buildBuildsSection(ctx);
  const revealStyle = buildRevealStyleSection(ctx);
  const theme = buildThemeSection({
    h,
    root,
    pres,
    api,
    toast,
    openOverlayClosers,
    modal,
    onThemeChanged,
    onNavigateToSlide,
  });
  const transitions = buildTransitionsSection(ctx);
  const language = buildLanguageSection(ctx);
  const authorPreview = buildAuthorPreviewSection(ctx);
  const rssFeed = buildRssFeedSection({ ...ctx, api });
  const analytics = buildAnalyticsSection(ctx);
  const liveVideo = buildLiveVideoSection(ctx);
  const autoAdvance = buildAutoAdvanceSection(ctx);
  const tags = buildTagsSection({ h, pres, api });
  const description = buildDescriptionSection(ctx);

  // Two-column grid for compact settings on desktop
  const settingsGrid = h('div', { class: 'settings-modal-grid' }, [
    qa.row,
    builds.row,
    revealStyle.el,
    theme.el,
    transitions.el,
    language.el,
    authorPreview.row,
    rssFeed.row,
    analytics.el,
    liveVideo.el,
    autoAdvance.el,
  ]);

  // Full-width sections
  modal.content.append(settingsGrid, tags.el, description.el);

  // Add cleanup for tag editor when modal closes
  if (tags.instance?.detach) {
    const origClose = modal.close;
    modal.close = () => {
      tags.instance.detach();
      origClose?.call(modal);
    };
  }

  modal.show(root, openOverlayClosers);
}
