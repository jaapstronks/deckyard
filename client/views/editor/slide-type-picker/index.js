/**
 * Insert-slide type picker.
 *
 * This is the public seam for the picker; it owns the render orchestration and
 * the mutable per-render state (view mode, preview surface, observers, the
 * single-open peek handle) and composes the concern modules beside it in this
 * folder:
 *   - data.js         — static aliases / curated presets / descriptions + tuning
 *   - preferences.js  — every localStorage key (view mode, surface, usage, pins,
 *                       collapsed sections)
 *   - thumbnails.js   — pure thumbnail builders (video/embed mocks, schematic,
 *                       fluid scale)
 *   - peek.js         — the click-to-peek lightbox
 *   - library-strip.js — the inline "From your library" strip (item 10)
 *
 * The live-render thumbnail path (hydrateThumb) stays here because it closes
 * over the mutable preview surface; it calls the pure builders for the
 * video/embed/schematic cases.
 */

import { icon } from '../../../lib/dom/icons.js';
import { t } from '../../../lib/ui-i18n.js';
import { isInsertableSlideType } from '../../../../shared/slide-types/policy.js';
import {
  NO_DECK_LANG,
  renderSlideElement,
  cleanupSlideRuntimes,
} from '../../../lib/slide-runtime/slide-render.js';
import { getSampleContent } from '../slide-type-sample-content.js';
import { wireGridKeyboardNav } from '../slide-type-picker-keyboard.js';
import {
  SURFACE_CANDIDATES,
  FREQUENT_MAX,
  FREQUENT_MIN_TOTAL,
  VIEW_MODES,
  SLIDE_TYPE_PRESETS,
  PICKER_GROUP_ORDER,
  PICKER_GROUP_KEYS,
} from './data.js';
import {
  slideTypeGroup,
  typesInGroup,
} from '../../../../shared/slide-types/authoring-groups.js';
import {
  slideTypeAliases,
  slideTypeDescription,
} from '../../../../shared/slide-types/authoring-companions.js';
import {
  readViewMode,
  persistViewMode,
  readSurface,
  persistSurface,
  getUsage,
  bumpUsage,
  getPins,
  isPinned,
  togglePin,
  isSectionCollapsed,
  setSectionCollapsed,
} from './preferences.js';
import {
  applyThumbScale,
  fillVideoThumb,
  fillEmbedThumb,
  fillSchematic,
} from './thumbnails.js';
import { openTypePeek } from './peek.js';
import { mountLibraryStrip } from './library-strip.js';
import { h } from '../../../lib/dom.js';

