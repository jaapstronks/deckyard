// Shared "schematic" mini-diagram renderer: an abstract, symbolic drawing of a
// slide's structure (grey image blocks + text bars), à la Keynote/PowerPoint's
// layout picker. Built from plain <div>s styled by CSS — legible at any size
// because it shows *structure*, not shrunk-down real content.
//
// Originally lifted from the layout switcher (which drew image/text layout
// variants); generalised here so both the layout switcher and the "Insert
// slide" type picker speak one visual language. The layout-switcher grammar
// (split/corner/duo/row/cols/textCols) is preserved as-is; archetype `kind`s
// (title, section, kpi, gallery, …) are added on top.
//
// A spec is a small JSON-safe object, so slide-type definitions (incl. forks
// and custom types) can declare their own icon without importing this module:
//   { kind: 'title' }            centred title + subtitle
//   { kind: 'section' }          filled accent block with a heading
//   { kind: 'oneCol' }           heading + body lines
//   { kind: 'twoCol' }           heading + two text columns
//   { kind: 'bullets' }          heading + bulleted rows
//   { kind: 'numbers' }          heading + numbered rows
//   { kind: 'quote' }            big centred quote + attribution
//   { kind: 'statement' }        one big centred line (payoff)
//   { kind: 'image' }            single full-bleed image (duotone landscape)
//   { kind: 'code' }             centred `</>` glyph (custom HTML/code)
//   { kind: 'gallery', cells }   grid of image cells
//   { kind: 'cards', cells }     grid of image-over-label cards
//   { kind: 'logos', cells }     grid of rounded logo chips
//   { kind: 'blocks', cells }    grid of labelled text blocks
//   { kind: 'iconCards', cells } grid of icon-dot + label cards
//   { kind: 'kpi', cells }       grid of stat tiles (big number + delta)
//   { kind: 'table' }            data grid
//   { kind: 'chart' }            bar chart
//   { kind: 'timeline' }         horizontal line with milestone dots
//   { kind: 'process' }          boxes joined by connectors
//   { kind: 'comparison' }       two panels split by a divider
//   { kind: 'matrix' }           2×2 quadrant
//   { kind: 'pyramid' }          stacked hierarchy (narrowing up)
//   { kind: 'funnel' }           stacked funnel (narrowing down)
//   { kind: 'cycle' }            ring of dots
//   { kind: 'poll' }             question + horizontal result bars
//   { kind: 'bars', rows }       question + equal option rows (likert)
//   { kind: 'slider' }           question + slider track with a knob
//   { kind: 'feedback' }         question + open text area
//   { kind: 'qr' }               QR square + caption
//   { kind: 'countdown' }        big centred timer
//   { kind: 'video' }            image with a play button
//   { kind: 'embed' }            browser-window chrome
//   { kind: 'partners' }         centred title + two partner logos
//   { kind: 'freeform' }         scattered elements on a canvas
// Legacy image/text layout grammar (unchanged, used by the layout switcher):
//   { split: <pct> } | { corner: <pct> } | { duo: <pct> } |
//   { row: 'top'|'bottom' } | { cols: <n> } | { textCols: <n> } | {}

/**
 * Build a schematic mini-diagram element for a slide layout/type.
 * @param {Function} h - hyperscript factory (from client/lib/dom.js)
 * @param {Object} [spec] - the schematic descriptor (see grammar above)
 * @param {Object} [opts]
 * @param {boolean} [opts.mirrored] - flip the image side (split/corner/duo)
 * @returns {HTMLElement} a `.layout-tile-schematic` element
 */
