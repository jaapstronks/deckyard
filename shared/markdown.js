import { escapeHtml } from './slide-types/helpers.js';
import { sanitizeHtmlSync, sanitizeInlineSync } from './sanitize.js';

// Placeholder tokens for code/math content that should not be processed
const CODE_BLOCK_PLACEHOLDER = '\x00CB\x00';
const INLINE_CODE_PLACEHOLDER = '\x00IC\x00';
const MATH_BLOCK_PLACEHOLDER = '\x00MB\x00';
const INLINE_MATH_PLACEHOLDER = '\x00IM\x00';
// Links and backslash-escapes are also parked as placeholders during inline
// formatting so emphasis passes can't reach inside an <a> (URLs contain
// underscores) and so an escaped marker like \* never triggers emphasis.
const LINK_PLACEHOLDER = '\x00LK\x00';
const ESCAPE_PLACEHOLDER = '\x00ES\x00';

// CommonMark backslash escapes: a backslash before any ASCII punctuation
// (backslash itself included) yields that literal punctuation character.
const BACKSLASH_ESCAPE_RE =
  /\\([!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~])/g;

/**
 * Pull CommonMark backslash escapes out of `text` into placeholders so an
 * escaped marker (`\*`, `\_`, `\[`, `\|`, …) never triggers emphasis, a link,
 * or a table cell. Run this AFTER code/math extraction so literal backslashes
 * inside code spans and math survive (e.g. a `\d` in inline code); escaped
 * code/math delimiters themselves (`` \` ``, `\$`) are therefore not honoured,
 * which is an accepted boundary. The escaped character is restored
 * (HTML-escaped) at the very end of inlineFormat.
 * @returns {{ text: string, escapes: string[] }}
 */
function extractBackslashEscapes(text) {
  const escapes = [];
  const result = String(text).replace(BACKSLASH_ESCAPE_RE, (_m, ch) => {
    escapes.push(ch);
    return `${ESCAPE_PLACEHOLDER}${escapes.length - 1}${ESCAPE_PLACEHOLDER}`;
  });
  return { text: result, escapes };
}

/**
 * Extract code blocks (```lang\n...\n```) and replace with placeholders.
 * Returns { text, blocks } where blocks is an array of { lang, code }.
 */
function extractCodeBlocks(text) {
  const blocks = [];
  const result = text.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang, code) => {
      blocks.push({ lang: lang || '', code: code.replace(/\n$/, '') });
      return `${CODE_BLOCK_PLACEHOLDER}${blocks.length - 1}${CODE_BLOCK_PLACEHOLDER}`;
    }
  );
  return { text: result, blocks };
}

/**
 * Extract inline code (`...`) and replace with placeholders.
 * Returns { text, codes } where codes is an array of code strings.
 */