export function createSlideTypePicker({
  SLIDE_TYPES,
  theme,
  insertSlide,
  disabledSlideTypes,
  canEditCustomHtml = false,
  requestAi = null,
  // Optional inline "From your library" strip (item 10). Both must be provided,
  // and the caller must also pass onSeeAllLibrary per render, or the strip is
  // skipped entirely (e.g. the quick-add drawer, which has no library tab).
  loadLibraryStripItems = null,
  insertLibraryItem = null,
} = {}) {
  // NOTE: UI translations use app locale (not slide language mode).
  // Keep fallbacks in English.

  // Tooltip/caption description for a type (falls back to '' when none). The
  // English fallback is resolved from the type's own declaration on the
  // /api/slide-types response (SLIDE_TYPES), so a fork type's description shows
  // too; the app-locale translation still layers on top.
  const descFor = (type) =>
    t(
      `editor.slideTypeDesc.${type}`,
      slideTypeDescription(type, SLIDE_TYPES?.[type]) || '',
    );

  // Search query persists across re-renders.
  let searchQuery = '';

  // Thumbnail view mode ('schematic' | 'preview'), persisted locally.
  let viewMode = readViewMode();

  // Currently forced preview surface ('' = auto). Validated against the surfaces
  // this theme actually offers on each render (see below), so a stale stored
  // value from another theme can't stick.
  let currentSurface = readSurface();

  // Which background surfaces a slide type supports, from its declared enum
  // field (BACKGROUND_FIELD → lime/mist, BACKGROUND_FIELD_EXTENDED → +dark/…).
  // null when the type has no background field at all.
  const backgroundOptionsFor = (type) => {
    const fields = SLIDE_TYPES?.[type]?.fields;
    if (!Array.isArray(fields)) return null;
    const bg = fields.find(
      (f) => f?.key === 'background' && f?.type === 'enum',
    );
    if (!bg || !Array.isArray(bg.options)) return null;
    return bg.options
      .map((o) => (typeof o === 'string' ? o : o?.value))
      .filter(Boolean);
  };
  const typeSupportsSurface = (type, surface) => {
    const opts = backgroundOptionsFor(type);
    return !!opts && opts.includes(surface);
  };

  // Sample content for a thumbnail, with an optional preset's content overrides
  // (item 15) merged in, then the forced preview surface applied when the type
  // supports it (otherwise the type keeps its own sample background). The surface
  // is applied last so a preset can't clobber the chosen preview background.
  const sampleContentFor = (type, presetContent = null) => {
    const content = getSampleContent(type, SLIDE_TYPES, theme);
    if (presetContent && typeof presetContent === 'object') {
      Object.assign(content, presetContent);
    }
    if (currentSurface && typeSupportsSurface(type, currentSurface)) {
      content.background = currentSurface;
    }
    return content;
  };

  // Resolved (translated) label for a preset variant.
  const presetLabelFor = (preset) => t(preset.labelKey, preset.label);

  // Content overrides used only for a preset's thumbnail/peek render (falls back
  // to its insert overrides). Lets a variant show richer sample content in the
  // preview than it actually inserts (e.g. the two-column body).
  const previewOverridesFor = (preset) =>
    preset?.previewContent || preset?.content || null;

  // Lazy thumbnail hydration + fluid scaling. Observers are recreated per
  // render pass and tracked so a fresh render can tear the old ones down.
  let observers = [];
  // Shared single-open handle for the peek lightbox, so a re-render tears an
  // open peek down too (see ./peek.js).
  const peekRef = { close: null };
  // Detach handler for the grid keyboard nav, so a re-render doesn't stack it.
  let teardownKeyboard = null;
  const teardownObservers = () => {
    for (const o of observers) {
      try {
        o.disconnect();
      } catch {
        // ignore
      }
    }
    observers = [];
    try {
      peekRef.close?.();
    } catch {
      // ignore
    }
    try {
      teardownKeyboard?.();
    } catch {
      // ignore
    }
    teardownKeyboard = null;
  };

  // Build the real (or mock) thumbnail contents into a pending wrapper. Called
  // lazily when the tile scrolls into view (or when its section is expanded).
  const hydrateThumb = (thumbWrap, resizeObserver) => {
    const type = thumbWrap.dataset.thumbType;
    thumbWrap.classList.remove('is-pending');

    if (type === 'video-slide') {
      fillVideoThumb(thumbWrap);
      return;
    }
    if (type === 'embed-slide') {
      fillEmbedThumb(thumbWrap);
      return;
    }

    try {
      const slide = {
        id: `sample-${type}`,
        type,
        // Preset overrides (item 15) are stashed on the wrap so lazy hydration
        // and surface re-renders reapply them without re-reading the def.
        content: sampleContentFor(type, thumbWrap.__presetContent || null),
        notes: '',
      };
      const el = renderSlideElement(slide, {
        mode: 'thumb',
        theme,
        lang: NO_DECK_LANG,
      });
      thumbWrap.append(el);
      // Scale to fill now (element is laid out), then keep it in sync on resize.
      applyThumbScale(thumbWrap);
      resizeObserver?.observe(thumbWrap);
    } catch (e) {
      thumbWrap.classList.add('is-error');
      thumbWrap.append(h('div', { class: 'ps-type-thumb-error', text: '?' }));
    }
  };

  // Searchable haystack for a card: label + raw type key + description +
  // aliases, lowercased, so "big numbers" finds the KPI slide and
  // "smoelenboek" finds team cards.
  const searchHaystack = (type, label) =>
    `${label} ${type} ${descFor(type)} ${slideTypeAliases(type, SLIDE_TYPES?.[type]) || ''}`.toLowerCase();

  // Safe attribute-selector value for a type key.
  const cssEsc = (s) =>
    typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(String(s))
      : String(s).replace(/["\\]/g, '\\$&');

  const labelFor = (type) => {
    const def = SLIDE_TYPES?.[type];
    return t(def?.labelKey || `slideType.${type}.label`, def?.label || type);
  };

  const renderSlideTypePicker = (
    mount,
    { afterSlideId, parentId, onPicked, onSeeAllLibrary } = {},
  ) => {
    teardownObservers();
    mount.innerHTML = '';

    // A preset (item 15) inserts the base type with content overrides; usage is
    // still bumped against the base type so variants don't fragment the signal.
    const onPick = (type, preset = null) => {
      bumpUsage(type);
      insertSlide?.(type, {
        afterSlideId,
        parentId,
        contentOverrides: preset?.content || null,
      });
      onPicked?.();
    };

    // Shared context for the peek lightbox (./peek.js). onPick is render-scoped;
    // the rest are stable factory helpers.
    const peekCtx = {
      theme,
      labelFor,
      presetLabelFor,
      descFor,
      sampleContentFor,
      previewOverridesFor,
      onPick,
      peekRef,
    };

    const allowed = (type) =>
      isInsertableSlideType({
        type,
        def: SLIDE_TYPES?.[type],
        theme,
        disabledSlideTypes,
        canEditCustomHtml,
      });

    // Thumbnails are expensive, so hydrate them only as they approach the
    // viewport. Collapsed/hidden tiles have no box and simply stay pending
    // until expanded — a free win from the same observer.
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            for (const e of entries) applyThumbScale(e.target);
          })
        : null;
    if (resizeObserver) observers.push(resizeObserver);

    const intersectionObserver =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries, obs) => {
              for (const e of entries) {
                if (!e.isIntersecting) continue;
                obs.unobserve(e.target);
                hydrateThumb(e.target, resizeObserver);
              }
            },
            { rootMargin: '300px 0px' },
          )
        : null;
    if (intersectionObserver) observers.push(intersectionObserver);

    // Re-render already-hydrated thumbnails after the preview surface changes.
    // Pending tiles are left alone — they hydrate with the new surface when they
    // scroll into view. Tiles whose type has no background field never change,
    // so they're skipped to avoid needless re-renders/flashes.
    const restyleHydratedThumbs = () => {
      if (viewMode !== 'preview') return; // schematics don't render a surface
      for (const wrap of typesWrap.querySelectorAll('.ps-type-thumb.thumb')) {
        const type = wrap.dataset.thumbType;
        if (type === 'video-slide' || type === 'embed-slide') continue;
        if (wrap.classList.contains('is-pending')) continue;
        if (!backgroundOptionsFor(type)) continue;
        cleanupSlideRuntimes(wrap);
        wrap.innerHTML = '';
        hydrateThumb(wrap, resizeObserver);
      }
    };

    const pinLabelFor = (pinned) =>
      pinned
        ? t('editor.slideTypePicker.unpin', 'Unpin')
        : t('editor.slideTypePicker.pin', 'Pin to top');

    // A tile is a wrap holding the (button) card plus an overlay pin button as a
    // sibling — never a button nested in a button. The wrap is the grid item and
    // the unit the search filter shows/hides. `preset` (item 15) makes this a
    // layout-variant tile: its thumbnail and inserted slide carry the preset's
    // content overrides, but pin/usage/search still key off the base type.
    const renderThumbnailCard = (type, label, preset = null) => {
      const thumbWrap = h('div', {
        class: 'ps-type-thumb thumb is-pending',
        'data-thumb-type': type,
      });
      if (preset) {
        thumbWrap.__presetContent = previewOverridesFor(preset);
        thumbWrap.__presetId = preset.id || null;
      }
      if (viewMode === 'schematic') {
        // Cheap symbolic diagram — render now, skip observers entirely.
        fillSchematic(thumbWrap, SLIDE_TYPES);
      } else if (intersectionObserver) {
        intersectionObserver.observe(thumbWrap);
      } else {
        // No IO (e.g. jsdom): hydrate immediately.
        hydrateThumb(thumbWrap, resizeObserver);
      }

      const labelWrap = h('div', { class: 'ps-type-labelwrap' }, [
        h('span', { class: 'ps-type-label', text: label }),
      ]);
      const desc = descFor(type);
      if (desc)
        labelWrap.append(h('span', { class: 'ps-type-desc', text: desc }));

      const card = h(
        'button',
        {
          class: 'ps-type-card ps-type-card-thumb',
          type: 'button',
          onclick: () => onPick(type, preset),
          title: desc || label,
        },
        [thumbWrap, labelWrap],
      );

      const pinned = isPinned(type);
      const pinBtn = h('button', {
        class: `ps-type-pin${pinned ? ' is-pinned' : ''}`,
        type: 'button',
        'aria-pressed': pinned ? 'true' : 'false',
        title: pinLabelFor(pinned),
        'aria-label': pinLabelFor(pinned),
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          const nowPinned = togglePin(type);
          applyPinChange(type, nowPinned);
        },
      });
      pinBtn.append(icon('pin', { size: 14 }));

      // Peek button (top-left): enlarge the preview before inserting.
      const peekLabel = t('editor.slideTypePicker.peek', 'Enlarge preview');
      const peekBtn = h('button', {
        class: 'ps-type-peek-btn',
        type: 'button',
        title: peekLabel,
        'aria-label': peekLabel,
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          openTypePeek(type, peekBtn, preset, peekCtx);
        },
      });
      peekBtn.append(icon('search', { size: 14 }));

      // Preset tiles keep the base label in their haystack too, so a search for
      // the type name still finds every variant (not just the variant label).
      const haystackLabel = preset ? `${labelFor(type)} ${label}` : label;

      return h(
        'div',
        {
          class: `ps-type-card-wrap${pinned ? ' is-pinned' : ''}`,
          'data-thumb-type-key': type,
          'data-search': searchHaystack(type, haystackLabel),
        },
        [card, peekBtn, pinBtn],
      );
    };

    const updateGroupCount = (group) => {
      const c = group.querySelector('.ps-type-group-count');
      if (c)
        c.textContent = String(
          group.querySelectorAll('.ps-type-card-wrap').length,
        );
    };

    // Append the tile(s) for one type to a grid: one tile per curated preset
    // (item 15) when `expandPresets` and the type has any, else a single base
    // tile. The pinned/frequent/other strips pass expandPresets=false so they
    // stay compact (one base tile per type).
    const appendTypeTiles = (grid, type, expandPresets) => {
      const presets = expandPresets ? SLIDE_TYPE_PRESETS[type] : null;
      if (presets && presets.length) {
        for (const p of presets)
          grid.append(renderThumbnailCard(type, presetLabelFor(p), p));
      } else {
        grid.append(renderThumbnailCard(type, labelFor(type)));
      }
    };

    // Build a category/strip group element (does not append it). `expandPresets`
    // turns on per-variant tiles for the curated category grids.
    const buildGroup = (key, title, defs, expandPresets = false) => {
      const present = defs.filter((q) => SLIDE_TYPES?.[q.type]);
      if (!present.length) return null;
      const collapsed = isSectionCollapsed(key);
      const group = h('div', {
        class: `ps-type-group${collapsed ? ' is-collapsed' : ''}`,
        'data-group-key': key,
      });

      const grid = h('div', { class: 'ps-type-grid ps-type-grid-thumbs' });
      for (const q of present) appendTypeTiles(grid, q.type, expandPresets);

      const toggle = h('button', {
        class: 'ps-type-group-toggle',
        type: 'button',
        'aria-expanded': collapsed ? 'false' : 'true',
        onclick: () => {
          const nowCollapsed = !group.classList.contains('is-collapsed');
          group.classList.toggle('is-collapsed', nowCollapsed);
          toggle.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
          setSectionCollapsed(key, nowCollapsed);
        },
      });
      toggle.append(
        h('span', { class: 'ps-type-group-chev', 'aria-hidden': 'true' }),
        h('span', { class: 'ps-type-group-name', text: title }),
        // Count actual tiles, not types — preset expansion adds variant tiles.
        h('span', {
          class: 'ps-type-group-count',
          text: String(grid.querySelectorAll('.ps-type-card-wrap').length),
        }),
      );

      group.append(h('h3', { class: 'ps-type-group-title' }, [toggle]), grid);
      return group;
    };

    const renderAddGroup = (
      parentEl,
      key,
      title,
      defs,
      expandPresets = false,
    ) => {
      const group = buildGroup(key, title, defs, expandPresets);
      if (group) parentEl.append(group);
    };

    // --- Pin toggle: update tiles + the pinned/frequent strips in place ----
    // (Incremental, so already-hydrated thumbnails don't flash on every pin.)
    const groupByKey = (key) =>
      typesWrap.querySelector(`.ps-type-group[data-group-key="${key}"]`);

    const addToStrip = (key, title, type) => {
      let group = groupByKey(key);
      if (!group) {
        group = buildGroup(key, title, [{ type }]);
        if (!group) return;
        if (key === 'pinned') {
          typesWrap.prepend(group);
        } else {
          const pinnedGroup = groupByKey('pinned');
          if (pinnedGroup) pinnedGroup.after(group);
          else typesWrap.prepend(group);
        }
        return;
      }
      const grid = group.querySelector('.ps-type-grid');
      if (
        grid.querySelector(
          `.ps-type-card-wrap[data-thumb-type-key="${cssEsc(type)}"]`,
        )
      )
        return;
      grid.append(renderThumbnailCard(type, labelFor(type)));
      updateGroupCount(group);
    };

    const removeFromStrip = (key, type) => {
      const group = groupByKey(key);
      if (!group) return;
      const wrap = group.querySelector(
        `.ps-type-card-wrap[data-thumb-type-key="${cssEsc(type)}"]`,
      );
      if (wrap) wrap.remove();
      if (group.querySelectorAll('.ps-type-card-wrap').length === 0)
        group.remove();
      else updateGroupCount(group);
    };

    const applyPinChange = (type, nowPinned) => {
      for (const wrap of typesWrap.querySelectorAll(
        `.ps-type-card-wrap[data-thumb-type-key="${cssEsc(type)}"]`,
      )) {
        wrap.classList.toggle('is-pinned', nowPinned);
        const btn = wrap.querySelector('.ps-type-pin');
        if (btn) {
          btn.classList.toggle('is-pinned', nowPinned);
          btn.setAttribute('aria-pressed', nowPinned ? 'true' : 'false');
          btn.title = pinLabelFor(nowPinned);
          btn.setAttribute('aria-label', btn.title);
        }
      }
      if (nowPinned) {
        addToStrip('pinned', t('editor.slideTypeGroup.pinned', 'Pinned'), type);
        removeFromStrip('frequent', type);
      } else {
        removeFromStrip('pinned', type);
      }
      applyFilter();
    };

    // Search / filter box: filters the rendered cards in place (thumbnails are
    // expensive to build, so we hide rather than re-render on each keystroke).
    // Search + surface toggle share one row (search left, toggle right).
    const controls = h('div', { class: 'ps-picker-controls' });
    const searchWrap = h('div', { class: 'ps-picker-search' });
    const searchInput = h('input', {
      class: 'form-input ps-picker-search-input',
      type: 'search',
      value: searchQuery,
      placeholder: t(
        'editor.slideTypePicker.searchPlaceholder',
        'Search slide types…',
      ),
      'aria-label': t(
        'editor.slideTypePicker.searchPlaceholder',
        'Search slide types…',
      ),
      autocomplete: 'off',
    });
    searchWrap.append(searchInput);
    controls.append(searchWrap);

    // --- Schematic / preview view toggle -----------------------------------
    // Segmented control: schematic (abstract diagrams, default) vs preview (real
    // slides rendered small). Swaps every tile's thumbnail in place.
    const viewToggle = h('div', {
      class: 'ps-view-toggle',
      role: 'radiogroup',
      'aria-label': t('editor.slideTypePicker.view.label', 'Thumbnail style'),
    });
    // Abstract wireframe vs. a real rendered slide — the two view modes.
    const VIEW_ICON = { schematic: 'layout-template', preview: 'image' };
    const makeViewBtn = (mode, label) => {
      const on = viewMode === mode;
      const btn = h('button', {
        class: `ps-view-toggle-btn${on ? ' is-active' : ''}`,
        type: 'button',
        role: 'radio',
        'data-view': mode,
        'aria-checked': on ? 'true' : 'false',
        title: label,
        'aria-label': label,
        onclick: () => applyViewMode(mode),
      });
      btn.append(
        icon(VIEW_ICON[mode], { size: 15 }),
        h('span', { class: 'ps-view-toggle-text', text: label }),
      );
      return btn;
    };
    viewToggle.append(
      makeViewBtn(
        'schematic',
        t('editor.slideTypePicker.view.schematic', 'Schematic'),
      ),
      makeViewBtn(
        'preview',
        t('editor.slideTypePicker.view.preview', 'Preview'),
      ),
    );
    controls.append(viewToggle);
    mount.append(controls);

    const typesWrap = h('div', {
      class: `ps-slide-types is-thumb-mode ${viewMode === 'schematic' ? 'is-schematic-mode' : 'is-preview-mode'}`,
    });

    // Swap every tile's thumbnail between schematic and live-preview rendering,
    // persist the choice, and sync the toggle + surface control. Tiles are
    // rebuilt in place so scroll position and search state survive.
    const applyViewMode = (mode) => {
      if (!VIEW_MODES.has(mode) || mode === viewMode) return;
      viewMode = mode;
      persistViewMode(mode);
      typesWrap.classList.toggle('is-schematic-mode', mode === 'schematic');
      typesWrap.classList.toggle('is-preview-mode', mode === 'preview');
      for (const b of viewToggle.querySelectorAll('.ps-view-toggle-btn')) {
        const on = (b.dataset.view || '') === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      // The preview-background swatches only affect live renders.
      const surfaceEl = controls.querySelector('.ps-surface-toggle');
      if (surfaceEl) surfaceEl.hidden = mode !== 'preview';
      for (const wrap of typesWrap.querySelectorAll('.ps-type-thumb.thumb')) {
        cleanupSlideRuntimes(wrap);
        wrap.innerHTML = '';
        wrap.classList.remove(
          'is-error',
          'ps-type-thumb-video',
          'ps-type-thumb-embed',
        );
        if (mode === 'schematic') {
          fillSchematic(wrap, SLIDE_TYPES);
        } else {
          wrap.classList.add('is-pending');
          if (intersectionObserver) intersectionObserver.observe(wrap);
          else hydrateThumb(wrap, resizeObserver);
        }
      }
    };

    // --- Preview-background toggle -----------------------------------------
    // Offer only surfaces this theme actually defines (distinct token value) and
    // that at least one insertable type supports. Also validates/repairs a stale
    // stored surface for this theme before any thumbnail hydrates.
    const surfaceColor = (s) =>
      String(theme?.cssVars?.[`--t-slide-bg-${s}`] || '').trim();
    const offeredSurfaces = (() => {
      const seen = new Set();
      const out = [];
      for (const s of SURFACE_CANDIDATES) {
        const color = surfaceColor(s);
        if (!color || seen.has(color)) continue;
        if (
          !Object.keys(SLIDE_TYPES || {}).some(
            (type) => allowed(type) && typeSupportsSurface(type, s),
          )
        )
          continue;
        seen.add(color);
        out.push(s);
      }
      return out;
    })();
    if (currentSurface && !offeredSurfaces.includes(currentSurface))
      currentSurface = '';

    if (offeredSurfaces.length >= 2) {
      const surfaceLabelFor = (s) =>
        t(
          `editor.slideTypePicker.surface.${s}`,
          { lime: 'Lime', mist: 'Mist', dark: 'Dark' }[s] || s,
        );
      const autoLabel = t(
        'editor.slideTypePicker.surface.auto',
        "Each type's own background",
      );
      const toggle = h('div', {
        class: 'ps-surface-toggle',
        role: 'radiogroup',
        'aria-label': t(
          'editor.slideTypePicker.surface.label',
          'Preview background',
        ),
        // Only meaningful for live previews; hidden while schematics are shown.
        hidden: viewMode !== 'preview',
      });
      toggle.append(
        h('span', {
          class: 'ps-surface-label',
          text: t('editor.slideTypePicker.surface.label', 'Preview background'),
        }),
      );

      const selectSurface = (surface) => {
        if (surface === currentSurface) return;
        currentSurface = surface;
        persistSurface(surface);
        for (const b of toggle.querySelectorAll('.ps-surface-swatch')) {
          const on = (b.dataset.surface || '') === surface;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        }
        restyleHydratedThumbs();
      };

      const makeSwatch = (surface) => {
        const isAuto = surface === '';
        const active = currentSurface === surface;
        const label = isAuto ? autoLabel : surfaceLabelFor(surface);
        const btn = h('button', {
          class: `ps-surface-swatch${active ? ' is-active' : ''}${isAuto ? ' is-auto' : ''}`,
          type: 'button',
          role: 'radio',
          'data-surface': surface,
          'aria-checked': active ? 'true' : 'false',
          title: label,
          'aria-label': label,
          onclick: () => selectSurface(surface),
        });
        if (isAuto) {
          // Two-tone diagonal so "auto" reads as "varies per type".
          btn.style.setProperty('--sw-a', surfaceColor(offeredSurfaces[0]));
          btn.style.setProperty('--sw-b', surfaceColor(offeredSurfaces[1]));
        } else {
          btn.style.setProperty('--sw', surfaceColor(surface));
        }
        return btn;
      };

      toggle.append(makeSwatch(''));
      for (const s of offeredSurfaces) toggle.append(makeSwatch(s));
      controls.append(toggle);
    }

    mount.append(typesWrap);

    const noResults = h('div', { class: 'ps-picker-no-results', hidden: true });
    const noResultsText = h('div', {
      class: 'ps-picker-no-results-text',
      text: t(
        'editor.slideTypePicker.noResults',
        'No slide types match your search.',
      ),
    });
    noResults.append(noResultsText);
    // Escape hatch: hand the query to the AI "add slides" flow.
    if (typeof requestAi === 'function') {
      const aiHatch = h('button', {
        class: 'btn btn-ai ps-picker-ai-hatch',
        type: 'button',
        text: t(
          'editor.slideTypePicker.buildWithAi',
          'Describe it and let AI build it',
        ),
        onclick: () => {
          const query = searchQuery.trim();
          onPicked?.();
          setTimeout(() => {
            try {
              requestAi({ afterSlideId, query });
            } catch {
              // ignore
            }
          }, 0);
        },
      });
      noResults.append(aiHatch);
    }
    mount.append(noResults);

    // Filter cards + groups against the current query. Empty groups collapse,
    // and a "no results" line shows when nothing matches. During an active
    // search, collapsed sections are force-expanded (via is-searching) so their
    // matches are visible.
    const applyFilter = () => {
      const q = searchQuery.trim().toLowerCase();
      typesWrap.classList.toggle('is-searching', !!q);
      let anyVisible = false;
      for (const group of typesWrap.querySelectorAll('.ps-type-group')) {
        let groupVisible = false;
        for (const wrap of group.querySelectorAll('.ps-type-card-wrap')) {
          const hay = wrap.getAttribute('data-search') || '';
          const match = !q || hay.includes(q);
          wrap.hidden = !match;
          if (match) groupVisible = true;
        }
        group.hidden = !groupVisible;
        if (groupVisible) anyVisible = true;
      }
      noResults.hidden = anyVisible;
    };

    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value || '';
      applyFilter();
    });
    // Escape clears the query first; only closes the modal when already empty.
    searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (searchQuery) {
        e.stopPropagation();
        searchQuery = '';
        searchInput.value = '';
        applyFilter();
      }
    });

    // Membership is derived from each type's own `group` declaration; ./data.js
    // only supplies the display order within a shelf. A group that still named a
    // retired type used to be caught only by someone noticing — now it cannot
    // happen, because the retired type simply stops declaring.
    //
    // SLIDE_TYPES is the live map (the /api/slide-types response), so the shelf
    // is drawn from the types this app actually has. Handing typesInGroup() the
    // core aggregator instead would let a fork type declare `media` and be
    // dropped without a word.
    const groupDefs = (key) =>
      typesInGroup(key, PICKER_GROUP_ORDER[key], SLIDE_TYPES || {}).map(
        (type) => ({ type }),
      );

    // Themes can prepend their own types to "Basic" via basicSlideTypes.
    const themeBasicTypes = Array.isArray(theme?.basicSlideTypes)
      ? theme.basicSlideTypes
      : [];
    // A theme type that also declares `group: 'basic'` would otherwise show up
    // twice now that the shelves are drawn from the live map; the prepended
    // position wins.
    const themeBasic = themeBasicTypes.filter((type) => SLIDE_TYPES?.[type]);
    const basicDefs = [
      ...themeBasic.map((type) => ({ type })),
      ...groupDefs('basic').filter((d) => !themeBasic.includes(d.type)),
    ];

    // Custom slide types (keys starting with 'custom-' or marked isCustom) that
    // declare no shelf of their own.
    //
    // A declared group wins: a fork type that says `group: 'media'` is offered
    // beside the other media types, because someone inserting a slide is asking
    // what goes on it, not who wrote the type. "Custom" is then the shelf for a
    // type that declares nothing — which is also how an org keeps its types
    // together if it wants that: by declaring nothing.
    const customDefs = Object.keys(SLIDE_TYPES || {})
      .filter((key) => {
        const def = SLIDE_TYPES[key];
        if (!(key.startsWith('custom-') || def?.isCustom) || !allowed(key))
          return false;
        return !slideTypeGroup(key, def);
      })
      .sort((a, b) => String(labelFor(a)).localeCompare(String(labelFor(b))))
      .map((key) => ({ type: key }));

    // Curated groups in display order. `basic` is special-cased because the
    // theme may prepend its own types to it; every other shelf is purely the
    // declarations, ordered by the hint in ./data.js.
    //
    // Spelled as `titleKey` / `title` descriptor pairs, not tuples: that is the
    // one shape the i18n extractor reads (scripts/i18n-keys.js), so these five
    // shelf names count as used keys and `i18n-fill.js en` materializes them.
    // As tuples they were invisible, which is half of why en/ lacked them (B138).
    const GROUP_TITLES = {
      basic: { titleKey: 'editor.slideTypeGroup.basic', title: 'Basic' },
      media: { titleKey: 'editor.slideTypeGroup.media', title: 'Media' },
      layouts: { titleKey: 'editor.slideTypeGroup.layouts', title: 'Layouts' },
      data: { titleKey: 'editor.slideTypeGroup.data', title: 'Data' },
      interaction: {
        titleKey: 'editor.slideTypeGroup.interaction',
        title: 'Interaction',
      },
    };
    const curatedGroups = [
      ...PICKER_GROUP_KEYS.map((key) => ({
        key,
        title: t(GROUP_TITLES[key].titleKey, GROUP_TITLES[key].title),
        defs: (key === 'basic' ? basicDefs : groupDefs(key)).filter((d) =>
          allowed(d.type),
        ),
      })),
      {
        key: 'custom',
        title: t('editor.slideTypeGroup.custom', 'Custom'),
        defs: customDefs,
      },
    ];

    // --- Quick-access strips above the categories --------------------------
    const pinnedTypes = getPins().filter(
      (type) => SLIDE_TYPES?.[type] && allowed(type),
    );
    if (pinnedTypes.length) {
      renderAddGroup(
        typesWrap,
        'pinned',
        t('editor.slideTypeGroup.pinned', 'Pinned'),
        pinnedTypes.map((type) => ({ type })),
      );
    }

    // Frequently used: top types by local insert count. Excludes pinned (they're
    // already up top) and only shows once there's real signal, capped to one row.
    const usage = getUsage();
    const totalUses = Object.values(usage).reduce(
      (a, b) => a + (Number(b) || 0),
      0,
    );
    const frequentTypes = Object.entries(usage)
      .filter(
        ([type, n]) => Number(n) > 0 && SLIDE_TYPES?.[type] && allowed(type),
      )
      .filter(([type]) => !pinnedTypes.includes(type))
      .sort((a, b) => b[1] - a[1])
      .slice(0, FREQUENT_MAX)
      .map(([type]) => type);
    if (totalUses >= FREQUENT_MIN_TOTAL && frequentTypes.length >= 2) {
      renderAddGroup(
        typesWrap,
        'frequent',
        t('editor.slideTypeGroup.frequent', 'Frequently used'),
        frequentTypes.map((type) => ({ type })),
      );
    }

    // A whole section header for a single card wastes space, so any group with
    // exactly one item is folded into "Other" instead of standing alone.
    const overflowDefs = [];
    for (const g of curatedGroups) {
      if (g.defs.length === 0) continue;
      if (g.defs.length === 1) {
        overflowDefs.push(g.defs[0]);
        continue;
      }
      // Curated category grids expand layout-variant presets into their own tiles.
      renderAddGroup(typesWrap, g.key, g.title, g.defs, true);
    }

    // Collect all explicitly categorized types (rendered or folded)
    const used = new Set(
      curatedGroups.flatMap((g) => g.defs.map((d) => d.type)),
    );

    // Remaining slide types go in "Other"
    const otherTypes = Object.keys(SLIDE_TYPES || {})
      .filter((type) => allowed(type))
      .filter((type) => !used.has(type))
      .sort((a, b) => String(labelFor(a)).localeCompare(String(labelFor(b))));

    // Payoff slide pinned at the end of Other
    const pinnedTailDefs = [{ type: 'payoff-slide' }].filter((d) =>
      allowed(d.type),
    );
    const pinnedSet = new Set(pinnedTailDefs.map((d) => d.type));

    const otherDefs = [
      ...otherTypes
        .filter((type) => !pinnedSet.has(type))
        .map((type) => ({ type })),
      // Folded single-item groups land here before the pinned tail.
      ...overflowDefs.filter((d) => !pinnedSet.has(d.type)),
      ...pinnedTailDefs,
    ];

    if (otherDefs.length) {
      renderAddGroup(
        typesWrap,
        'other',
        t('editor.slideTypeGroup.other', 'Other'),
        otherDefs,
      );
    }

    // Apply any persisted query to the freshly built card set, then focus the
    // box so the user can type immediately after the picker opens.
    applyFilter();
    requestAnimationFrame(() => {
      try {
        searchInput.focus();
      } catch {
        // ignore
      }
    });

    // Keyboard-first flow (item 17): ArrowDown from search enters the grid,
    // arrows move between cards, Enter inserts, ArrowUp from the top row returns
    // to search. Torn down on the next render pass (see teardownObservers).
    teardownKeyboard = wireGridKeyboardNav({
      container: typesWrap,
      searchInput,
    });

    // --- Inline "From your library" strip (item 10) ------------------------
    // Loaded async so it never blocks the type grid, prepended above the
    // categories when non-empty, and gated on onSeeAllLibrary (modal context
    // with a library tab). Hidden entirely on empty/error.
    if (
      typeof loadLibraryStripItems === 'function' &&
      typeof onSeeAllLibrary === 'function'
    ) {
      mountLibraryStrip({
        typesWrap,
        theme,
        labelFor,
        afterSlideId,
        onPicked,
        loadLibraryStripItems,
        insertLibraryItem,
        onSeeAllLibrary,
        resizeObserver,
        applyFilter,
      });
    }
  };

  return { renderSlideTypePicker };
}
