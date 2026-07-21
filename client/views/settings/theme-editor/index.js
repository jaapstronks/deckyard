/**
 * Theme Editor Component
 * Full-featured editor for creating and editing custom themes.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { api } from '../../../lib/api.js';
import { toast } from '../../../lib/dom/toast.js';
import { isValidHexColor, deriveColorPalette } from '../../../lib/theme/color-utils.js';
import { createFontPicker } from './font-picker.js';
import { createColorPicker } from './color-picker.js';
import { createThemePreview } from './preview.js';
import { createLogoUploader } from './logo-uploader.js';
import { createConfigSections } from './config-sections.js';
import { validateThemeConfig } from '../../../../shared/theme-config-schema.js';

/**
 * Create the theme editor component.
 * @param {Object} options
 * @param {Object|null} options.theme - Theme to edit, or null for new
 * @param {Function} options.onSave - Save callback
 * @param {Function} options.onCancel - Cancel callback
 * @returns {Object} { el }
 */
export function createThemeEditor({ theme, onSave, onCancel }) {
  const isEditing = Boolean(theme?.id);

  const container = h('div', { class: 'theme-editor' });

  // Header
  const header = h('div', { class: 'theme-editor-header row is-between is-center' });
  const backBtn = h('button', {
    class: 'btn btn-secondary btn-icon',
    type: 'button',
    'aria-label': t('common.back', 'Back'),
    title: t('common.back', 'Back'),
    onclick: onCancel,
  });
  backBtn.innerHTML = '&larr;';

  const headerTitle = h('h3', {
    class: 'theme-editor-title',
    text: isEditing
      ? t('settings.themes.editTheme', 'Edit Theme')
      : t('settings.themes.createTheme', 'Create Theme'),
  });

  const headerActions = h('div', { class: 'row gap-2' });
  const cancelBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.cancel', 'Cancel'),
    onclick: onCancel,
  });
  const saveBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('common.save', 'Save'),
  });
  headerActions.append(cancelBtn, saveBtn);

  header.append(h('div', { class: 'row is-center gap-3' }, [backBtn, headerTitle]), headerActions);

  // Main content - two columns
  const main = h('div', { class: 'theme-editor-main' });

  // Left column: Form fields
  const formColumn = h('div', { class: 'theme-editor-form' });

  // Theme state
  const state = {
    label: theme?.label || '',
    logoUrl: theme?.logoUrl || '',
    logoSmallUrl: theme?.logoSmallUrl || '',
    colors: {
      primary: theme?.colors?.primary || '#3B82F6',
      background: theme?.colors?.background || '#ffffff',
      textLight: theme?.colors?.textLight || '#ffffff',
      textDark: theme?.colors?.textDark || '#1f2937',
    },
    fonts: {
      heading: theme?.fonts?.heading || 'Inter',
      headingFamilyId: theme?.fonts?.headingFamilyId || null,
      body: theme?.fonts?.body || 'Inter',
      bodyFamilyId: theme?.fonts?.bodyFamilyId || null,
    },
    // The richer half of a theme (surfaces, typography, locks, background
    // variants). Validated on the way in so an older or hand-edited config
    // cannot put the form into a state the server would reject on save.
    config: validateThemeConfig(theme?.config),
    managedFonts: [],
  };

  // Update preview
  const updatePreview = () => {
    if (previewComponent) {
      previewComponent.update(state);
    }
  };

  // ============================================================
  // Name & Slug Section
  // ============================================================
  const nameCard = h('div', { class: 'editor-card stack' });
  nameCard.append(
    h('div', { class: 'field-label', text: t('settings.themes.themeName', 'Theme Name') })
  );

  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: t('settings.themes.themeNamePlaceholder', 'My Custom Theme'),
    value: state.label,
    maxlength: '255',
    oninput: (e) => {
      state.label = e.target.value;
    },
  });

  const nameHint = h('div', {
    class: 'help',
    text: t('settings.themes.themeNameHint', 'Give your theme a descriptive name.'),
  });

  nameCard.append(nameInput, nameHint);

  // ============================================================
  // Logo Section
  // ============================================================
  const logoCard = h('div', { class: 'editor-card stack' });
  logoCard.append(
    h('div', { class: 'field-label', text: t('settings.themes.logo', 'Logo') })
  );

  const logoUploader = createLogoUploader({
    value: state.logoUrl,
    onChange: (url) => {
      state.logoUrl = url;
      updatePreview();
    },
  });

  const logoHint = h('div', {
    class: 'help',
    text: t('settings.themes.logoHint', 'Main logo used on payoff slide. SVG format recommended.'),
  });

  // Small logo for title slide (optional)
  const logoSmallLabel = h('div', {
    class: 'field-label field-label-secondary',
    text: t('settings.themes.logoSmall', 'Title Slide Logo (optional)'),
  });

  const logoSmallUploader = createLogoUploader({
    value: state.logoSmallUrl,
    onChange: (url) => {
      state.logoSmallUrl = url;
      updatePreview();
    },
  });

  const logoSmallHint = h('div', {
    class: 'help',
    text: t('settings.themes.logoSmallHint', 'Smaller logo for title slides. Uses main logo if not set.'),
  });

  logoCard.append(logoUploader.el, logoHint, logoSmallLabel, logoSmallUploader.el, logoSmallHint);

  // ============================================================
  // Colors Section
  // ============================================================
  const colorsCard = h('div', { class: 'editor-card stack' });
  colorsCard.append(
    h('div', { class: 'field-label', text: t('settings.themes.colors', 'Colors') })
  );

  const colorsHint = h('div', {
    class: 'help',
    text: t('settings.themes.colorsHint', 'Define your brand colors. Accent colors are derived from the primary color.'),
  });

  const colorsGrid = h('div', { class: 'theme-colors-grid' });

  // Primary color
  const primaryPicker = createColorPicker({
    label: t('settings.themes.primaryColor', 'Primary'),
    value: state.colors.primary,
    onChange: (color) => {
      state.colors.primary = color;
      updatePreview();
      updateDerivedColorsPreview();
    },
  });

  // Background color
  const bgPicker = createColorPicker({
    label: t('settings.themes.backgroundColor', 'Background'),
    value: state.colors.background,
    onChange: (color) => {
      state.colors.background = color;
      updatePreview();
    },
  });

  // Text light
  const textLightPicker = createColorPicker({
    label: t('settings.themes.textLight', 'Text Light'),
    value: state.colors.textLight,
    onChange: (color) => {
      state.colors.textLight = color;
      updatePreview();
    },
  });

  // Text dark
  const textDarkPicker = createColorPicker({
    label: t('settings.themes.textDark', 'Text Dark'),
    value: state.colors.textDark,
    onChange: (color) => {
      state.colors.textDark = color;
      updatePreview();
    },
  });

  colorsGrid.append(primaryPicker.el, bgPicker.el, textLightPicker.el, textDarkPicker.el);

  // Derived colors preview
  const derivedColorsPreview = h('div', { class: 'theme-derived-colors' });
  const derivedColorsLabel = h('div', {
    class: 'help',
    style: 'margin-top: var(--ps-space-3);',
    text: t('settings.themes.derivedColors', 'Derived accent colors:'),
  });
  const derivedSwatches = h('div', { class: 'theme-derived-swatches' });

  function updateDerivedColorsPreview() {
    derivedSwatches.innerHTML = '';
    const palette = deriveColorPalette(state.colors.primary);
    for (const color of palette) {
      const swatch = h('div', {
        class: 'theme-derived-swatch',
        title: color,
      });
      swatch.style.backgroundColor = color;
      derivedSwatches.append(swatch);
    }
  }

  updateDerivedColorsPreview();
  derivedColorsPreview.append(derivedColorsLabel, derivedSwatches);

  colorsCard.append(colorsHint, colorsGrid, derivedColorsPreview);

  // ============================================================
  // Fonts Section
  // ============================================================
  const fontsCard = h('div', { class: 'editor-card stack' });
  fontsCard.append(
    h('div', { class: 'field-label', text: t('settings.themes.fonts', 'Fonts') })
  );

  const fontsHint = h('div', {
    class: 'help',
    text: t('settings.themes.fontsHint', 'Choose fonts for headings and body text.'),
  });

  const fontsGrid = h('div', { class: 'theme-fonts-grid' });

  // Heading font picker
  const headingFontPicker = createFontPicker({
    label: t('settings.themes.headingFont', 'Heading Font'),
    value: state.fonts.heading,
    familyId: state.fonts.headingFamilyId,
    managedFonts: state.managedFonts,
    context: 'heading',
    onChange: (font, familyId) => {
      state.fonts.heading = font;
      state.fonts.headingFamilyId = familyId || null;
      updatePreview();
    },
  });

  // Body font picker
  const bodyFontPicker = createFontPicker({
    label: t('settings.themes.bodyFont', 'Body Font'),
    value: state.fonts.body,
    familyId: state.fonts.bodyFamilyId,
    managedFonts: state.managedFonts,
    context: 'body',
    onChange: (font, familyId) => {
      state.fonts.body = font;
      state.fonts.bodyFamilyId = familyId || null;
      updatePreview();
    },
  });

  fontsGrid.append(headingFontPicker.el, bodyFontPicker.el);
  fontsCard.append(fontsHint, fontsGrid);

  // ============================================================
  // Config sections (surfaces, heading treatment, locks)
  // ============================================================
  const configCards = createConfigSections({
    config: state.config,
    colors: state.colors,
    onChange: updatePreview,
  });

  // Assemble form column
  formColumn.append(nameCard, logoCard, colorsCard, fontsCard, ...configCards);

  // ============================================================
  // Right column: Live Preview
  // ============================================================
  const previewColumn = h('div', { class: 'theme-editor-preview' });
  const previewLabel = h('div', {
    class: 'field-label',
    text: t('settings.themes.preview', 'Preview'),
  });

  const previewComponent = createThemePreview();
  previewColumn.append(previewLabel, previewComponent.el);
  // The preview builds its theme server-side, so the first paint is a fetch
  // rather than something the constructor can do synchronously.
  updatePreview();

  // Assemble main
  main.append(formColumn, previewColumn);

  // Assemble container
  container.append(header, main);

  // ============================================================
  // Save Handler
  // ============================================================
  saveBtn.addEventListener('click', async () => {
    // Validate
    if (!state.label.trim()) {
      toast.error(t('settings.themes.errorNameRequired', 'Theme name is required.'));
      nameInput.focus();
      return;
    }

    if (!isValidHexColor(state.colors.primary)) {
      toast.error(t('settings.themes.errorInvalidPrimary', 'Invalid primary color.'));
      return;
    }

    if (!isValidHexColor(state.colors.background)) {
      toast.error(t('settings.themes.errorInvalidBackground', 'Invalid background color.'));
      return;
    }

    // Prepare data
    const themeData = {
      label: state.label.trim(),
      logoUrl: state.logoUrl || null,
      logoSmallUrl: state.logoSmallUrl || null,
      colors: {
        primary: state.colors.primary,
        background: state.colors.background,
        textLight: state.colors.textLight,
        textDark: state.colors.textDark,
      },
      fonts: {
        heading: state.fonts.heading,
        headingFamilyId: state.fonts.headingFamilyId || undefined,
        body: state.fonts.body,
        bodyFamilyId: state.fonts.bodyFamilyId || undefined,
      },
      // Sent whole. The sections delete keys rather than writing defaults, so
      // an untouched field stays absent and the builder keeps its own default.
      config: state.config,
    };

    // Disable buttons while saving
    saveBtn.disabled = true;
    cancelBtn.disabled = true;

    try {
      await onSave(themeData);
    } finally {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  // Fetch managed fonts and update pickers
  (async () => {
    try {
      const result = await api('/api/font-families');
      const managedFonts = result?.fontFamilies || [];
      if (managedFonts.length > 0) {
        state.managedFonts = managedFonts;
        // Re-create font pickers with managed fonts
        fontsGrid.innerHTML = '';

        const newHeadingPicker = createFontPicker({
          label: t('settings.themes.headingFont', 'Heading Font'),
          value: state.fonts.heading,
          familyId: state.fonts.headingFamilyId,
          managedFonts,
          context: 'heading',
          onChange: (font, familyId) => {
            state.fonts.heading = font;
            state.fonts.headingFamilyId = familyId || null;
            updatePreview();
          },
        });

        const newBodyPicker = createFontPicker({
          label: t('settings.themes.bodyFont', 'Body Font'),
          value: state.fonts.body,
          familyId: state.fonts.bodyFamilyId,
          managedFonts,
          context: 'body',
          onChange: (font, familyId) => {
            state.fonts.body = font;
            state.fonts.bodyFamilyId = familyId || null;
            updatePreview();
          },
        });

        fontsGrid.append(newHeadingPicker.el, newBodyPicker.el);
      }
    } catch {
      // Silently fall back to curated-only pickers
    }
  })();

  // The preview holds ResizeObservers per sample slide; the tab drops the
  // editor by clearing its container, which would leave them observing
  // detached nodes.
  return { el: container, detach: () => previewComponent.detach() };
}
