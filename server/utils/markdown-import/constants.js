/**
 * Markdown Import Constants
 * Layout aliases and frontmatter-to-slide-type lookup tables.
 */

/**
 * Maps frontmatter `layout:` values to Deckyard slide types and optional content overrides.
 * First match wins. Keys are lowercase.
 */
export const LAYOUT_TO_SLIDE_TYPE = {
  // Title / cover
  'title':        { type: 'title-slide' },
  'cover':        { type: 'title-slide' },

  // Section / chapter
  'section':      { type: 'chapter-title-slide' },
  'chapter':      { type: 'chapter-title-slide' },

  // Two-column layouts
  'two-cols':     { type: 'content-slide', content: { layout: 'two-column' } },
  'two-column':   { type: 'content-slide', content: { layout: 'two-column' } },

  // Comparison
  'comparison':   { type: 'comparison-slide' },

  // Image layouts
  'image-left':   { type: 'image-text-slide', content: { imageSide: 'left' } },
  'image-right':  { type: 'image-text-slide', content: { imageSide: 'right' } },
  'image':        { type: 'image-slide' },
  'image-full':   { type: 'image-slide' },

  // Quote
  'quote':        { type: 'quote-slide' },

  // Center / statement
  'center':       { type: 'content-slide' },
  'statement':    { type: 'content-slide' },

  // Table
  'table':        { type: 'table-slide' },

  // List
  'list':         { type: 'lijstje-slide' },

  // End / outro
  'end':          { type: 'payoff-slide' },
  'outro':        { type: 'payoff-slide' },

  // Chart (deferred, but map anyway)
  'chart':        { type: 'chart-slide' },

  // KPI / metrics (deferred, but map anyway)
  'kpi':          { type: 'kpi-metrics-slide' },
  'metrics':      { type: 'kpi-metrics-slide' },

  // Gallery
  'gallery':      { type: 'gallery-slide' },
};

/**
 * Global frontmatter keys that map to deck-level metadata (not slide content).
 */
export const DECK_META_KEYS = ['title', 'theme', 'lang', 'language'];

/**
 * Column marker regex. Matches `::left::`, `::right::` (case-insensitive).
 */
export const COLUMN_MARKER_RE = /^::(\w+)::$/;

/**
 * Speaker notes in HTML comment form: `<!-- notes here -->`
 * Supports multiline.
 */
export const HTML_COMMENT_NOTES_RE = /<!--\s*([\s\S]*?)\s*-->/g;

/**
 * Speaker notes with `Note:` prefix (Slidev / Marp convention).
 * Must appear after a blank line and runs to end of slide body.
 */
export const NOTE_PREFIX_RE = /\n\n(?:Notes?|NOTES?):\s*\n?([\s\S]*)$/;

/**
 * Markdown image regex: `![alt](src "caption")`
 * Groups: 1=alt, 2=src, 3=optional caption (without quotes)
 */
export const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

/**
 * Fenced code block regex: ```lang {highlights}
 * Groups: 1=language, 2=highlight spec, 3=code body
 */
export const CODE_BLOCK_RE = /```(\w+)?(?:\s*\{([^}]*)\})?\s*\n([\s\S]*?)```/g;

/**
 * Pipe table detection: at least one row with | separators.
 */
export const PIPE_TABLE_RE = /^\|(.+)\|$/m;

/**
 * Blockquote line regex.
 */
export const BLOCKQUOTE_LINE_RE = /^>\s?(.*)$/;

/**
 * Attribution pattern inside a blockquote: `-- Author, Title` or `- Author, Title`
 */
export const ATTRIBUTION_RE = /^-{1,2}\s*(.+)$/;

/**
 * Bold-colon list item pattern: `- **Title**: description`
 * Groups: 1=title (inside bold), 2=description
 */
export const BOLD_COLON_RE = /^\*\*(.+?)\*\*[:\u2013\u2014\-]\s*(.*)$/;

/**
 * Heading regex. Groups: 1=hashes, 2=text
 */
export const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Slide separator: a line that is exactly `---` (with optional surrounding whitespace).
 */
export const SLIDE_SEPARATOR = '---';
