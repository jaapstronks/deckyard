import { createModal } from '../../../../lib/dom/modal.js';
import { t } from '../../../../lib/ui-i18n.js';
import {
  buildQaSection,
  buildBuildsSection,
  buildAuthorPreviewSection,
  buildRssFeedSection,
} from './toggles.js';
import { buildRevealStyleSection } from './reveal-style.js';
import { buildThemeSection } from './theme.js';
import { buildTransitionsSection } from './transitions.js';
import { buildLanguageSection } from './language.js';
import { buildDescriptionSection } from './description.js';
import { buildTagsSection } from './tags.js';
import { buildAnalyticsSection } from './analytics.js';
import { buildLiveVideoSection } from './live-video.js';
import { buildAutoAdvanceSection } from './auto-advance.js';
import { h } from '../../../../lib/dom/index.js';
import { featureEnabled } from '../../../../lib/state/features.js';

/**
 * Open the deck settings modal. Assembles the form from independent section
 * builders (the sibling modules in this folder), each of which normalizes its
 * own slice of `pres.settings`, builds its DOM, and wires change handlers to
 * markDirty/requestSave. This index is the folder's seam.
 */
export function openSettingsModal({
  root,
  pres,
  api,
  markDirty,
  requestSave,
  toast,
  onThemeChanged,
  onNavigateToSlide,
} = {}) {
  const modal = createModal({
    title: t('editor.deckSettings.title', 'Deck settings'),
  });

  // Ensure settings is an object; each section normalizes its own slice.
  pres.settings =
    pres.settings && typeof pres.settings === 'object' ? pres.settings : {};

  const ctx = { pres, markDirty, requestSave };

  const qa = buildQaSection(ctx);
  const builds = buildBuildsSection(ctx);
  const revealStyle = buildRevealStyleSection(ctx);
  const theme = buildThemeSection({
    root,
    pres,
    api,
    toast,
    modal,
    onThemeChanged,
    onNavigateToSlide,
  });
  const transitions = buildTransitionsSection(ctx);
  const language = buildLanguageSection(ctx);
  const authorPreview = buildAuthorPreviewSection(ctx);
  const rssFeed = buildRssFeedSection({ ...ctx, api });
  // Absent where the installation has no analytics cluster (D260); the deck's
  // stored options are left as they are.
  const analytics = featureEnabled('analytics')
    ? buildAnalyticsSection(ctx)
    : null;
  const liveVideo = buildLiveVideoSection(ctx);
  const autoAdvance = buildAutoAdvanceSection(ctx);
  const tags = buildTagsSection({ pres, api });
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
    analytics?.el,
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

  modal.show(root);
}
