/**
 * Safe Slide Template Compiler
 *
 * A limited, safe template format for custom slide types.
 * No eval, no arbitrary code execution. Only a fixed set of helpers.
 *
 * Supported syntax:
 *   {{esc field}}       - HTML-escaped string value
 *   {{raw field}}       - Raw string (for pre-sanitized HTML like markdown output)
 *   {{markdown field}}  - Render markdown field to safe HTML
 *   {{bgClass field}}   - Output background CSS class (is-lime / is-mist / etc.)
 *   {{#if field}}...{{/if}}             - Conditional block
 *   {{#if field}}...{{else}}...{{/if}}  - Conditional with else
 *   {{#each field}}...{{/each}}         - Iterate over array items
 *   {{@index}}          - Current index inside {{#each}}
 *   {{this.key}}        - Access item property inside {{#each}}
 */

import { esc } from '../../shared/slide-types/helpers.js';

/**
 * Whether a markdown link URL uses a safe, navigable protocol. Anything else
 * (notably `javascript:`) is rendered as plain text instead of a link. The
 * compiled output is also DOMPurified downstream, but this keeps the helper
 * safe on its own, mirroring the http(s)-only rule in shared/markdown.js
 * (security-audit M1).
 * @param {string} url - Raw link URL from the markdown source
 * @returns {boolean}
 */
function isSafeLinkUrl(url) {
  return /^(https?:\/\/|mailto:)/i.test(String(url || '').trim());
}

/**
 * Minimal markdown-to-HTML converter for template use.
 * Handles paragraphs, bold, italic, links, and lists.
 */
function simpleMarkdownToHtml(md) {
  if (!md || typeof md !== 'string') return '';
  const links = [];
  // Extract links before escaping
  let html = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const idx = links.length;
    links.push({ label, url });
    return `\x00LINK${idx}\x00`;
  });
  // Escape remaining text
  html = esc(html);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Restore links with proper escaping. Drop unsafe-protocol links to plain
  // text so a `[x](javascript:…)` payload can't become a live href.
  html = html.replace(/\x00LINK(\d+)\x00/g, (_, idx) => {
    const link = links[Number(idx)];
    const label = esc(link.label);
    return isSafeLinkUrl(link.url) ? `<a href="${esc(link.url)}">${label}</a>` : label;
  });
  // Line breaks → paragraphs
  html = html
    .split(/\n{2,}/)
    .map((p) => `<p>${p.trim()}</p>`)
    .join('');
  // Single newlines → <br>
  html = html.replace(/\n/g, '<br>');
  return html;
}

/**
 * Resolve a dotted path against a data object.
 * Supports: "field", "this.field", "@index"
 */
function resolvePath(path, data, loopCtx) {
  if (!path || typeof path !== 'string') return undefined;
  const p = path.trim();

  // Loop-specific variables
  if (p === '@index') return loopCtx?.index ?? '';

  // "this.key" inside {{#each}}
  if (p.startsWith('this.') && loopCtx?.item != null) {
    const rest = p.slice(5);
    return loopCtx.item?.[rest];
  }
  if (p === 'this') return loopCtx?.item;

  // Simple key lookup on data
  return data?.[p];
}

/**
 * Check if a value is "truthy" for template conditionals.
 */
function isTruthy(val) {
  if (val == null) return false;
  if (val === false) return false;
  if (val === '') return false;
  if (val === 0) return false;
  if (Array.isArray(val) && val.length === 0) return false;
  return true;
}

/**
 * Background class helper.
 */
function bgClass(val) {
  const bg = String(val || 'lime').trim().toLowerCase();
  if (bg === 'mist') return 'is-mist';
  if (bg === 'transparent') return 'is-transparent';
  return 'is-lime';
}

// ============================================================
// TOKEN TYPES
// ============================================================
const T = {
  TEXT: 'text',
  ESC: 'esc',
  RAW: 'raw',
  MARKDOWN: 'markdown',
  BGCLASS: 'bgclass',
  IF_OPEN: 'if_open',
  ELSE: 'else',
  IF_CLOSE: 'if_close',
  EACH_OPEN: 'each_open',
  EACH_CLOSE: 'each_close',
  VAR: 'var',
};

/**
 * Tokenize a template string into an array of tokens.
 */
