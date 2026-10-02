import { alignGroup } from '../../field-groups.js';

/**
 * Title, subtitle and meta are ONE visual block: they share a container and
 * read as a single unit, so their horizontal placement is a property of the
 * block and not of each field (see field-groups.js). The value lives in the
 * `titleBlockAlign` content field, which the toolbar "Layout" chip writes via
 * `layoutVariants` in index.js; `resolveTitleView` (render.js) turns a
 * non-default value into the group's alignment class on the slide root and the
 * CSS moves the whole block.
 *
 * Two values, not three: a right-aligned title block is not a layout we want
 * to offer, and it is the one value that produced a broken slide in the deck
 * history (a centred title next to a right-aligned subtitle). Same reasoning
 * as ROLE_AFFORDANCES.quote, which also offers left/centre only.
 *
 * The VERTICAL axis stays the theme's (`titleLayout`: bottom | center | top).
 * Two axes, two owners: the theme sets the posture of a title slide, the
 * author composes this one.
 *
 * Its own module because both the definition (fields, layout variants) and
 * the renderer (the alignment class) read it, and neither owns the other.
 */
export const TITLE_BLOCK = alignGroup('title-block', 'titleBlockAlign', {
  label: 'Title block alignment',
  labelKey: 'editor.slideField.titleBlockAlign.label',
});
