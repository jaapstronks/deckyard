/**
 * Organization Tab Component
 *
 * The active organization's profile and policies. In single-org mode the
 * profile API is unavailable, but policy settings remain writable by the
 * instance administrator through the existing organization settings route.
 */

import { h } from '../../../lib/dom/index.js';
import { t } from '../../../lib/ui-i18n.js';
import { renderOrganizationProfilePanel } from '../organization-profile/index.js';
import { isOrganizationAdmin } from '../../../../shared/organization-role.js';
import { getFeatures, featureEnabled } from '../../../lib/state/features.js';
import { createOrganizationThemePolicy } from '../organization-theme-policy.js';
import { createOrganizationRssPolicy } from '../organization-rss-policy.js';
import { createTranslationInstructionsCard } from '../translation-instructions/index.js';

/**
 * Create the organization tab component.
 * @param {Object} options
 * @param {Object} options.user - Current user
 * @returns {Object} { el, load }
 */
export function createOrganizationTab({ user }) {
  const container = h('div', {
    class: 'settings-tab-view',
    id: 'settings-tab-organization',
    role: 'tabpanel',
    'aria-labelledby': 'settings-tab-organization-btn',
    'data-tab': 'organization',
  });

  container.append(
    h('h2', {
      class: 'settings-tab-title',
      text: t('settings.tabs.organization', 'Organization'),
    }),
  );

  let loaded = false;
  const canWritePolicy = isOrganizationAdmin(user);
  const themePolicy = canWritePolicy ? createOrganizationThemePolicy() : null;
  const rssPolicy = canWritePolicy ? createOrganizationRssPolicy() : null;
  const translationPolicy =
    canWritePolicy && featureEnabled('ai')
      ? createTranslationInstructionsCard()
      : null;

  const load = () => {
    if (loaded) return;
    loaded = true;
    if (getFeatures()?.multiOrganization) {
      container.append(renderOrganizationProfilePanel({ user }).el);
    }
    if (canWritePolicy) {
      container.append(themePolicy.el, translationPolicy?.el, rssPolicy.el);
      themePolicy.load();
      translationPolicy?.load();
      rssPolicy.load();
    }
  };

  return { el: container, load };
}