function extractInlineCode(text) {
  const codes = [];
  const result = text.replace(
    /`([^`\n]+)`/g,
    (_match, code) => {
      codes.push(code);
      return `${INLINE_CODE_PLACEHOLDER}${codes.length - 1}${INLINE_CODE_PLACEHOLDER}`;
    }
  );
  return { text: result, codes };
}

/**
 * Extract math blocks ($$...$$) and replace with placeholders.
 * Supports both $$\n...\n$$ and $$...$$ formats.
 */
function extractMathBlocks(text) {
  const blocks = [];
  const result = text.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_match, math) => {
      blocks.push(math.trim());
      return `${MATH_BLOCK_PLACEHOLDER}${blocks.length - 1}${MATH_BLOCK_PLACEHOLDER}`;
    }
  );
  return { text: result, blocks };
}

/**
 * Extract inline math ($...$) and replace with placeholders.
 * Avoids matching currency like $50 by requiring non-digit after opening $.
 */
function extractInlineMath(text) {
  const maths = [];
  // Match $...$ but not $$...$$ (already extracted) and not currency like $50
  // Require: opening $ followed by non-space non-digit, content, non-space, closing $
  const result = text.replace(
    /\$([^\s$][^$]*?[^\s$])\$|\$([^\s$])\$/g,
    (_match, multi, single) => {
      const math = multi || single;
      if (!math) return _match;
      // Skip if it looks like currency (just digits/punctuation)
      if (/^[\d.,]+$/.test(math)) return _match;
      maths.push(math);
      return `${INLINE_MATH_PLACEHOLDER}${maths.length - 1}${INLINE_MATH_PLACEHOLDER}`;
    }
  );
  return { text: result, maths };
}

/**
 * Generic placeholder restoration helper.
 * Replaces placeholder tokens with rendered HTML using the provided render function.
 * @param {string} html - The HTML string containing placeholders
 * @param {string} placeholder - The placeholder token (e.g., CODE_BLOCK_PLACEHOLDER)
 * @param {Array} items - Array of items to restore
 * @param {Function} renderFn - Function(item, idx) => HTML string
 * @returns {string} HTML with placeholders replaced
 */
function restorePlaceholders(html, placeholder, items, renderFn) {
  return html.replace(
    new RegExp(`${placeholder}(\\d+)${placeholder}`, 'g'),
    (_match, idx) => {
      const item = items[parseInt(idx, 10)];
      if (item === undefined || item === null) return '';
      return renderFn(item, parseInt(idx, 10));
    }
  );
}

/**
 * Restore inline code from placeholders to HTML.
 */
function restoreInlineCode(html, codes) {
  return restorePlaceholders(html, INLINE_CODE_PLACEHOLDER, codes, (code) => {
    return `<code class="md-code-inline">${escapeHtml(code)}</code>`;
  });
}

/**
 * Restore inline math from placeholders to HTML.
 */
function restoreInlineMath(html, maths) {
  return restorePlaceholders(html, INLINE_MATH_PLACEHOLDER, maths, (math) => {
    return `<span class="md-math-inline" data-math="${escapeHtml(math)}">${escapeHtml(math)}</span>`;
  });
}

function inlineFormat(s, { inlineCodes = [], inlineMaths = [], escapes = [] } = {}) {
  // `s` already carries escape placeholders (extracted after code/math so an
  // escaped marker like \* never triggers emphasis); they are restored as
  // literal characters at the very end.

  // Start from escaped text; then allow a tiny safe subset.
  let out = escapeHtml(s);

  // Links: [text](https://example.com). Parked as placeholders so the emphasis
  // passes below can't mangle an <a> whose href/text contains * or _.
  const links = [];
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, href) => {
      const safeText = escapeHtml(text);
      const safeHref = escapeHtml(href);
      links.push(
        `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>`
      );
      return `${LINK_PLACEHOLDER}${links.length - 1}${LINK_PLACEHOLDER}`;
    }
  );

  // Bold + italic with `*`. Keep simple, non-nested.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Bold + italic with `_`. CommonMark intraword rule: an underscore flanked
  // by word characters stays literal, so snake_case and file_names survive.
  out = out.replace(/(?<![A-Za-z0-9])__([^_]+)__(?![A-Za-z0-9])/g, '<strong>$1</strong>');
  out = out.replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, '<em>$1</em>');

  // Restore links first (they may carry inline-code/math placeholders in their
  // text), then code/math, then the literal escaped characters last.
  out = restorePlaceholders(out, LINK_PLACEHOLDER, links, (link) => link);
  out = restoreInlineCode(out, inlineCodes);
  out = restoreInlineMath(out, inlineMaths);
  // Literal escaped characters last (after every marker pass has run).
  out = restorePlaceholders(out, ESCAPE_PLACEHOLDER, escapes, (ch) => escapeHtml(ch));

  return out;
}

// Exported so slide types / editor UIs can reuse the exact same safe inline formatting.
// Defense-in-depth: applies DOMPurify sanitization as final step.
export function inlineMarkdownToSafeHtml(s) {
  let text = String(s || '');

  // Extract inline code and math first, then backslash escapes on the prose
  // that remains (so a literal backslash inside code/math survives).
  const { text: t1, codes: inlineCodes } = extractInlineCode(text);
  const { text: t2, maths: inlineMaths } = extractInlineMath(t1);
  const { text: t3, escapes } = extractBackslashEscapes(t2);

  const result = inlineFormat(t3, { inlineCodes, inlineMaths, escapes });
  // Apply DOMPurify as defense-in-depth (strips any tags that shouldn't be inline)
  return sanitizeInlineSync(result);
}

function splitTableRow(line) {
  let s = String(line || '').trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function isTableHeaderLine(line) {
  const s = String(line || '').trim();
  if (!s) return false;
  if (!s.includes('|')) return false;
  const cells = splitTableRow(s);
  return (
    cells.length >= 2 &&
    cells.some((c) => c.trim().length > 0)
  );
}

function isTableSeparatorLine(line) {
  const s = String(line || '').trim();
  if (!s) return false;
  if (!s.includes('-')) return false;
  if (!s.includes('|')) return false;
  const parts = splitTableRow(s);
  if (parts.length < 2) return false;
  return parts.every((p) =>
    /^:?-{3,}:?$/.test(p.replace(/\s+/g, ''))
  );
}

// A list item: leading indentation, a marker (-, *, + unordered, or "N."
// ordered), then the content. Indentation determines nesting depth.
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

// A blockquote line: optional indent, `>`, optional single space, content.
const BLOCKQUOTE_LINE_RE = /^\s*>\s?/;

/**
 * Build (possibly nested) list HTML from a run of consecutive list-item lines.
 * Nesting is derived from each line's leading indentation: a more-indented item
 * opens a child list inside the previous <li>; a less-indented item closes back
 * out to the matching level. Ordered vs unordered is chosen per level from the
 * first item's marker at that level.
 * @param {string[]} itemLines - Consecutive lines each matching LIST_ITEM_RE.
 * @param {{inlineCodes: string[], inlineMaths: string[]}} inlineOpts
 * @returns {string} Well-formed nested <ul>/<ol> HTML.
 */
function buildList(itemLines, inlineOpts) {
  const items = itemLines.map((line) => {
    const m = line.match(LIST_ITEM_RE);
    // Treat tabs as two spaces so indentation compares consistently.
    const indent = m[1].replace(/\t/g, '  ').length;
    return { indent, ordered: /^\d+\.$/.test(m[2]), content: m[3] };
  });

  let html = '';
  const stack = []; // { indent, tag } for each currently-open list level
  const top = () => stack[stack.length - 1];

  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    // Close any levels deeper than this item's indentation.
    while (stack.length && it.indent < top().indent) {
      html += `</li></${top().tag}>`;
      stack.pop();
    }
    if (!stack.length || it.indent > top().indent) {
      // Open a new (possibly nested) list inside the current open <li>.
      html += `<${tag} dir="auto"><li dir="auto">${inlineFormat(it.content, inlineOpts)}`;
      stack.push({ indent: it.indent, tag });
    } else {
      // Same level: close the previous <li> and open a sibling. (The level's
      // list tag is kept even if this marker differs, since a single level
      // can't be both ordered and unordered.)
      html += `</li><li dir="auto">${inlineFormat(it.content, inlineOpts)}`;
    }
  }
  while (stack.length) {
    html += `</li></${top().tag}>`;
    stack.pop();
  }
  return html;
}

export function markdownToSafeHtml(markdown) {
  let text = String(markdown || '').replace(/\r\n/g, '\n');

  // 1. Extract code blocks FIRST (before any other processing)
  const { text: t1, blocks: codeBlocks } = extractCodeBlocks(text);

  // 2. Extract math blocks ($$...$$) before line processing
  const { text: t2, blocks: mathBlocks } = extractMathBlocks(t1);

  // 3. Extract inline code and math for later restoration
  const { text: t3, codes: inlineCodes } = extractInlineCode(t2);
  const { text: t4, maths: inlineMaths } = extractInlineMath(t3);

  // 4. Extract backslash escapes LAST (prose only, so literal backslashes
  //    inside code/math survive). Shared inline options for every inlineFormat.
  const { text: t5, escapes } = extractBackslashEscapes(t4);
  const inlineOpts = { inlineCodes, inlineMaths, escapes };

  const lines = t5.split('\n');

  const blocks = [];
  let i = 0;

  // Helper regex patterns for placeholders
  const codeBlockPlaceholderRegex = new RegExp(
    `^\\s*${CODE_BLOCK_PLACEHOLDER.replace(/\x00/g, '\\x00')}(\\d+)${CODE_BLOCK_PLACEHOLDER.replace(/\x00/g, '\\x00')}\\s*$`
  );
  const mathBlockPlaceholderRegex = new RegExp(
    `^\\s*${MATH_BLOCK_PLACEHOLDER.replace(/\x00/g, '\\x00')}(\\d+)${MATH_BLOCK_PLACEHOLDER.replace(/\x00/g, '\\x00')}\\s*$`
  );

  while (i < lines.length) {
    // Skip blank lines
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }

    // Check for code block placeholder (standalone line)
    const codeMatch = lines[i].match(codeBlockPlaceholderRegex);
    if (codeMatch) {
      const idx = parseInt(codeMatch[1], 10);
      const block = codeBlocks[idx];
      if (block) {
        const langClass = block.lang ? `language-${escapeHtml(block.lang)}` : '';
        const langAttr = block.lang ? ` data-lang="${escapeHtml(block.lang)}"` : '';
        const escapedCode = escapeHtml(block.code);
        blocks.push(`<pre class="md-code-block"${langAttr} dir="ltr"><code class="${langClass}">${escapedCode}</code></pre>`);
      }
      i += 1;
      continue;
    }

    // Check for math block placeholder (standalone line)
    const mathMatch = lines[i].match(mathBlockPlaceholderRegex);
    if (mathMatch) {
      const idx = parseInt(mathMatch[1], 10);
      const math = mathBlocks[idx];
      if (math !== undefined) {
        blocks.push(`<div class="md-math-block" data-math="${escapeHtml(math)}">${escapeHtml(math)}</div>`);
      }
      i += 1;
      continue;
    }

    // Markdown tables (pipe tables)
    // Example:
    // | Col A | Col B |
    // | --- | --- |
    // | Val | Val |
    if (
      isTableHeaderLine(lines[i]) &&
      isTableSeparatorLine(lines[i + 1] || '')
    ) {
      const headerCells = splitTableRow(lines[i]);
      const colCount = headerCells.length;
      i += 2; // skip header + separator

      const rows = [];
      while (
        i < lines.length &&
        String(lines[i] || '').trim() &&
        String(lines[i] || '').includes('|')
      ) {
        const cells = splitTableRow(lines[i]);
        // Normalize to header column count
        const normalized = Array.from(
          { length: colCount },
          (_v, idx) =>
            cells[idx] == null ? '' : String(cells[idx])
        );
        rows.push(normalized);
        i += 1;
      }

      const thead = `<thead><tr>${headerCells
        .slice(0, colCount)
        .map((c) => `<th dir="auto">${inlineFormat(c, inlineOpts)}</th>`)
        .join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map(
          (r) =>
            `<tr>${r
              .map((c) => `<td dir="auto">${inlineFormat(c, inlineOpts)}</td>`)
              .join('')}</tr>`
        )
        .join('')}</tbody>`;
      blocks.push(
        `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`
      );
      continue;
    }

    // Headings: only ## is supported as a subheading within slide content.
    // Renders as <h3> since slide titles are <h2> (semantic document hierarchy).
    // Other heading levels (#, ###) are treated as regular paragraphs.
    if (/^\s*##\s+/.test(lines[i])) {
      const raw = lines[i].replace(/^\s*##\s+/, '');
      blocks.push(
        `<h3 class="md-subheading" dir="auto">${inlineFormat(raw, inlineOpts)}</h3>`
      );
      i += 1;
      continue;
    }

    // Blockquotes: a run of consecutive lines starting with `>`. Inner content
    // is rendered as paragraphs (blank `>` lines split paragraphs); nested
    // blocks inside a quote (lists, headings, fences) are not supported here.
    if (BLOCKQUOTE_LINE_RE.test(lines[i])) {
      const quoteLines = [];
      while (i < lines.length && BLOCKQUOTE_LINE_RE.test(lines[i])) {
        quoteLines.push(lines[i].replace(BLOCKQUOTE_LINE_RE, ''));
        i += 1;
      }
      const inner = [];
      let qpara = [];
      const flushQuotePara = () => {
        const txt = qpara.join(' ').replace(/\s+/g, ' ').trim();
        if (txt) {
          inner.push(
            `<p dir="auto">${inlineFormat(txt, inlineOpts)}</p>`
          );
        }
        qpara = [];
      };
      for (const ql of quoteLines) {
        if (!ql.trim()) flushQuotePara();
        else qpara.push(ql);
      }
      flushQuotePara();
      if (inner.length) {
        blocks.push(`<blockquote dir="auto">${inner.join('')}</blockquote>`);
      }
      continue;
    }

    // Lists (unordered "- foo" and ordered "1. foo"), with nesting driven by
    // leading indentation. Both kinds are collected into one run so a mixed /
    // nested list (e.g. bullets under a numbered item) builds correctly.
    if (LIST_ITEM_RE.test(lines[i])) {
      const itemLines = [];
      while (i < lines.length && LIST_ITEM_RE.test(lines[i])) {
        itemLines.push(lines[i]);
        i += 1;
      }
      blocks.push(buildList(itemLines, inlineOpts));
      continue;
    }

    // Paragraph: consume until blank line or a new block starter (list/heading/code/math placeholder)
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*#{1,3}\s+/.test(lines[i]) &&
      !BLOCKQUOTE_LINE_RE.test(lines[i]) &&
      !codeBlockPlaceholderRegex.test(lines[i]) &&
      !mathBlockPlaceholderRegex.test(lines[i]) &&
      !(
        isTableHeaderLine(lines[i]) &&
        isTableSeparatorLine(lines[i + 1] || '')
      )
    ) {
      para.push(lines[i]);
      i += 1;
    }
    // A block-starter line no handler consumed (e.g. `# ` / `### ` — only
    // `## ` is a heading in this dialect) would leave `para` empty WITHOUT
    // advancing `i`, spinning the outer loop forever. Consume it as a plain
    // paragraph line, which is the documented behaviour for those headings.
    if (!para.length && i < lines.length) {
      para.push(lines[i]);
      i += 1;
    }
    const paraText = para.join(' ').replace(/\s+/g, ' ').trim();
    if (paraText) {
      blocks.push(`<p dir="auto">${inlineFormat(paraText, inlineOpts)}</p>`);
    }
  }

  const result = blocks.join('\n');
  // Defense-in-depth: apply DOMPurify sanitization as final step
  return sanitizeHtmlSync(result);
}

export function parseMarkdownTable(markdown) {
  // Parse the *first* pipe table found in the input.
  // Returns { header: string[], rows: string[][], colCount: number } or null.
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .split('\n');

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (
      isTableHeaderLine(lines[i]) &&
      isTableSeparatorLine(lines[i + 1] || '')
    ) {
      const header = splitTableRow(lines[i]);
      const colCount = Math.max(1, header.length);
      i += 2; // skip header + separator

      const rows = [];
      while (
        i < lines.length &&
        String(lines[i] || '').trim() &&
        String(lines[i] || '').includes('|')
      ) {
        const cells = splitTableRow(lines[i]);
        const normalized = Array.from(
          { length: colCount },
          (_v, idx) => (cells[idx] == null ? '' : String(cells[idx]))
        );
        rows.push(normalized);
        i += 1;
      }

      return { header, rows, colCount };
    }
  }
  return null;
}

// Alias for backwards compatibility
export { markdownToSafeHtml as renderMarkdown };