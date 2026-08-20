import { t } from '../../../lib/ui-i18n.js';
import { icon } from '../../../lib/dom/icons.js';
import { attachPointerSortable } from '../../../lib/dom/pointer-sortable.js';
import { createCollapsedState } from '../../../lib/slide-authoring/collapsed-state.js';
import { collapseAllToggle } from '../fields/collapse-all-toggle.js';
import { fieldCardLink } from '../fields/card-link-field.js';
import { renderImageFitField } from '../fields/image-fit.js';
import { getInlineDescriptor } from '../inline-edit/descriptors.js';
import { fieldEditor } from '../../../../shared/slide-types/field-editors.js';
import { resolveItemDefaults } from '../../../../shared/slide-types/item-defaults.js';
import {
  fieldFormLayout,
  fieldFormRows,
} from '../../../../shared/slide-types/form-layout.js';

/**
 * The generic collection editor: ONE add/remove/reorder/collapse machine for
 * every `type: 'items'` field, driven entirely by the field's schema. This is
 * seam rules 4 and 5 ("vocabulary closed, declarant open" / "unknown degrades,
 * never breaks") applied to the editor: a slide type declares what its
 * collection holds (`itemFields`, `minItems`/`maxItems`, `itemDefaults`,
 * `collapsible`) and gets the full editing UX for free — the seven hand-built
 * per-type collection forms this replaces are gone.
 *
 * Reordering is pointer-based (item follows the cursor, neighbours make room,
 * works on touch) via lib/dom/pointer-sortable.js — no HTML5 drag-and-drop.
 *
 * Schema knobs honoured beyond the basics:
 * - `collapsible: true` on the items field — per-item collapse chevron plus a
 *   bulk collapse/expand toggle, for item-rich collections (cards, galleries).
 * - `relationField` — an enum item field naming the relation *to the next
 *   item* (text-blocks' arrow) renders only while a next item exists.
 * - `hidden: true` on an item field — carried in the data, not rendered
 *   (e.g. gallery focus coordinates, which the canvas focus handle and the
 *   inspector's image card already edit).
 * - `editor: 'icon-picker' | 'card-link' | 'image-fit'` on an item field —
 *   widgets from the closed field-editor vocabulary
 *   (shared/slide-types/field-editors.js). This per-item loop implements the
 *   item-sized ones; any other name — unknown or simply not item-sized
 *   (table-grid) — degrades to the base widget for the field's type.
 * - `formLayout: 'pair'` on item fields (shared/slide-types/form-layout.js) —
 *   when any item field declares it, the item body renders in declared rows
 *   (a run of consecutive `pair` fields shares one) instead of the default
 *   single flex grid. Same vocabulary the top-level form loop reads.
 * - nested `type: 'items'` item fields (text-blocks rows → blocks) render one
 *   level of inner collection, with its own add/remove/reorder.
 *
 * Per-type add/remove button copy comes from the type's inline-edit descriptor
 * (`cards.addLabelKey` etc.) — the same declaration the canvas affordances
 * read, so the two surfaces cannot drift.
 *
 * Legacy numbered mirrors (card1Title…, logo1Image…) are NOT synced here. The
 * canonical array is the one written surface — the same contract the inline
 * (canvas) editor already applies; renderers and the semantic projection
 * prefer the array. The mirrors survive read-only until their deprecation
 * cleanup removes them.
 */

// One collapsed-state store for every collection list; keys are scoped by
// slide, field and index so lists never collide.
const collapsedState = createCollapsedState('collection');

/**
 * @param {Object} o
 * @param {Function} o.h - DOM helper
 * @param {Object} o.slide - the slide being edited
 * @param {Object} o.def - the slide-type definition
 * @param {Object} o.field - the `type: 'items'` field schema
 * @param {Object} o.fieldRenderers - { fieldText, fieldImage, fieldIconPicker,
 *   fieldEnum, fieldGrid, fieldNumber }
 * @param {Array<Object>} [o.deckSlides] - options for card-link item fields
 * @param {Function} [o.markDirty]
 * @param {Function} [o.scheduleUiRefresh]
 * @param {Object} [o.model] - storage override:
 *   { read: () => Array, write: (arr) => void }.
 *   Default reads/writes `slide.content[field.key]`. Only passed by this
 *   module's own recursion for a nested `items` field (text-blocks rows →
 *   blocks), which reads/writes through the parent item; no external caller
 *   uses it.
 * @param {Object} [o.labels] - { addLabelKey, addLabel } overrides (used by the
 *   nested level, resolved from the descriptor's `cards.child`)
 * @param {string|null} [o.lang] - deck language (`resolveDeckLang(pres)`);
 *   picks the new-item skeleton from `itemDefaultsByLang`
 * @param {number} [o.depth] - nesting depth (internal; one nested level max)
 * @returns {HTMLElement}
 */
