import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';
import { buildSectionHeader } from './section-header.js';
import { renderSlideElement } from '../../../lib/slide-runtime/slide-render.js';
import { attachThumbScale } from '../../../lib/slide-runtime/thumb-scale.js';
import { loadThemeById } from '../../../lib/theme/theme.js';

/**
 * Sandbox "Example presentations" shelf.
 *
 * A row of ready-made demo decks a guest can open and edit — the fastest way to
 * try the editor without starting from a blank deck. Each card previews the
 * deck's first slide (rendered with its theme); clicking it instantiates an
 * editable copy via the normal import path and jumps into the editor.
 *
 * Only mounted in sandbox mode; the caller gates on `features.sandboxMode`.
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.api - API client
 * @param {Function} opts.nav - Navigation function
 * @param {Array<Function>} [opts.detachThumbs] - collector for thumb cleanup fns
 * @returns {HTMLElement} the section element (loads its content asynchronously)
 */
export function createSandboxExamplesSection({ h, api, nav, detachThumbs }) {
  const section = h('div', {
    class: 'presentation-section sandbox-examples',
    'data-section': 'sandbox-examples',
  });

  const grid = h('div', { class: 'sandbox-examples-grid' });
  const loading = h('div', {
    class: 'help',
    text: t('sandbox.examples.loading', 'Loading examples…'),
  });

  section.append(
    buildSectionHeader({
      h,
      icon: 'sparkles',
      title: t('sandbox.examples.title', 'Try an example'),
      badge: '',
      hideViewAll: true,
    }),
    h('div', {
      class: 'help sandbox-examples-hint',
      text: t(
        'sandbox.examples.hint',
        'Open a ready-made deck and start editing — the quickest way to explore Deckyard.'
      ),
    }),
    loading
  );

  let busy = false;

  async function useExample(example) {
    if (busy) return;
    busy = true;
    try {
      const raw = example?.deck?.lang;
      const lang = raw === 'en-GB' ? 'en-GB' : raw === 'nl' ? 'nl' : 'en-GB';
      const created = await api('/api/presentations/import/json', {
        method: 'POST',
        body: JSON.stringify({ deck: example.deck, lang }),
      });
      if (created?.id) {
        nav?.(`/app/${created.id}?lang=${encodeURIComponent(created.lang || lang)}`);
      } else {
        throw new Error('no id');
      }
    } catch {
      toast(t('sandbox.examples.error', 'Could not open that example. Please try again.'), {
        type: 'error',
      });
      busy = false;
    }
  }

  function renderThumb(example) {
    const thumb = h('div', { class: 'thumb sandbox-example-thumb' });
    const first = Array.isArray(example?.deck?.slides) ? example.deck.slides[0] : null;
    if (!first) return thumb;
    const detach = attachThumbScale(thumb, { virtualWidth: 1600 });
    if (Array.isArray(detachThumbs)) detachThumbs.push(detach);
    (async () => {
      try {
        const theme = await loadThemeById(example.theme);
        thumb.append(renderSlideElement(first, { mode: 'thumb', theme }));
      } catch {
        // A thumb that fails to render just stays blank — never break the shelf.
      }
    })();
    return thumb;
  }

  function renderCard(example) {
    const card = h('button', {
      class: 'sandbox-example-card',
      type: 'button',
      onclick: () => useExample(example),
    });
    const meta = h('div', { class: 'sandbox-example-meta' }, [
      h('span', { class: 'sandbox-example-name', text: example.title }),
    ]);
    if (example.description) {
      meta.append(h('span', { class: 'sandbox-example-desc', text: example.description }));
    }
    meta.append(
      h('span', {
        class: 'sandbox-example-count',
        text: t('sandbox.examples.count', '{count} slides', {
          count: String(example.slideCount || 0),
        }),
      })
    );
    card.append(renderThumb(example), meta);
    return card;
  }

  (async () => {
    try {
      const resp = await api('/api/sandbox/examples');
      const examples = Array.isArray(resp?.examples) ? resp.examples : [];
      loading.remove();
      if (!examples.length) {
        section.remove();
        return;
      }
      for (const example of examples) grid.append(renderCard(example));
      section.append(grid);
    } catch {
      loading.textContent = t('sandbox.examples.loadError', 'Failed to load examples.');
    }
  })();

  return section;
}
