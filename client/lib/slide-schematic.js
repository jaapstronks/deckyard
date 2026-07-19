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
//   { kind: 'image' }            single full-bleed image
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
      box.classList.add('is-section', 'is-filled');
      box.append(h('div', { class: 'sd-section-heading' }, [line('is-heading'), line('is-short')]));
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
      const isNum = kind === 'numbers';
      box.classList.add(isNum ? 'is-numbers' : 'is-bullets');
      const rows = Math.max(3, Math.min(Number(s.rows) || 4, 5));
      box.append(
        line('is-heading'),
        ...Array.from({ length: rows }, (_, i) =>
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
      box.append(image('is-full'));
      break;
    case 'video':
      box.classList.add('is-image', 'is-video');
      box.append(image('is-full'), h('span', { class: 'sd-play' }));
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
      grid(3, 2, gridCells(Number(s.cells) || 6, () => image('is-cell')));
      box.classList.add('is-gallery');
      break;
    case 'cards':
      grid(Number(s.cols) || 3, Number(s.rows) || 2, gridCells(Number(s.cells) || 6, () =>
        h('div', { class: 'sd-card' }, [image('is-cell'), line('is-short')])
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
    case 'iconCards':
      grid(Number(s.cols) || 3, Number(s.rows) || 2, gridCells(Number(s.cells) || 6, () =>
        h('div', { class: 'sd-card sd-iconcard' }, [h('span', { class: 'sd-icon' }), line('is-short')])
      ));
      box.classList.add('is-iconcards');
      break;
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
