import { getUiLocale, t } from '../../../lib/ui-i18n.js';

export function createBackgroundFields({ h, theme } = {}) {
  const themeVars =
    theme?.cssVars && typeof theme.cssVars === 'object'
      ? theme.cssVars
      : {};

  const normalizeOption = (o) => {
    if (typeof o === 'string') {
      const v = String(o);
      return { value: v, label: v };
    }
    if (o && typeof o === 'object') {
      const value = String(o.value ?? '');
      const label = String(o.label ?? o.title ?? value);
      return { ...o, value, label };
    }
    return { value: '', label: '' };
  };

  const themeLabelForValue = (value) => {
    // Optional theme feature: allow naming background options.
    // Shape:
    // theme.backgroundLabels = { lime: "White", mist: { en: "Mist", nl: "Nevel" } }
    const map =
      theme?.backgroundLabels && typeof theme.backgroundLabels === 'object'
        ? theme.backgroundLabels
        : null;
    if (!map) return '';
    const raw = map?.[value];
    if (typeof raw === 'string') return raw.trim();
    if (raw && typeof raw === 'object') {
      const ui = String(getUiLocale?.() || 'en').toLowerCase();
      const isNl = ui === 'nl' || ui.startsWith('nl-');
      const pick = isNl ? raw.nl : raw.en;
      if (typeof pick === 'string') return pick.trim();
    }
    return '';
  };

  const labelForOpt = (opt) => {
    const v = String(opt?.value ?? '').trim();
    // Important: stored values are legacy ("lime"/"mist"), but themes may map them to anything
    // (e.g. ClickNL uses white for "lime"). Use neutral labels.
    if (v === 'lime')
      return (
        themeLabelForValue('lime') || t('editor.background.opt1', 'Color 1')
      );
    if (v === 'mist')
      return (
        themeLabelForValue('mist') || t('editor.background.opt2', 'Color 2')
      );
    if (v === 'transparent')
      return t('editor.background.transparent', 'Transparent');
    const lbl = String(opt?.label ?? '').trim();
    return lbl || v || t('common.emDash', '—');
  };

  const swatchForOpt = (opt) => {
    const v = String(opt?.value ?? '').trim();
    if (!v) return null;
    if (v === 'transparent') return 'transparent';
    // Convention: background option names map to `--t-slide-bg-${name}` theme vars.
    const key = `--t-slide-bg-${v}`;
    const raw = String(themeVars?.[key] || '').trim();
    return raw || null;
  };

  // Theme-defined background variants (theme.slideBackgrounds, normalized in
  // client/lib/theme.js) extend every background picker. Swatches resolve via
  // the existing `--t-slide-bg-<id>` convention below.
  const themeVariantOptions = () => {
    const list = Array.isArray(theme?.slideBackgrounds)
      ? theme.slideBackgrounds
      : [];
    return list.map((e) => ({
      value: String(e.id),
      label: String(e.label || e.id),
    }));
  };

  const fieldBackground = (field, value, onChange) => {
    const rawOptions = Array.isArray(field?.options) ? field.options : [];
    const seen = new Set();
    const options = [
      ...rawOptions.map(normalizeOption),
      ...themeVariantOptions(),
    ].filter((o) => {
      if (!o?.value || seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
    const values = options.map((o) => o.value);

    const v = String(value ?? '');
    // Local UI state: the editor form doesn't re-render this field on every change,
    // so we must update the trigger/menu immediately when an option is picked.
    let current = values.includes(v) ? v : String(options?.[0]?.value ?? '');

    let open = false;
    const wrap = h('div', { class: 'stack is-field' });
    const label = h('div', {
      class: 'field-label',
      text: field?.label || '',
    });

    const trigger = h('button', {
      type: 'button',
      class: 'bg-picker-trigger',
      'aria-label':
        field?.label ||
        field?.key ||
        t('editor.background.aria', 'Background'),
    });
    const menu = h('div', { class: 'bg-picker-menu', hidden: true });

    // Safari can fire focus changes on trackpad "click-down" in a way that makes
    // focusout-driven dropdowns close before option clicks run.
    // Use pointerdown (outside-click) to close, and pointerdown on options to commit.
    const onDocPointerDown = (e) => {
      const t = e?.target;
      if (t && wrap.contains(t)) return;
      close();
    };
    const attachOutsideClose = () => {
      try {
        document.addEventListener('pointerdown', onDocPointerDown, true);
      } catch {
        // ignore
      }
    };
    const detachOutsideClose = () => {
      try {
        document.removeEventListener('pointerdown', onDocPointerDown, true);
      } catch {
        // ignore
      }
    };

    const renderTrigger = () => {
      trigger.innerHTML = '';
      const currentOpt =
        options.find((o) => o.value === current) ||
        normalizeOption(current);
      const sw = h('span', {
        class: 'bg-picker-swatch',
        style: swatchForOpt(currentOpt)
          ? `background:${swatchForOpt(currentOpt)}`
          : '',
      });
      sw.classList.toggle('is-transparent', current === 'transparent');
      trigger.append(
        sw,
        h('span', { class: 'bg-picker-label', text: labelForOpt(currentOpt) })
      );
    };

    const close = () => {
      open = false;
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      detachOutsideClose();
    };
    const openMenu = () => {
      open = true;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      attachOutsideClose();
    };

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        trigger.focus?.();
      } catch {
        // ignore
      }
      if (open) close();
      else openMenu();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    const renderMenu = () => {
      menu.innerHTML = '';
      for (const opt of options) {
        const o = String(opt?.value ?? '');
        const btn = h('button', {
          type: 'button',
          class: 'bg-picker-option',
        });
        // Commit on pointerdown so Safari trackpad "press" can't close the menu
        // before the selection is applied.
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          current = o;
          renderTrigger();
          renderMenu();
          onChange(o);
          close();
          try {
            trigger.focus?.();
          } catch {
            // ignore
          }
        });
        const sw = h('span', {
          class: 'bg-picker-swatch',
          style: swatchForOpt(opt) ? `background:${swatchForOpt(opt)}` : '',
        });
        sw.classList.toggle('is-transparent', o === 'transparent');
        btn.classList.toggle('is-active', o === current);
        btn.append(sw, h('span', { text: labelForOpt(opt) }));
        menu.append(btn);
      }
    };

    renderTrigger();
    renderMenu();

    wrap.append(label, h('div', { class: 'bg-picker' }, [trigger, menu]));
    return wrap;
  };

  return { fieldBackground };
}
