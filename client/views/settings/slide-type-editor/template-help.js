/**
 * Template syntax reference for the custom slide type editor.
 *
 * The template language is a small fixed set of helpers with no eval (see
 * `server/utils/slide-template-compiler.js` — this list mirrors its tokenizer,
 * so keep the two in step when a helper is added). Authors previously had a
 * single hint line naming four of the directives; `raw`, `bgClass`, `else`,
 * `this`/`this.key` and `@index` were undocumented in the UI.
 *
 * Rendered collapsed: it is reference material, not something to read on every
 * visit, and the template textarea it sits under is the point of the screen.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * The directives, in the order the compiler tries them. `code` is literal
 * template syntax and is deliberately not translated; only the explanation is.
 */
function directives() {
  return [
    {
      code: '{{field}}',
      desc: t(
        'settings.slideTypes.help.var',
        'The value of a field, HTML-escaped. Same as {{esc field}}.'
      ),
    },
    {
      code: '{{esc field}}',
      desc: t('settings.slideTypes.help.esc', 'The value of a field, HTML-escaped.'),
    },
    {
      code: '{{markdown field}}',
      desc: t(
        'settings.slideTypes.help.markdown',
        'The field rendered as markdown (bold, italics, links, lists).'
      ),
    },
    {
      code: '{{raw field}}',
      desc: t(
        'settings.slideTypes.help.raw',
        'The field inserted as-is, without escaping. Only for values you control.'
      ),
    },
    {
      code: '{{bgClass field}}',
      desc: t(
        'settings.slideTypes.help.bgClass',
        'Turns a background choice into the matching slide background class.'
      ),
    },
    {
      code: '{{#if field}} … {{else}} … {{/if}}',
      desc: t(
        'settings.slideTypes.help.if',
        'Only renders the first part when the field has a value. Empty text, zero, false and empty lists all count as no value.'
      ),
    },
    {
      code: '{{#each items}} … {{/each}}',
      desc: t(
        'settings.slideTypes.help.each',
        'Repeats the block for every entry of an items field.'
      ),
    },
    {
      code: '{{this}} / {{this.key}}',
      desc: t(
        'settings.slideTypes.help.this',
        'Inside {{#each}}: the current entry, or one of its sub-fields.'
      ),
    },
    {
      code: '{{@index}}',
      desc: t(
        'settings.slideTypes.help.index',
        'Inside {{#each}}: the position of the current entry, starting at 0.'
      ),
    },
  ];
}

/**
 * Build the collapsible syntax reference.
 *
 * @param {Object} [opts]
 * @param {Array<{key: string, label?: string}>} [opts.fields] - The type's own
 *   fields. Listed as the names available to the template, which is the thing
 *   authors otherwise have to scroll up for.
 * @returns {{ el: HTMLElement, setFields: (fields: Array) => void }}
 */
export function createTemplateHelp({ fields = [] } = {}) {
  const list = h('dl', { class: 'template-help-list' });
  for (const d of directives()) {
    list.append(
      h('dt', {}, [h('code', { text: d.code })]),
      h('dd', { text: d.desc })
    );
  }

  const fieldsEl = h('div', { class: 'template-help-fields' });

  /** @param {Array<{key: string}>} next */
  function setFields(next) {
    fieldsEl.textContent = '';
    const keys = (next || []).map((f) => String(f?.key || '').trim()).filter(Boolean);
    if (keys.length === 0) {
      fieldsEl.append(
        h('span', {
          class: 'help',
          text: t(
            'settings.slideTypes.help.noFields',
            'This type has no fields yet — add some above and their names appear here.'
          ),
        })
      );
      return;
    }
    fieldsEl.append(
      h('span', {
        class: 'field-label',
        text: t('settings.slideTypes.help.fieldsTitle', 'Fields you can use'),
      })
    );
    const row = h('div', { class: 'template-help-field-list' });
    for (const key of keys) row.append(h('code', { text: `{{${key}}}` }));
    fieldsEl.append(row);
  }
  setFields(fields);

  const el = h('details', { class: 'template-help' }, [
    h('summary', {
      text: t('settings.slideTypes.help.title', 'Template syntax'),
    }),
    list,
    fieldsEl,
  ]);

  return { el, setFields };
}
