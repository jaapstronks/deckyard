import { t } from '../../../lib/ui-i18n.js';

export function createBasicFields({ h } = {}) {
  const fieldText = (label, value, onChange, opts = {}) => {
    const input = h('input', {
      class: 'form-input',
      value,
    });
    const maxLength = Number(opts?.maxLength || 0) || 0;
    if (maxLength > 0) input.maxLength = maxLength;
    if (opts?.required) input.required = true;
    if (typeof opts?.placeholder === 'string')
      input.placeholder = opts.placeholder;
    input.addEventListener('input', () => onChange(input.value));
    const helpText =
      typeof opts?.helpText === 'string' ? opts.helpText : '';
    const helpCopyExample =
      typeof opts?.helpCopyExample === 'string' ? opts.helpCopyExample : '';
    const labelRightEl = opts?.labelRightEl || null;

    // Build help element with optional copy button
    let helpEl = null;
    if (helpText || helpCopyExample) {
      const helpChildren = [];
      if (helpText) {
        helpChildren.push(h('span', { text: helpText }));
      }
      if (helpCopyExample) {
        const copyBtn = h('button', {
          class: 'btn-copy-example',
          type: 'button',
          title: t('editor.fields.copyExampleTitle', 'Copy example to clipboard'),
          text: t('editor.fields.copyExample', 'Copy example'),
        });
        copyBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            await navigator.clipboard.writeText(helpCopyExample);
            copyBtn.textContent = t('editor.fields.copied', 'Copied!');
            setTimeout(() => {
              copyBtn.textContent = t('editor.fields.copyExample', 'Copy example');
            }, 1500);
          } catch {
            // Fallback: paste into input
            input.value = helpCopyExample;
            onChange(helpCopyExample);
          }
        });
        helpChildren.push(copyBtn);
      }
      helpEl = h('div', { class: 'help help-with-action' }, helpChildren);
    }

    return h('div', { class: 'stack is-field' }, [
      labelRightEl
        ? h('div', { class: 'field-head' }, [
            h('div', { class: 'field-label', text: label }),
            h('div', { class: 'field-actions' }, [labelRightEl]),
          ])
        : h('div', { class: 'field-label', text: label }),
      input,
      helpEl,
    ]);
  };

  const fieldNumber = (label, value, onChange, opts = {}) => {
    const input = h('input', {
      class: 'form-input',
      type: 'number',
      value: value == null ? '' : String(value),
    });
    if (opts?.required) input.required = true;
    if (opts?.min != null) input.min = String(opts.min);
    if (opts?.max != null) input.max = String(opts.max);
    if (opts?.step != null) input.step = String(opts.step);
    if (typeof opts?.placeholder === 'string')
      input.placeholder = opts.placeholder;
    input.addEventListener('input', () => {
      const raw = String(input.value ?? '');
      if (!raw.trim()) {
        onChange('');
        return;
      }
      const n = Number(raw);
      if (Number.isNaN(n)) {
        onChange('');
        return;
      }
      onChange(n);
    });
    const helpText =
      typeof opts?.helpText === 'string' ? opts.helpText : '';
    const labelRightEl = opts?.labelRightEl || null;
    // Numbers are short; hint the responsive row that this field wants little
    // width so it packs beside neighbours instead of hogging a full column.
    return h('div', { class: 'stack is-field is-field-narrow' }, [
      labelRightEl
        ? h('div', { class: 'field-head' }, [
            h('div', { class: 'field-label', text: label }),
            h('div', { class: 'field-actions' }, [labelRightEl]),
          ])
        : h('div', { class: 'field-label', text: label }),
      input,
      helpText ? h('div', { class: 'help', text: helpText }) : null,
    ]);
  };

  const fieldTextarea = (label, value, helpText, onChange, opts = {}) => {
    const ta = h('textarea', {
      class: 'form-input form-textarea-lg',
    });
    ta.value = value;
    const maxLength = Number(opts?.maxLength || 0) || 0;
    if (maxLength > 0) ta.maxLength = maxLength;
    if (opts?.required) ta.required = true;
    if (typeof opts?.placeholder === 'string')
      ta.placeholder = opts.placeholder;
    ta.addEventListener('input', () => onChange(ta.value));
    const labelRightEl = opts?.labelRightEl || null;
    // Multi-line inputs always claim their own line in a responsive row.
    return h('div', { class: 'stack is-field is-field-full' }, [
      labelRightEl
        ? h('div', { class: 'field-head' }, [
            h('div', { class: 'field-label', text: label }),
            h('div', { class: 'field-actions' }, [labelRightEl]),
          ])
        : h('div', { class: 'field-label', text: label }),
      ta,
      h('div', { class: 'help', text: helpText }),
    ]);
  };

  /**
   * Code field: monospace textarea that stores the raw string verbatim (no
   * markdown parsing, no HTML escaping on input). Used for the custom-HTML slide.
   * Supports opts.readOnly to render the value but block edits (capability gate).
   */
  const fieldCode = (label, value, helpText, onChange, opts = {}) => {
    const ta = h('textarea', {
      class: 'form-input form-textarea-code',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
      autocorrect: 'off',
    });
    ta.value = value;
    const maxLength = Number(opts?.maxLength || 0) || 0;
    if (maxLength > 0) ta.maxLength = maxLength;
    if (opts?.required) ta.required = true;
    if (typeof opts?.placeholder === 'string')
      ta.placeholder = opts.placeholder;
    if (opts?.readOnly) {
      ta.readOnly = true;
      ta.setAttribute('aria-readonly', 'true');
    } else {
      ta.addEventListener('input', () => onChange(ta.value));
      // Tab inserts two spaces instead of moving focus, for code-editing feel.
      ta.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || e.shiftKey) return;
        e.preventDefault();
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + 2;
        onChange(ta.value);
      });
    }
    const labelRightEl = opts?.labelRightEl || null;
    // Code always claims its own line in a responsive row.
    return h('div', { class: 'stack is-field is-field-full' }, [
      labelRightEl
        ? h('div', { class: 'field-head' }, [
            h('div', { class: 'field-label', text: label }),
            h('div', { class: 'field-actions' }, [labelRightEl]),
          ])
        : h('div', { class: 'field-label', text: label }),
      ta,
      helpText ? h('div', { class: 'help', text: helpText }) : null,
    ]);
  };

  /**
   * Markdown field with formatting toolbar.
   * Supports bold, italic, links, and (in larger fields) ## headings.
   */
  const fieldMarkdown = (label, value, helpText, onChange, opts = {}) => {
    const ta = h('textarea', {
      class: 'form-input form-textarea-lg',
    });
    ta.value = value;
    const maxLength = Number(opts?.maxLength || 0) || 0;
    if (maxLength > 0) ta.maxLength = maxLength;
    if (opts?.required) ta.required = true;
    if (typeof opts?.placeholder === 'string')
      ta.placeholder = opts.placeholder;
    ta.addEventListener('input', () => onChange(ta.value));

    // Helper to wrap selection with markers
    const wrapSelection = (before, after) => {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = ta.value;
      const selected = text.slice(start, end);
      const newText = text.slice(0, start) + before + selected + after + text.slice(end);
      ta.value = newText;
      onChange(newText);
      // Reselect the text (inside the markers)
      ta.focus();
      ta.setSelectionRange(start + before.length, end + before.length);
    };

    // Helper to insert text at cursor
    const insertAtCursor = (textToInsert) => {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = ta.value;
      const newText = text.slice(0, start) + textToInsert + text.slice(end);
      ta.value = newText;
      onChange(newText);
      ta.focus();
      ta.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
    };

    // Bold button
    const btnBold = h('button', {
      class: 'md-toolbar-btn',
      type: 'button',
      title: t('editor.markdown.bold', 'Bold'),
    });
    btnBold.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>';
    btnBold.addEventListener('click', (e) => {
      e.preventDefault();
      wrapSelection('**', '**');
    });

    // Italic button
    const btnItalic = h('button', {
      class: 'md-toolbar-btn',
      type: 'button',
      title: t('editor.markdown.italic', 'Italic'),
    });
    btnItalic.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>';
    btnItalic.addEventListener('click', (e) => {
      e.preventDefault();
      wrapSelection('*', '*');
    });

    // Link button
    const btnLink = h('button', {
      class: 'md-toolbar-btn',
      type: 'button',
      title: t('editor.markdown.link', 'Link'),
    });
    btnLink.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    btnLink.addEventListener('click', (e) => {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = ta.value.slice(start, end);
      if (selected) {
        // Wrap selected text as link text
        wrapSelection('[', '](https://)');
        // Position cursor inside the URL parentheses
        ta.setSelectionRange(end + 3, end + 11);
      } else {
        // Insert link template
        insertAtCursor('[link text](https://)');
        // Select "link text" for easy replacement
        ta.setSelectionRange(start + 1, start + 10);
      }
    });

    // Heading button (only for larger text fields)
    const btnHeading = h('button', {
      class: 'md-toolbar-btn',
      type: 'button',
      title: t('editor.markdown.heading', 'Heading'),
    });
    btnHeading.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><path d="M17 10v8"/><path d="M21 10h-4l3-3"/></svg>';
    btnHeading.addEventListener('click', (e) => {
      e.preventDefault();
      const start = ta.selectionStart;
      const text = ta.value;
      // Find line start
      let lineStart = start;
      while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart--;
      // Check if line already starts with ##
      const linePrefix = text.slice(lineStart, lineStart + 3);
      if (linePrefix === '## ') {
        // Remove the ##
        const newText = text.slice(0, lineStart) + text.slice(lineStart + 3);
        ta.value = newText;
        onChange(newText);
        ta.focus();
        ta.setSelectionRange(start - 3, start - 3);
      } else {
        // Add ## at line start
        const newText = text.slice(0, lineStart) + '## ' + text.slice(lineStart);
        ta.value = newText;
        onChange(newText);
        ta.focus();
        ta.setSelectionRange(start + 3, start + 3);
      }
    });

    // Inline code button
    const btnInlineCode = h('button', {
      class: 'md-toolbar-btn',
      type: 'button',
      title: t('editor.markdown.inlineCode', 'Inline Code'),
    });
    btnInlineCode.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
    btnInlineCode.addEventListener('click', (e) => {
      e.preventDefault();
      wrapSelection('`', '`');
    });

    // Code block button
    const btnCodeBlock = h('button', {
      class: 'md-toolbar-btn',
      type: 'button',
      title: t('editor.markdown.codeBlock', 'Code Block'),
    });
    btnCodeBlock.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 8 5 12 9 16"/><polyline points="15 8 19 12 15 16"/></svg>';
    btnCodeBlock.addEventListener('click', (e) => {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = ta.value;
      const selected = text.slice(start, end);
      if (selected) {
        // Wrap selected text in code block
        const newText = text.slice(0, start) + '```\n' + selected + '\n```' + text.slice(end);
        ta.value = newText;
        onChange(newText);
        ta.focus();
        ta.setSelectionRange(start + 4, start + 4 + selected.length);
      } else {
        // Insert code block template
        insertAtCursor('```javascript\n\n```');
        // Position cursor inside the block
        ta.setSelectionRange(start + 14, start + 14);
      }
    });

    // Inline math button
    const btnInlineMath = h('button', {
      class: 'md-toolbar-btn',
      type: 'button',
      title: t('editor.markdown.inlineMath', 'Inline Math'),
    });
    btnInlineMath.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4L4 20"/><path d="M20 4L12 20"/><path d="M8 12h8"/></svg>';
    btnInlineMath.addEventListener('click', (e) => {
      e.preventDefault();
      wrapSelection('$', '$');
    });

    // Block math button
    const btnBlockMath = h('button', {
      class: 'md-toolbar-btn',
      type: 'button',
      title: t('editor.markdown.blockMath', 'Block Math'),
    });
    btnBlockMath.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 8L7 16"/><path d="M17 8L15 16"/><path d="M7 12h4"/><path d="M13 12h4"/></svg>';
    btnBlockMath.addEventListener('click', (e) => {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = ta.value;
      const selected = text.slice(start, end);
      if (selected) {
        // Wrap selected text in block math
        const newText = text.slice(0, start) + '$$\n' + selected + '\n$$' + text.slice(end);
        ta.value = newText;
        onChange(newText);
        ta.focus();
        ta.setSelectionRange(start + 3, start + 3 + selected.length);
      } else {
        // Insert block math template
        insertAtCursor('$$\n\n$$');
        // Position cursor inside the block
        ta.setSelectionRange(start + 3, start + 3);
      }
    });

    // Toolbar separator
    const toolbarSep = () => h('div', { class: 'md-toolbar-sep' });

    // Build toolbar
    const showHeadingBtn = opts?.showHeading !== false;
    const showCodeMath = opts?.showCodeMath !== false;
    const toolbarChildren = [btnBold, btnItalic, btnLink];
    if (showHeadingBtn) toolbarChildren.push(btnHeading);
    if (showCodeMath) {
      toolbarChildren.push(toolbarSep());
      toolbarChildren.push(btnInlineCode);
      toolbarChildren.push(btnCodeBlock);
      toolbarChildren.push(toolbarSep());
      toolbarChildren.push(btnInlineMath);
      toolbarChildren.push(btnBlockMath);
    }
    const toolbar = h('div', { class: 'md-toolbar' }, toolbarChildren);

    const labelRightEl = opts?.labelRightEl || null;
    // Markdown editors (toolbar + textarea) always claim their own line.
    return h('div', { class: 'stack is-field is-field-full' }, [
      labelRightEl
        ? h('div', { class: 'field-head' }, [
            h('div', { class: 'field-label', text: label }),
            h('div', { class: 'field-actions' }, [labelRightEl]),
          ])
        : h('div', { class: 'field-label', text: label }),
      toolbar,
      ta,
      h('div', { class: 'help', text: helpText }),
    ]);
  };

  const fieldSelect = (label, value, options, onChange) => {
    const sel = h('select', { class: 'form-input' });
    for (const o of options) {
      const opt =
        typeof o === 'string'
          ? { value: o, label: o }
          : o && typeof o === 'object'
          ? {
              value: String(o.value ?? ''),
              label: String(o.label ?? o.value ?? ''),
            }
          : { value: '', label: '' };
      sel.append(h('option', { value: opt.value, text: opt.label }));
    }
    sel.value = String(value ?? '');
    sel.addEventListener('change', () => onChange(sel.value));
    return h('div', { class: 'stack is-field' }, [
      h('div', { class: 'field-label', text: label }),
      sel,
    ]);
  };

  return { fieldText, fieldNumber, fieldTextarea, fieldMarkdown, fieldCode, fieldSelect };
}
