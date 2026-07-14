/**
 * Global per-slide options.
 *
 * These optional content fields are added to EVERY slide type (see
 * `withGlobalSlideFields` in shared/slide-types/registry.js) and are rendered
 * centrally (see `injectSlideBackground` / `injectSlideLogo` in
 * shared/slide-types/presentation.js). They are documented here once so the AI
 * prompt and the MCP `get_slide_types` tool can advertise them without
 * duplicating the description across every slide-type schema.
 */

export const GLOBAL_SLIDE_OPTIONS = {
  description:
    'Optional fields that may be added to the content of ANY slide type, in addition to its per-type schema. Omit them unless the user asks for a background image, a logo, or specific styling.',
  fields: {
    slideBgImage: {
      type: 'image',
      required: false,
      description:
        'URL of a full-slide background image, shown behind the slide content. Only set this to a real, already-uploaded asset URL (e.g. /uploads/...); never invent a URL. Leave unset to keep the theme background.',
    },
    slideBgFit: {
      type: 'enum',
      options: ['cover', 'contain'],
      default: 'cover',
      description:
        'How the background image fills the slide. "cover" crops to fill; "contain" fits the whole image without cropping. Only relevant when slideBgImage is set.',
    },
    slideBgFocusX: {
      type: 'number',
      range: '0-100',
      default: 50,
      description:
        'Horizontal focus point (percent) kept visible when a "cover" background is cropped. Only relevant with slideBgImage.',
    },
    slideBgFocusY: {
      type: 'number',
      range: '0-100',
      default: 50,
      description:
        'Vertical focus point (percent) kept visible when a "cover" background is cropped. Use a low value (e.g. 0) to keep the top, a high value (e.g. 100) to keep the bottom. Only relevant with slideBgImage.',
    },
    slideBgOverlay: {
      type: 'enum',
      options: ['auto', 'none', 'light', 'dark', 'gradient-top', 'gradient-bottom'],
      default: 'auto',
      description:
        'Overlay over the background image to improve text legibility. "auto" (recommended) adds a subtle scrim only when the image is too busy for readable text; "none" disables it; "light"/"dark" are flat scrims; "gradient-top"/"gradient-bottom" darken one edge behind the text. Only relevant with slideBgImage.',
    },
    slideBgText: {
      type: 'enum',
      options: ['auto', 'light', 'dark'],
      default: 'auto',
      description:
        'Text colour over a background image. "auto" (recommended) lets the editor pick the theme text colour with the best contrast for the image; "light"/"dark" force the theme light/dark text colour. Only relevant with slideBgImage.',
    },
    slideLogo: {
      type: 'enum',
      options: ['none', 'top-right'],
      default: 'none',
      description:
        "Set to \"top-right\" to show the active theme's logo in the corner of this slide. Uses the theme logo; no URL needed.",
    },
  },
};

/**
 * Build a formatted text block describing the global options for an AI prompt.
 * @returns {string}
 */
export function buildGlobalOptionsPromptSection() {
  const lines = [];
  lines.push('GLOBAL SLIDE OPTIONS (apply to ANY slide type)');
  lines.push('==============================================');
  lines.push(GLOBAL_SLIDE_OPTIONS.description);
  lines.push('');
  for (const [key, spec] of Object.entries(GLOBAL_SLIDE_OPTIONS.fields)) {
    const meta = [];
    if (spec.type === 'enum' && Array.isArray(spec.options)) {
      meta.push(spec.options.map((o) => `"${o}"`).join(' | '));
    } else if (spec.type === 'number' && spec.range) {
      meta.push(`number ${spec.range}`);
    } else {
      meta.push(spec.type);
    }
    if (spec.default !== undefined) meta.push(`default ${JSON.stringify(spec.default)}`);
    lines.push(`- ${key} (${meta.join(', ')}): ${spec.description}`);
  }
  lines.push('');
  lines.push(
    'These are all optional. Do NOT add them to every slide; only include the ones the user actually asks for.'
  );
  return lines.join('\n');
}
