import {
  escapeHtml,
  gradientVarsForSlide,
  styleAttrFromVars,
} from '../helpers.js';
import { alignGroup, groupAlignClass } from '../field-groups.js';

const LAYOUTS = ['top', 'center', 'bottom'];

/**
 * Title and subtitle are one chapter-title block; `layout` above already owns
 * the VERTICAL axis (top | center | bottom), this group owns the horizontal
 * one. Both boxes shrink to their text here, so a per-field `text-align` was
 * inert while the two sat on centres 17px apart (measured -603 / -586 at a
 * 1600px render) — the block has to move, not the text inside it.
 */
const TITLE_BLOCK = alignGroup('title-block', 'titleBlockAlign', {
  label: 'Title block alignment',
  labelKey: 'editor.slideField.titleBlockAlign.label',
  schematicKind: 'section',
});

export default {
  structure: 'singleton',
  runtime: 'static',
  label: 'Section title',
  fieldGroups: [TITLE_BLOCK.group],
  layoutVariants: TITLE_BLOCK.variants,
  fields: [
    TITLE_BLOCK.field,
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      group: 'title-block',
      required: true,
      maxLength: 140,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      labelKey: 'editor.slideField.subheading.label',
      type: 'string',
      required: false,
      maxLength: 160,
      group: 'title-block',
    },
    {
      key: 'layout',
      label: 'Layout',
      labelKey: 'editor.slideField.layout.label',
      type: 'enum',
      required: false,
      // Note: values are persisted in decks; keep them stable.
      options: [
        {
          value: 'top',
          label: 'Top',
          title: 'Title at the top of the slide.',
          ariaLabel: 'Title at top',
        },
        {
          value: 'center',
          label: 'Center',
          title: 'Title vertically centered (default).',
          ariaLabel: 'Title centered',
        },
        {
          value: 'bottom',
          label: 'Bottom',
          title: 'Title at the bottom of the slide.',
          ariaLabel: 'Title at bottom',
        },
      ],
    },
  ],
  defaultsByLang: {
    nl: {
      title: 'Sectietitel',
      subheading: '',
      layout: 'center',
      titleBlockAlign: 'left',
    },
    'en-GB': {
      title: 'Chapter title',
      subheading: '',
      layout: 'center',
      titleBlockAlign: 'left',
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  // `titleBlockAlign` is listed so activeLayoutVariantId resolves a tile as
  // active on decks predating the field.
  defaults: {
    title: 'Chapter title',
    subheading: '',
    layout: 'center',
    titleBlockAlign: 'left',
  },
  renderHtml: (content, slide) => {
    const vars = gradientVarsForSlide(slide?.id, 'chapter');
    const layout = LAYOUTS.includes(content?.layout)
      ? content.layout
      : 'center';
    const alignClass = groupAlignClass(TITLE_BLOCK.group, content);
    const subtitle =
      typeof content?.subheading === 'string' && content.subheading.trim()
        ? `<p class="subtitle" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${escapeHtml(content.subheading)}</p>`
        : '';
    return `
        <div class="slide slide-chapter-title is-layout-${layout}${
          alignClass ? ` ${alignClass}` : ''
        }"${styleAttrFromVars(vars)}>
          <div class="slide-inner">
            <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(content?.title)}</h2>
            ${subtitle}
          </div>
        </div>
      `;
  },
};