export function renderSlideSchematic(h, spec = {}, opts = {}) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const mirrored = !!opts.mirrored || !!s.mirror;
  const box = h('div', { class: 'layout-tile-schematic', 'aria-hidden': 'true' });

  // --- small primitives -----------------------------------------------------
  const line = (mod) => h('div', { class: `layout-tile-line${mod ? ' ' + mod : ''}` });
  const image = (cls, style) =>
    h('div', { class: `layout-tile-image${cls ? ' ' + cls : ''}`, ...(style ? { style } : {}) });
  const textBlock = () =>
    h('div', { class: 'layout-tile-text' }, [line('is-heading'), line(), line('is-short')]);
  const centerBlock = (children) => h('div', { class: 'sd-center' }, children);
  const grid = (cols, rows, cells) => {
    box.classList.add('is-grid');
    box.style.setProperty('--sd-cols', String(cols));
    box.style.setProperty('--sd-rows', String(rows));
    for (const c of cells) box.append(c);
  };
  const gridCells = (count, make) => Array.from({ length: count }, (_, i) => make(i));
  // Duotone landscape glyph: a symbolic "photo" (sky + sun + hills), so image
  // archetypes read as pictures rather than blank grey fills. Fills its box via
  // preserveAspectRatio="slice"; the two tones come from --sd-fill / --sd-strong.
  const landscape = () =>
    h('svg', { class: 'sd-landscape', viewBox: '0 0 32 18', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' }, [
      h('rect', { class: 'sd-ls-sky', x: '0', y: '0', width: '32', height: '18' }),
      h('circle', { class: 'sd-ls-sun', cx: '23.5', cy: '5', r: '2.6' }),
      h('path', { class: 'sd-ls-hill', d: 'M0 18 L9 10 L14.5 13.5 L21 7 L27 12 L32 9 L32 18 Z' }),
    ]);
  const photoCell = () => h('div', { class: 'layout-tile-image is-cell is-photo' }, [landscape()]);
  // A few simple line-icon glyphs for the icon-cards archetype (see 'iconCards').
  const ICON_GLYPHS = {
    gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5a8 8 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2-1.2l-.4-2.6H8.9l-.4 2.6a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2 1.2l.4 2.6h4.2l.4-2.6a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2Z',
    bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.3 1 2.1V16h6v-.4c0-.8.4-1.5 1-2.1A6 6 0 0 0 12 3Z',
    star: 'M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6L12 16.9 6.6 19.5l1.2-6L3.4 9.3l6-.7L12 3Z',
    bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  };
  const iconGlyph = (name) =>
    h('svg', { class: 'sd-glyph', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'aria-hidden': 'true' }, [
      h('path', { d: ICON_GLYPHS[name] }),
    ]);

  const kind = s.kind || legacyKind(s);

  switch (kind) {
    // --- text / title family ------------------------------------------------
    case 'title':
      box.classList.add('is-title');
      box.append(centerBlock([line('is-title'), line('is-sub')]));
      break;
    case 'statement':
      box.classList.add('is-statement');
      box.append(centerBlock([line('is-big'), line('is-big is-short')]));
      break;
    case 'section':
      // A section/chapter divider: a centred heading over a short accent rule.
      // Deliberately NOT a full accent-green fill — that read as the odd one out
      // among the neutral tiles; the accent now lives only in the small rule.
      box.classList.add('is-section');
      box.append(
        h('div', { class: 'sd-section-body' }, [
          h('div', { class: 'sd-section-rule' }),
          line('is-title'),
          line('is-sub'),
        ])
      );
      break;
    case 'quote':
      box.classList.add('is-quote');
      box.append(
        h('span', { class: 'sd-quote-mark', text: '“' }),
        h('div', { class: 'sd-quote-body' }, [
          line('is-big'),
          line('is-big'),
          line('is-big is-short'),
          line('is-attr'),
        ])
      );
      break;
    case 'oneCol':
      box.classList.add('is-onecol');
      box.append(
        h('div', { class: 'layout-tile-text' }, [line('is-heading'), line(), line(), line(), line('is-short')])
      );
      break;
    case 'twoCol':
      box.classList.add('is-twocol');
      box.append(
        line('is-heading is-top'),
        h('div', { class: 'sd-cols' }, [
          h('div', { class: 'layout-tile-text' }, [line(), line(), line(), line('is-short')]),
          h('div', { class: 'layout-tile-text' }, [line(), line(), line(), line('is-short')]),
        ])
      );
      break;
    case 'bullets':
    case 'numbers': {
      // No title placeholder: the glyph is the bullet/number rows themselves.
      // Just three big rows read more clearly at tile size than a heading + five
      // thin ones.
      const isNum = kind === 'numbers';
      box.classList.add(isNum ? 'is-numbers' : 'is-bullets');
      box.append(
        ...Array.from({ length: 3 }, (_, i) =>
          h('div', { class: 'sd-row' }, [
            isNum
              ? h('span', { class: 'sd-num', text: String(i + 1) })
              : h('span', { class: 'sd-bullet' }),
            line(),
          ])
        )
      );
      break;
    }

    // --- media family -------------------------------------------------------
    case 'image':
      box.classList.add('is-image');
      box.append(h('div', { class: 'layout-tile-image is-full is-photo' }, [landscape()]));
      break;
    case 'video':
      box.classList.add('is-image', 'is-video');
      box.append(h('div', { class: 'layout-tile-image is-full is-photo' }, [landscape()]), h('span', { class: 'sd-play' }));
      break;
    case 'code':
      box.classList.add('is-code');
      box.append(h('span', { class: 'sd-code', text: '</>' }));
      break;
    case 'embed':
      box.classList.add('is-embed');
      box.append(
        h('div', { class: 'sd-embed-bar' }, [
          h('span', { class: 'sd-embed-dot' }),
          h('span', { class: 'sd-embed-dot' }),
          h('span', { class: 'sd-embed-dot' }),
        ]),
        h('div', { class: 'sd-embed-body' })
      );
      break;
    case 'gallery':
      grid(3, 2, gridCells(Number(s.cells) || 6, () => photoCell()));
      box.classList.add('is-gallery');
      break;
    case 'cards':
      grid(Number(s.cols) || 3, Number(s.rows) || 2, gridCells(Number(s.cells) || 6, () =>
        h('div', { class: 'sd-card' }, [photoCell(), line('is-short')])
      ));
      box.classList.add('is-cards');
      break;
    case 'logos':
      grid(4, 2, gridCells(Number(s.cells) || 8, () => h('div', { class: 'sd-logo' })));
      box.classList.add('is-logos');
      break;
    case 'partners':
      box.classList.add('is-partners');
      box.append(
        centerBlock([line('is-title')]),
        h('div', { class: 'sd-partner-row' }, [h('div', { class: 'sd-logo' }), h('div', { class: 'sd-logo' })])
      );
      break;

    // --- structured / data family ------------------------------------------
    case 'blocks':
      grid(2, 2, gridCells(Number(s.cells) || 4, () =>
        h('div', { class: 'sd-block' }, [line('is-heading'), line('is-short')])
      ));
      box.classList.add('is-blocks');
      break;
    case 'iconCards': {
      // Four cards, each a distinct generic icon (gear / bulb / star / bolt).
      // The old dot-over-line read as person avatars; recognisable glyphs make
      // it clear these are "icon + label" cards, and four at 2×2 stay legible.
      const names = ['gear', 'bulb', 'star', 'bolt'];
      grid(2, 2, names.map((n) => h('div', { class: 'sd-card sd-iconcard' }, [iconGlyph(n)])));
      box.classList.add('is-iconcards');
      break;
    }
    case 'kpi':
      grid(2, 2, gridCells(Number(s.cells) || 4, () =>
        h('div', { class: 'sd-stat' }, [line('is-stat'), line('is-delta')])
      ));
      box.classList.add('is-kpi');
      break;
    case 'table':
      grid(Number(s.cols) || 3, Number(s.rows) || 3, gridCells((Number(s.cols) || 3) * (Number(s.rows) || 3), (i) =>
        h('div', { class: `sd-cell${i < (Number(s.cols) || 3) ? ' is-head' : ''}` })
      ));
      box.classList.add('is-table');
      break;
    case 'chart':
      box.classList.add('is-chart');
      box.append(
        h('div', { class: 'sd-bars' }, [40, 65, 50, 85, 60].map((hpc) =>
          h('div', { class: 'sd-bar', style: `height:${hpc}%` })
        )),
        h('div', { class: 'sd-axis' })
      );
      break;
    case 'comparison':
      box.classList.add('is-comparison');
      box.append(
        h('div', { class: 'sd-panel' }, [line('is-heading'), line(), line('is-short')]),
        h('div', { class: 'sd-divider' }),
        h('div', { class: 'sd-panel' }, [line('is-heading'), line(), line('is-short')])
      );
      break;
    case 'matrix':
      box.classList.add('is-matrix');
      box.append(
        h('div', { class: 'sd-matrix-v' }),
        h('div', { class: 'sd-matrix-h' }),
        ...gridCells(4, () => h('span', { class: 'sd-quad' }))
      );
      break;

    // --- flow / relationship family ----------------------------------------
    case 'process':
      box.classList.add('is-process');
      box.append(
        ...[0, 1, 2].flatMap((i) => {
          const node = h('div', { class: 'sd-step' });
          return i < 2 ? [node, h('span', { class: 'sd-arrow' })] : [node];
        })
      );
      break;
    case 'timeline':
      box.classList.add('is-timeline');
      box.append(
        h('div', { class: 'sd-timeline-line' }),
        h('div', { class: 'sd-timeline-dots' }, gridCells(4, () => h('span', { class: 'sd-dot' })))
      );
      break;
    case 'pyramid':
    case 'funnel': {
      const funnel = kind === 'funnel';
      box.classList.add(funnel ? 'is-funnel' : 'is-pyramid');
      const widths = funnel ? [92, 70, 46] : [46, 70, 92];
      box.append(...widths.map((w) => h('div', { class: 'sd-tier', style: `width:${w}%` })));
      break;
    }
    case 'cycle':
      box.classList.add('is-cycle');
      box.append(h('div', { class: 'sd-ring' }, gridCells(4, () => h('span', { class: 'sd-dot' }))));
      break;

    // --- interaction family -------------------------------------------------
    case 'poll':
      box.classList.add('is-poll');
      box.append(
        line('is-heading'),
        ...[80, 55, 35].map((w) => h('div', { class: 'sd-pollbar', style: `width:${w}%` }))
      );
      break;
    case 'bars': {
      box.classList.add('is-poll', 'is-bars');
      const rows = Math.max(3, Math.min(Number(s.rows) || 5, 5));
      box.append(line('is-heading'), ...Array.from({ length: rows }, () => h('div', { class: 'sd-pollbar', style: 'width:70%' })));
      break;
    }
    case 'slider':
      box.classList.add('is-slider');
      box.append(line('is-heading'), h('div', { class: 'sd-track' }, [h('span', { class: 'sd-knob' })]));
      break;
    case 'feedback':
      box.classList.add('is-feedback');
      box.append(line('is-heading'), h('div', { class: 'sd-textarea' }));
      break;
    case 'qr':
      box.classList.add('is-qr');
      box.append(h('div', { class: 'sd-qr' }), h('div', { class: 'sd-qr-cap' }, [line('is-short')]));
      break;
    case 'countdown':
      box.classList.add('is-countdown');
      box.append(centerBlock([line('is-timer')]));
      break;
    case 'freeform':
      box.classList.add('is-freeform');
      box.append(
        image('is-corner', 'width:34%;height:40%'),
        h('div', { class: 'sd-float sd-float-a' }),
        h('div', { class: 'sd-float sd-float-b' })
      );
      break;

    // --- legacy image/text layout grammar (layout switcher) -----------------
    case 'cols': {
      const cols = Math.min(Number(s.cols) || 3, 3);
      box.classList.add('is-cols');
      for (let i = 0; i < cols; i += 1) {
        box.append(h('div', { class: 'layout-tile-col' }, [image(), line(), line('is-short')]));
      }
      break;
    }
    case 'textCols': {
      const n = Math.min(Math.max(Number(s.textCols) || 2, 2), 3);
      box.classList.add('is-text-cols');
      for (let i = 0; i < n; i += 1) {
        box.append(
          h('div', { class: 'layout-tile-text' }, [line('is-heading'), line(), line(), line('is-short')])
        );
      }
      break;
    }
    case 'split': {
      const img = image('', `width:${Number(s.split)}%`);
      box.classList.add('is-split');
      if (mirrored) box.append(textBlock(), img);
      else box.append(img, textBlock());
      break;
    }
    case 'corner': {
      const img = image('is-corner', `width:${Number(s.corner)}%`);
      box.classList.add('is-corner');
      if (mirrored) box.append(textBlock(), img);
      else box.append(img, textBlock());
      break;
    }
    case 'duo': {
      const stack = h('div', { class: 'layout-tile-duo', style: `width:${Number(s.duo)}%` }, [image(), image()]);
      box.classList.add('is-duo');
      if (mirrored) box.append(textBlock(), stack);
      else box.append(stack, textBlock());
      break;
    }
    case 'row': {
      const top = s.row === 'top';
      box.classList.add('is-row', top ? 'is-row-top' : 'is-row-bottom');
      const rowBlock = h('div', { class: 'layout-tile-row' }, [image(), image()]);
      if (top) box.append(rowBlock, textBlock());
      else box.append(textBlock(), rowBlock);
      break;
    }

    // --- fallback -----------------------------------------------------------
    default:
      box.classList.add('is-text-only');
      box.append(textBlock());
  }

  return box;
}

/**
 * Map a legacy (kind-less) layout-switcher spec to a dispatch key.
 * @param {Object} s
 * @returns {string}
 */
function legacyKind(s) {
  if (Number.isFinite(Number(s.cols)) && Number(s.cols) > 1) return 'cols';
  if (Number.isFinite(Number(s.textCols)) && Number(s.textCols) > 1) return 'textCols';
  if (Number.isFinite(Number(s.split)) && Number(s.split) > 0) return 'split';
  if (Number.isFinite(Number(s.corner)) && Number(s.corner) > 0) return 'corner';
  if (Number.isFinite(Number(s.duo)) && Number(s.duo) > 0) return 'duo';
  if (s.row === 'top' || s.row === 'bottom') return 'row';
  return 'text';
}
