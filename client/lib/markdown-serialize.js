/**
 * HTML/DOM → markdown serializer for the Deckyard slide dialect.
 *
 * The inverse of `shared/markdown.js`'s markdownToSafeHtml, plus tolerance
 * for the messier DOM a contenteditable edit produces (editing-surfaces
 * track, text phase): <b>/<i> from execCommand, <div> line wrappers, <br>,
 * style spans. This is what lets a markdown field be edited in place on the
 * canvas — the rendered block is edited as HTML and committed back as
 * markdown.
 *
 * Fidelity contract: serialization is only trusted when the round trip
 * proves itself for the exact content being edited —
 * `canInlineEditMarkdown(raw)` renders raw, serializes the result, renders
 * that, and requires identical HTML. Content that fails the check (or uses
 * the constructs listed in markdownNeedsModal) keeps the raw-markdown modal.
 *
 * Dialect notes (mirror shared/markdown.js precisely):
 * - blocks: paragraphs, `## ` → h3 (the ONLY heading level), nested -/1.
 *   lists (2-space indent per level), fenced code, $$ math, pipe tables
 * - inline: [text](http(s)://…), **bold**, *italic*, `code`, $math$
 * - there is NO escape syntax; literal asterisks re-italicize on render.
 */

/**
 * Does this markdown source use constructs whose in-place editing UX is
 * poor (or whose serialization is risky)? Such fields keep the modal.
 * @param {string} markdown - raw stored markdown
 * @returns {boolean}
 */
export function markdownNeedsModal(markdown) {
  const s = String(markdown || '');
  if (s.includes('```')) return true; // fenced code
  if (s.includes('$$')) return true; // math block
  if (/`[^`\n]+`/.test(s)) return true; // inline code
  // Inline math — mirror extractInlineMath in shared/markdown.js exactly,
  // including its currency skip, so "costs $50 and $60" stays editable.
  const mathRe = /\$([^\s$][^$]*?[^\s$])\$|\$([^\s$])\$/g;
  let m;
  while ((m = mathRe.exec(s))) {
    const math = m[1] || m[2];
    if (math && !/^[\d.,]+$/.test(math)) return true;
  }
  // Pipe table: any pipe-bearing line plus a separator-ish line.
  if (/\|.*\|/.test(s) && /\|[\s:-]*-{3,}[\s:|-]*/.test(s)) return true;
  return false;
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'PRE', 'TABLE', 'BLOCKQUOTE', 'SECTION', 'ARTICLE',
]);

/** Collapse runs of whitespace the way the renderer's paragraph pass does. */
function collapseWs(s) {
  return String(s || '').replace(/\s+/g, ' ');
}

/**
 * Serialize ONE inline node (element or text) to markdown, wrapper markers
 * included.
 * @param {Node} node
 * @returns {string}
 */
function serializeInlineNode(node) {
  if (node.nodeType === 3) return collapseWs(node.nodeValue);
  if (node.nodeType !== 1) return '';
  const tag = node.tagName;
  if (tag === 'BR') {
    // Inside an inline run a <br> has no dialect equivalent (paragraphs
    // collapse newlines); treat as a space. Block-level <br> handling
    // (paragraph split) happens in serializeBlocks.
    return ' ';
  }
  if (tag === 'STRONG' || tag === 'B') {
    const inner = serializeInline(node).trim();
    return inner ? `**${inner}**` : '';
  }
  if (tag === 'EM' || tag === 'I') {
    const inner = serializeInline(node).trim();
    return inner ? `*${inner}*` : '';
  }
  if (tag === 'CODE') {
    const inner = node.textContent || '';
    return inner ? `\`${inner}\`` : '';
  }
  if (tag === 'A') {
    const href = node.getAttribute('href') || '';
    const inner = serializeInline(node).trim();
    if (/^https?:\/\//.test(href) && inner) return `[${inner}](${href})`;
    return inner; // unlinkable in the dialect: keep the text
  }
  if (node.classList?.contains('md-math-inline')) {
    const math = node.getAttribute('data-math') || node.textContent || '';
    return math ? `$${math}$` : '';
  }
  // Unknown inline wrapper (style spans, u/s/mark…): keep the text,
  // drop the unrepresentable formatting.
  return serializeInline(node);
}

/**
 * Serialize a container's inline CONTENT to markdown (no block handling).
 * @param {Node} node
 * @returns {string}
 */
function serializeInline(node) {
  let out = '';
  for (const child of node.childNodes) out += serializeInlineNode(child);
  return out;
}

/**
 * Serialize a <ul>/<ol> (possibly nested the way buildList nests: child
 * lists live INSIDE the parent <li>) into indent-nested markdown lines.
 * @param {Element} listEl
 * @param {number} depth
 * @param {string[]} lines - output accumulator
 */
