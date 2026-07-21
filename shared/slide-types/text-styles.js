/**
 * Per-field block-level text styling (editing-surfaces text phase, step 3).
 *
 * A generic, type-agnostic override map lives on `content.textStyles`, keyed
 * by the field keys the renderers already tag with `data-inline-field`:
 *
 *   content.textStyles = {
 *     body:  { align: 'center', color: 'accent' },
 *     title: { align: 'center' },
 *   }
 *
 * Absent key / absent property = theme default. The values are a small fixed
 * vocabulary (no free input): alignment is left/center/right, colour is a
 * theme TOKEN (default/muted/accent/inverse) so decks stay portable across
 * themes. Styles live OUTSIDE the markdown, so the step-1 HTML↔markdown
 * round-trip gate is untouched.
 *
 * Rendering is a single string post-pass (`injectTextStyles`) run inside the
 * shared `renderSlideHtml`, mirroring `injectSlideBackground` — one code path,
 * so the editor canvas, present mode and exports stay identical. It adds the
 * `tf-*` classes (see `03-components/97-text-styles.css`) to the matching
 * field element.
 *
 * NOTE: text SIZE (S/M/L) is a follow-up (PR2): a per-field `em` multiplier
 * would replace the px font-sizes many types set (28px body, …) with a
 * fraction of the parent size instead of scaling them, so size needs a
 * `--tf-size-scale` custom property plumbed into each primary text element.
 * Alignment and colour compose cleanly as plain overrides and ship first.
 */

/** Alignment vocabulary; `left` is the default (no override stored/emitted). */
export const TEXT_ALIGN_VALUES = ['left', 'center', 'right'];
/** Colour vocabulary (theme tokens); `default` means no override. */
export const TEXT_COLOR_VALUES = ['default', 'muted', 'accent', 'inverse'];

const DEFAULT_ALIGN = 'left';
const DEFAULT_COLOR = 'default';

/**
 * Normalize a raw `textStyles` map: keep only known keys/values and drop
 * defaults, so stored JSON never carries no-op overrides (a click-in-click-out
 * leaves the deck unchanged). Returns a fresh object; input is not mutated.
 * @param {unknown} raw
 * @returns {Record<string, {align?: string, color?: string}>}
 */
export function normalizeTextStyles(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, style] of Object.entries(raw)) {
    if (!key || !style || typeof style !== 'object') continue;
    const clean = {};
    if (TEXT_ALIGN_VALUES.includes(style.align) && style.align !== DEFAULT_ALIGN) {
      clean.align = style.align;
    }
    if (TEXT_COLOR_VALUES.includes(style.color) && style.color !== DEFAULT_COLOR) {
      clean.color = style.color;
    }
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

/**
 * The CSS classes for one field's style, or '' when it is all defaults.
 * @param {{align?: string, color?: string}} style
 * @returns {string}
 */
export function textStyleClasses(style) {
  if (!style || typeof style !== 'object') return '';
  const classes = [];
  if (TEXT_ALIGN_VALUES.includes(style.align) && style.align !== DEFAULT_ALIGN) {
    classes.push(`tf-align-${style.align}`);
  }
  if (TEXT_COLOR_VALUES.includes(style.color) && style.color !== DEFAULT_COLOR) {
    classes.push(`tf-color-${style.color}`);
  }
  return classes.join(' ');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * String post-pass: add the `tf-*` classes to each styled field's element.
 * Regex-based (like `injectSlideBackground`) so it runs identically on the
 * server and in the browser without a DOM. Matches the opening tag carrying
 * `data-inline-field="<key>"` and merges the classes into its class attribute
 * (or adds one). Unknown / default-only keys emit nothing.
 * @param {string} html - rendered slide HTML
 * @param {Object} content - slide content (reads `content.textStyles`)
 * @returns {string}
 */
export function injectTextStyles(html, content) {
  const styles = normalizeTextStyles(content?.textStyles);
  const keys = Object.keys(styles);
  if (!keys.length || typeof html !== 'string') return html;
  let out = html;
  for (const key of keys) {
    const cls = textStyleClasses(styles[key]);
    if (!cls) continue;
    // The `"` after the key anchors the match, so `card1` never matches
    // `card1Body`; `data-morph-role="body"` never matches field `body`.
    const tagRe = new RegExp(
      `<([a-zA-Z][\\w-]*)\\b([^>]*\\bdata-inline-field="${escapeRegExp(key)}"[^>]*)>`,
      'g'
    );
    out = out.replace(tagRe, (_m, tag, attrs) => {
      if (/\sclass="/.test(attrs)) {
        const merged = attrs.replace(
          /(\sclass=")([^"]*)(")/,
          (_mm, a, existing, b) => `${a}${existing} ${cls}${b}`
        );
        return `<${tag}${merged}>`;
      }
      return `<${tag} class="${cls}"${attrs}>`;
    });
  }
  return out;
}