function tokenize(template) {
  const tokens = [];
  // Match {{ ... }} blocks
  const regex = /\{\{(.*?)\}\}/gs;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(template)) !== null) {
    // Text before this tag
    if (match.index > lastIndex) {
      tokens.push({ type: T.TEXT, value: template.slice(lastIndex, match.index) });
    }

    const inner = match[1].trim();

    if (inner.startsWith('#if ')) {
      tokens.push({ type: T.IF_OPEN, field: inner.slice(4).trim() });
    } else if (inner === 'else') {
      tokens.push({ type: T.ELSE });
    } else if (inner === '/if') {
      tokens.push({ type: T.IF_CLOSE });
    } else if (inner.startsWith('#each ')) {
      tokens.push({ type: T.EACH_OPEN, field: inner.slice(6).trim() });
    } else if (inner === '/each') {
      tokens.push({ type: T.EACH_CLOSE });
    } else if (inner.startsWith('esc ')) {
      tokens.push({ type: T.ESC, field: inner.slice(4).trim() });
    } else if (inner.startsWith('raw ')) {
      tokens.push({ type: T.RAW, field: inner.slice(4).trim() });
    } else if (inner.startsWith('markdown ')) {
      tokens.push({ type: T.MARKDOWN, field: inner.slice(9).trim() });
    } else if (inner.startsWith('bgClass ')) {
      tokens.push({ type: T.BGCLASS, field: inner.slice(8).trim() });
    } else {
      // Plain variable reference (treated as escaped)
      tokens.push({ type: T.VAR, field: inner });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < template.length) {
    tokens.push({ type: T.TEXT, value: template.slice(lastIndex) });
  }

  return tokens;
}

/**
 * Build an AST from flat tokens (handles nesting for #if and #each).
 */
function buildAst(tokens) {
  const root = [];
  const stack = [root];

  for (const token of tokens) {
    const current = stack[stack.length - 1];

    switch (token.type) {
      case T.IF_OPEN: {
        const node = { type: 'if', field: token.field, body: [], elseBody: [] };
        current.push(node);
        stack.push(node.body);
        break;
      }
      case T.ELSE: {
        // Pop body, push elseBody of the parent if node
        stack.pop();
        const parent = stack[stack.length - 1];
        const ifNode = parent[parent.length - 1];
        if (ifNode?.type === 'if') {
          stack.push(ifNode.elseBody);
        }
        break;
      }
      case T.IF_CLOSE:
        stack.pop();
        break;
      case T.EACH_OPEN: {
        const node = { type: 'each', field: token.field, body: [] };
        current.push(node);
        stack.push(node.body);
        break;
      }
      case T.EACH_CLOSE:
        stack.pop();
        break;
      default:
        current.push(token);
    }
  }

  return root;
}

/**
 * Evaluate an AST node list against data and loop context.
 */
function evaluate(nodes, data, loopCtx) {
  let out = '';
  for (const node of nodes) {
    switch (node.type) {
      case T.TEXT:
        out += node.value;
        break;
      case T.ESC:
        out += esc(String(resolvePath(node.field, data, loopCtx) ?? ''));
        break;
      case T.RAW:
        out += String(resolvePath(node.field, data, loopCtx) ?? '');
        break;
      case T.MARKDOWN:
        out += simpleMarkdownToHtml(
          String(resolvePath(node.field, data, loopCtx) ?? '')
        );
        break;
      case T.BGCLASS:
        out += bgClass(resolvePath(node.field, data, loopCtx));
        break;
      case T.VAR:
        out += esc(String(resolvePath(node.field, data, loopCtx) ?? ''));
        break;
      case 'if': {
        const val = resolvePath(node.field, data, loopCtx);
        if (isTruthy(val)) {
          out += evaluate(node.body, data, loopCtx);
        } else {
          out += evaluate(node.elseBody, data, loopCtx);
        }
        break;
      }
      case 'each': {
        const arr = resolvePath(node.field, data, loopCtx);
        if (Array.isArray(arr)) {
          for (let i = 0; i < arr.length; i++) {
            out += evaluate(node.body, data, { item: arr[i], index: i });
          }
        }
        break;
      }
    }
  }
  return out;
}

/**
 * Compile a template string into a render function.
 * The returned function accepts (content) and returns HTML.
 *
 * @param {string} template - Template string
 * @returns {Function} (content: Object) => string
 */
export function compileTemplate(template) {
  if (!template || typeof template !== 'string') {
    return () => '';
  }
  const tokens = tokenize(template);
  const ast = buildAst(tokens);

  return (content) => {
    const data = content && typeof content === 'object' ? content : {};
    return evaluate(ast, data, null);
  };
}

/**
 * Render a template string with data in one step.
 *
 * @param {string} template - Template string
 * @param {Object} content - Slide content data
 * @returns {string} Rendered HTML
 */
export function renderTemplate(template, content) {
  return compileTemplate(template)(content);
}