function serializeList(listEl, depth, lines) {
  const ordered = listEl.tagName === 'OL';
  let n = 0;
  for (const li of listEl.children) {
    if (li.tagName !== 'LI') continue;
    n += 1;
    // The li's own text = its inline children minus any nested lists.
    let text = '';
    const nested = [];
    for (const child of li.childNodes) {
      if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
        nested.push(child);
      } else if (child.nodeType === 1 && child.tagName === 'P') {
        // contenteditable can wrap li text in a <p>; unwrap it.
        text += serializeInline(child);
      } else {
        text += serializeInlineNode(child);
      }
    }
    const marker = ordered ? `${n}.` : '-';
    lines.push(`${'  '.repeat(depth)}${marker} ${text.trim()}`);
    for (const sub of nested) serializeList(sub, depth + 1, lines);
  }
}

/** Serialize a rendered pipe table (.md-table markup) back to markdown. */
function serializeTable(tableEl, blocks) {
  const headCells = [...tableEl.querySelectorAll('thead th')].map((th) =>
    serializeInline(th).trim()
  );
  const bodyRows = [...tableEl.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.children].map((td) => serializeInline(td).trim())
  );
  if (!headCells.length) return;
  const lines = [
    `| ${headCells.join(' | ')} |`,
    `| ${headCells.map(() => '---').join(' | ')} |`,
    ...bodyRows.map((r) => `| ${r.join(' | ')} |`),
  ];
  blocks.push(lines.join('\n'));
}

/**
 * Serialize one block-level element into the blocks accumulator.
 * @param {Element} el
 * @param {string[]} blocks
 */
function serializeBlockElement(el, blocks) {
  const tag = el.tagName;
  if (tag === 'UL' || tag === 'OL') {
    const lines = [];
    serializeList(el, 0, lines);
    if (lines.length) blocks.push(lines.join('\n'));
    return;
  }
  if (/^H[1-6]$/.test(tag)) {
    // The dialect supports exactly one heading level (## → h3).
    const text = serializeInline(el).trim();
    if (text) blocks.push(`## ${text}`);
    return;
  }
  if (tag === 'PRE') {
    const code = el.querySelector('code');
    const lang = el.getAttribute('data-lang') || '';
    const body = (code ? code.textContent : el.textContent) || '';
    blocks.push(`\`\`\`${lang}\n${body}\n\`\`\``);
    return;
  }
  if (el.classList.contains('md-math-block')) {
    const math = el.getAttribute('data-math') || el.textContent || '';
    if (math.trim()) blocks.push(`$$${math.trim()}$$`);
    return;
  }
  if (el.classList.contains('md-table-wrap') || tag === 'TABLE') {
    const table = tag === 'TABLE' ? el : el.querySelector('table');
    if (table) serializeTable(table, blocks);
    return;
  }
  // P, DIV, BLOCKQUOTE, …: a paragraph-ish container. A contenteditable
  // <div> line may itself contain <br>s meaning "new paragraph" (single
  // newlines don't survive the dialect's paragraph join anyway).
  serializeBlocks(el, blocks);
}

/**
 * Walk a container's children, flushing consecutive inline content into
 * paragraph blocks and delegating block elements.
 * @param {Element|DocumentFragment} root
 * @param {string[]} blocks
 */
function serializeBlocks(root, blocks) {
  let run = '';
  const flush = () => {
    const text = run.replace(/\s+/g, ' ').trim();
    if (text) blocks.push(text);
    run = '';
  };
  for (const child of root.childNodes) {
    if (child.nodeType === 3) {
      run += collapseWs(child.nodeValue);
      continue;
    }
    if (child.nodeType !== 1) continue;
    if (child.tagName === 'BR') {
      // A block-level <br> splits paragraphs (contenteditable's empty-line).
      flush();
      continue;
    }
    if (BLOCK_TAGS.has(child.tagName) || child.classList.contains('md-math-block')) {
      flush();
      serializeBlockElement(child, blocks);
      continue;
    }
    run += serializeInlineNode(child);
  }
  flush();
}

/**
 * Serialize a DOM subtree (rendered markdown, possibly mutated by a
 * contenteditable session) back to dialect markdown.
 * @param {Element} root - container whose CHILDREN are the block content
 * @returns {string} markdown
 */
export function serializeMarkdownDom(root) {
  if (!root) return '';
  const blocks = [];
  serializeBlocks(root, blocks);
  return blocks.join('\n\n');
}

/**
 * May this markdown content be edited in place? True only when the content
 * avoids modal-only constructs AND the serializer provably round-trips it:
 * render(serialize(render(raw))) must equal render(raw) byte-for-byte (both
 * sides come from the same renderer, so equality is well-defined).
 *
 * @param {string} raw - the stored markdown
 * @param {Function} renderMarkdown - shared/markdown.js markdownToSafeHtml
 * @param {Document} [doc] - document to parse with (defaults to global)
 * @returns {boolean}
 */
export function canInlineEditMarkdown(raw, renderMarkdown, doc = globalThis.document) {
  const s = String(raw || '');
  if (!s.trim()) return true; // empty: nothing to lose
  if (markdownNeedsModal(s)) return false;
  if (typeof renderMarkdown !== 'function' || !doc) return false;
  try {
    const html = renderMarkdown(s);
    const scratch = doc.createElement('div');
    scratch.innerHTML = html;
    const md2 = serializeMarkdownDom(scratch);
    return renderMarkdown(md2) === html;
  } catch {
    return false;
  }
}