export function createCollectionEditor({
  h,
  slide,
  def,
  field,
  fieldRenderers,
  deckSlides = [],
  markDirty,
  scheduleUiRefresh,
  model = null,
  labels = null,
  lang = null,
  depth = 0,
} = {}) {
  const { fieldImage, fieldIconPicker, fieldEnum, fieldGrid, fieldNumber } =
    fieldRenderers || {};

  const minItems = Math.max(0, Number(field?.minItems || 0) || 0);
  const maxItems = Math.max(minItems, Number(field?.maxItems || 99) || 99);
  // Top level never removes the last item — an empty collection renders an
  // empty slide with no affordance to find the add button again. A nested
  // collection (a row's blocks) may honestly go down to its declared minimum.
  const removeFloor = depth > 0 ? minItems : Math.max(1, minItems);
  const itemDefaults = resolveItemDefaults(field, lang);
  const itemFields = (
    Array.isArray(field?.itemFields) ? field.itemFields : []
  ).filter((f) => f && !f.hidden);
  const collapsible = !!field?.collapsible && depth === 0;

  // Canonicalize once on mount: dual-model types (icon-card-grid, team-cards,
  // logo-wall) declare an `ensure` on their inline-edit descriptor
  // that folds the legacy numbered fields into the canonical array. Same hook
  // the canvas editor runs; idempotent.
  const descriptor = depth === 0 ? getInlineDescriptor(slide.type, def) : null;
  if (descriptor?.ensure && !model) descriptor.ensure(slide.content);

  // Per-type button copy, from the same declaration the canvas reads.
  const cardsCfg =
    descriptor?.cards &&
    (descriptor.cards.field === field.key ||
      descriptor.cards.fieldAliases?.includes?.(field.key))
      ? descriptor.cards
      : null;
  const addLabelKey = labels?.addLabelKey || cardsCfg?.addLabelKey || '';
  const addLabel = labels?.addLabel || cardsCfg?.addLabel || '';
  const addText = addLabelKey
    ? `+ ${t(addLabelKey, addLabel || 'Add item')}`
    : t('editor.items.add', '+ Add item');

  const readArr = () => {
    if (model) return model.read();
    return Array.isArray(slide.content?.[field.key])
      ? slide.content[field.key]
      : structuredClone(def?.defaults?.[field.key] || []);
  };

  const commit = (next) => {
    if (model) model.write(next);
    else slide.content[field.key] = next;
    markDirty?.();
    scheduleUiRefresh?.();
    renderList();
  };

  const stateKey = (i) => collapsedState.getKey(slide.id, `${field.key}:${i}`);

  const wrap = h('div', { class: 'stack is-field collection-editor' });

  // Header: label + add button + count pill + optional bulk collapse toggle.
  const controls = h('div', { class: 'stack' });
  controls.append(
    h('div', {
      class: 'field-label',
      text: t(field.labelKey || field.key, field.label || field.key),
    }),
  );
  const controlsRow = h('div', { class: 'row is-wrap' });
  const btnAdd = h('button', {
    class: `btn btn-secondary${depth > 0 ? ' btn-sm' : ''}`,
    type: 'button',
    text: addText,
  });
  const pill = h('div', { class: 'pill' });
  controlsRow.append(btnAdd, pill);
  controls.append(controlsRow);
  wrap.append(controls);

  const list = h('div', { class: 'stack is-gap-lg items-reorder-list' });
  wrap.append(list);

  // Row intent for the per-item field body: a type that declares `formLayout`
  // on item fields gets declared rows; everything else gets the single
  // flex-wrap grid, where each widget's own size intent drives the layout.
  const hasItemFormLayout = itemFields.some((f) => fieldFormLayout(f));

  const moveItem = (from, to) => {
    const current = readArr();
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= current.length ||
      to >= current.length
    ) {
      return;
    }
    const next = current.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  attachPointerSortable({
    container: list,
    itemSelector: '.card-group',
    handleSelector: '.item-drag-handle',
    onReorder: moveItem,
  });

  const makeInput = (
    label,
    value,
    { maxLength, multiline, number, placeholder } = {},
    onChange,
  ) => {
    if (number && fieldNumber) {
      return fieldNumber(label, value ?? '', onChange, {});
    }
    const input = multiline
      ? h('textarea', { class: 'form-input form-textarea-sm', rows: '2' })
      : h('input', { class: 'form-input' });
    input.value = value ?? '';
    if (Number(maxLength) > 0) input.maxLength = Number(maxLength);
    if (typeof placeholder === 'string' && placeholder)
      input.placeholder = placeholder;
    input.addEventListener('input', () => onChange(input.value));
    return h('div', { class: 'stack is-field' }, [
      h('div', { class: 'field-label', text: label }),
      input,
    ]);
  };

  /** The collapsed-header preview: first non-empty string field's value. */
  const itemTitle = (item, i) => {
    for (const f of itemFields) {
      if (f.type !== 'string') continue;
      const v = String(item?.[f.key] || '').trim();
      if (v) return { text: v, placeholder: false };
    }
    return {
      text: t('editor.items.itemN', 'Item {n}', { n: i + 1 }),
      placeholder: true,
    };
  };

  function renderList() {
    const current = readArr();
    list.innerHTML = '';

    for (let i = 0; i < current.length; i += 1) {
      const item =
        current[i] && typeof current[i] === 'object' ? current[i] : {};
      const group = h('div', { class: 'stack card-group' });
      const key = stateKey(i);
      const isCollapsed = collapsible && collapsedState.isCollapsed(key);
      if (isCollapsed) group.classList.add('is-collapsed');

      const setItemKey = (k, v) => {
        const now = readArr();
        const next = now.slice();
        const nextItem =
          next[i] && typeof next[i] === 'object' ? { ...next[i] } : {};
        nextItem[k] = v;
        next[i] = nextItem;
        if (model) model.write(next);
        else slide.content[field.key] = next;
        markDirty?.();
        scheduleUiRefresh?.();
        // No renderList(): value edits keep focus in the input; only
        // structural changes rebuild the list.
      };

      // Header: drag handle, optional collapse chevron, title preview, remove.
      const header = h('div', { class: 'row spread card-group-header' });
      const headerLeft = h('div', { class: 'card-group-header-left' });
      const handle = h('button', {
        type: 'button',
        class: 'item-drag-handle',
        title: t('editor.slideList.dragToReorder', 'Drag to reorder'),
        'aria-label': t('editor.slideList.dragToReorder', 'Drag to reorder'),
      });
      handle.appendChild(icon('grip-vertical', { size: 12 }));
      headerLeft.append(handle);

      if (collapsible) {
        const collapseBtn = h('button', {
          type: 'button',
          class: 'row-collapse-toggle',
          title: isCollapsed
            ? t('editor.cards.expand', 'Expand')
            : t('editor.cards.collapse', 'Collapse'),
        });
        collapseBtn.appendChild(icon('chevron-down', { size: 12 }));
        collapseBtn.addEventListener('click', (e) => {
          e.preventDefault();
          collapsedState.toggle(key);
          renderList();
        });
        headerLeft.append(collapseBtn);
      }

      const title = itemTitle(item, i);
      headerLeft.append(
        h('div', {
          class: `card-group-title item-title-preview${title.placeholder ? ' is-placeholder' : ''}`,
          text: title.text,
        }),
      );
      header.append(headerLeft);

      header.append(
        h('button', {
          class: 'btn btn-secondary btn-icon card-remove-btn',
          type: 'button',
          text: '×',
          title: t('editor.items.remove', 'Remove item'),
          'aria-label': t('editor.items.removeN', 'Remove item {n}', {
            n: i + 1,
          }),
          disabled: current.length <= removeFloor,
          onclick: () => {
            const now = readArr();
            if (now.length <= removeFloor) return;
            const next = now.slice();
            next.splice(i, 1);
            commit(next);
          },
        }),
      );
      group.append(header);

      const body = h('div', { class: 'block-collapsible-content' });
      if (isCollapsed) body.style.display = 'none';

      const widgets = [];
      const widgetByKey = new Map();
      const pushWidget = (k, w) => {
        widgets.push(w);
        widgetByKey.set(k, w);
      };
      for (const f of itemFields) {
        const k = String(f.key || '');
        const label = t(f.labelKey || k, f.label || k);

        // `relationField` names the relation to the NEXT item (text-blocks'
        // arrow): meaningless on the last item, so it doesn't render there.
        if (
          field.relationField &&
          k === field.relationField &&
          i >= current.length - 1
        ) {
          continue;
        }

        // Widgets from the closed field-editor vocabulary
        // (shared/slide-types/field-editors.js). This loop implements the two
        // item-sized ones; any other name falls through to the base widget
        // for the declared type.
        const editor = fieldEditor(f);
        if (editor === 'icon-picker' && typeof fieldIconPicker === 'function') {
          pushWidget(
            k,
            fieldIconPicker(
              label,
              item?.[k] || '',
              (v) => setItemKey(k, v),
              {},
            ),
          );
          continue;
        }
        if (editor === 'card-link') {
          pushWidget(
            k,
            fieldCardLink({
              value: item?.[k] || '',
              slides: deckSlides,
              onChange: (v) => setItemKey(k, v),
              help: t(
                'editor.cards.linkHelp2',
                'Makes the card clickable. Pick a slide to jump to, or type an https:// / mailto: link (opens in a new tab).',
              ),
            }),
          );
          continue;
        }
        if (editor === 'image-fit') {
          const fitEl = renderImageFitField({
            fieldEnum,
            field: { ...f, key: k },
            target: item,
            typeDefault: def?.imageDefaults?.fit,
            onChange: (v) => setItemKey(k, v),
          });
          if (fitEl) {
            pushWidget(k, fitEl);
            continue;
          }
        }

        if (f.type === 'image' && fieldImage) {
          // fieldImage edits `slide.content[key]`; a proxy slide maps that
          // contract onto this item object.
          const proxySlide = {
            type: slide.type,
            id: slide.id,
            content: item,
          };
          const imageField = { ...f, key: k, hideHelp: true };
          pushWidget(
            k,
            fieldImage(proxySlide, imageField, (url) => {
              setItemKey(k, url);
              renderList();
            }),
          );
          continue;
        }

        if (f.type === 'enum' && typeof fieldEnum === 'function') {
          // Resolve stamped option labelKeys here — the enum renderer shows
          // `option.label` verbatim.
          const options = (Array.isArray(f.options) ? f.options : []).map(
            (o) =>
              o && typeof o === 'object' && o.labelKey
                ? {
                    ...o,
                    label: t(o.labelKey, o.label ?? String(o.value ?? '')),
                  }
                : o,
          );
          pushWidget(
            k,
            fieldEnum({ ...f, options }, item?.[k] ?? '', (v) =>
              setItemKey(k, v),
            ),
          );
          continue;
        }

        if (f.type === 'items') {
          // One nested level (text-blocks rows → blocks). Rendered outside the
          // field grid, full width, with its own machinery.
          if (depth > 0) continue;
          const childLabels = descriptor?.cards?.child
            ? {
                addLabelKey: descriptor.cards.child.addLabelKey,
                addLabel: descriptor.cards.child.addLabel,
              }
            : null;
          pushWidget(k, {
            fullWidth: createCollectionEditor({
              h,
              slide,
              def,
              field: f,
              fieldRenderers,
              deckSlides,
              markDirty,
              scheduleUiRefresh,
              labels: childLabels,
              lang,
              depth: depth + 1,
              model: {
                read: () => {
                  const parent = readArr()[i];
                  return Array.isArray(parent?.[k]) ? parent[k] : [];
                },
                write: (arr) => setItemKey(k, arr),
              },
            }),
          });
          continue;
        }

        if (
          f.type === 'string' ||
          f.type === 'markdown' ||
          f.type === 'number'
        ) {
          pushWidget(
            k,
            makeInput(
              label,
              item?.[k] ?? '',
              {
                maxLength: f.maxLength,
                multiline: f.type === 'markdown' || !!f.multiline,
                number: f.type === 'number',
                placeholder:
                  typeof f.placeholder === 'string' && f.placeholderKey
                    ? t(f.placeholderKey, f.placeholder)
                    : f.placeholder,
              },
              (v) => setItemKey(k, v),
            ),
          );
          continue;
        }
        // Unknown item-field type: degrade to nothing rather than break.
      }

      const gridWidgets = widgets.filter((w) => !(w && w.fullWidth));
      const fullWidgets = widgets
        .filter((w) => w && w.fullWidth)
        .map((w) => w.fullWidth);
      if (hasItemFormLayout && typeof fieldGrid === 'function') {
        // Declared rows (formLayout on item fields): a run of consecutive
        // `pair` fields shares one grid row, every other field gets its own.
        for (const row of fieldFormRows(itemFields)) {
          const nodes = row.keys
            .map((k2) => widgetByKey.get(k2))
            .filter((w) => w && !w.fullWidth);
          const grid = fieldGrid(nodes);
          if (grid) body.append(grid);
        }
      } else if (gridWidgets.length && typeof fieldGrid === 'function') {
        const grid = fieldGrid(gridWidgets);
        if (grid) body.append(grid);
      }
      for (const el of fullWidgets) body.append(el);

      group.append(body);
      list.append(group);
    }

    const count = current.length;
    pill.textContent = `${count} / ${maxItems}`;
    btnAdd.disabled = count >= maxItems;

    // Bulk collapse/expand: rebuilt with the list so its label tracks state.
    if (collapsible) {
      controlsRow.querySelector('.collapse-all-toggle')?.remove();
      const keys = Array.from({ length: count }, (_, i) => stateKey(i));
      const toggle = collapseAllToggle({
        state: collapsedState,
        keys,
        rerender: renderList,
      });
      if (toggle) controlsRow.append(toggle);
    }
  }

  btnAdd.addEventListener('click', () => {
    const current = readArr();
    if (current.length >= maxItems) return;
    commit([...current, structuredClone(itemDefaults)]);
  });

  renderList();
  return wrap;
}
