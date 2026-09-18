/**
 * The Public tab of the unified Share dialog: put the deck on the open web.
 *
 * A published deck has two links, and they are not interchangeable (B342):
 * `/p/…` is a page (findable, with a social preview, refuses to be framed) and
 * `/embed/…` is the player (`noindex`, frameable, controls under the slide).
 * Both are shown here as equal rows, with the iframe/SDK snippets folded
 * underneath, and one language picker drives all of them. This is the only
 * place the links live; the "Preview and address…" modal manages the social
 * preview and the slug.
 *
 * Publishing produces the same standalone page you can also download from
 * Export → HTML, so a cross-reference points at that offline twin.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { confirmModal } from '../../../../lib/dom/modal.js';
import { h } from '../../../../lib/dom.js';
import { createInlineError } from '../../../../lib/dom/inline-error.js';
import { getLangDisplayName } from '../../../../../shared/i18n-utils.js';
import {
  buildPublishedLinks,
  missingAltMessage,
} from '../../publish-export/publish.js';

/**
 * Create the publish section.
 * @param {Object} options
 * @param {Function} options.api - API call function
 * @param {Object} options.pres - Presentation object
 * @param {string} options.id - Presentation ID
 * @param {HTMLElement} options.modalRoot - Root element for nested modals
 * @param {Function} options.copyToClipboard - Clipboard copy function
 * @param {Object} options.toast - Toast notification service
 * @param {Function} options.doPublish - Runs the full publish flow
 * @param {Record<string, Object>} [options.slideTypes] - The editor's
 *   slide-type registry, to name the field a refused publish points at
 * @param {Function} options.openPreviewAddress - Opens the social preview +
 *   slug modal
 * @param {Function} options.handleNotionPublish - Adds the embed to Notion
 * @param {Function} options.notionAvailable - Returns true if Notion is enabled
 * @param {Function} options.syncShareUi - Refresh the topbar share button + dialog
 * @param {Function} options.openExport - Opens the Export modal (offline twin)
 * @param {Function} options.requestClose - Close the share dialog
 * @returns {{ el: HTMLElement, refresh: Function }}
 */
export function createPublishSection({
  api,
  pres,
  id,
  modalRoot,
  copyToClipboard,
  toast,
  doPublish,
  slideTypes,
  openPreviewAddress,
  handleNotionPublish,
  notionAvailable,
  syncShareUi,
  openExport,
  requestClose,
}) {
  const section = h('div', { class: 'share-publish-section' });
  // A refused publish is a state of this section, beside the button that was
  // refused (docs/reference/feedback-surfaces.md), not a passing toast: the
  // author has to go and fix a picture and try again.
  const publishError = createInlineError({ callout: true });
  // The language the links are shown in. Survives a re-render (a slug change
  // refreshes the tab); starts on the language being edited.
  let selectedLang = null;

  function isPublished() {
    return !!(typeof pres?.published?.id === 'string' && pres.published.id);
  }

  async function publishNow(button) {
    publishError.clear();
    button.disabled = true;
    const original = button.textContent;
    button.textContent = t('share.publish.publishing', 'Publishing…');
    try {
      const pub = await doPublish();
      if (pub) {
        syncShareUi?.();
        render();
      }
    } catch (e) {
      if (e?.code === 'missing_alt') {
        publishError.show(missingAltMessage(e, { pres, slideTypes }));
      } else {
        toast?.error?.(e, { durationMs: 3000 });
      }
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function unpublish() {
    const ok = await confirmModal(modalRoot || document.body, {
      title: t('editor.publish.unpublish', 'Unpublish'),
      message: t(
        'editor.publish.unpublish.confirm',
        'Unpublish?\n\nThis will invalidate the public link and embed links. Anyone with a shared /p/ or /embed/ link will no longer be able to open the presentation.\n\nIf you use this link in a website, invite, follow-along, notes/QR or other tooling, it will stop working there too.',
      ),
      confirmLabel: t('editor.publish.unpublish', 'Unpublish'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/presentations/${id}/publish`, { method: 'DELETE' });
      delete pres.published;
      syncShareUi?.();
      render();
    } catch (e) {
      toast?.error?.(e, { durationMs: 3000 });
    }
  }

  /** Cross-reference to the offline twin (Export → HTML). */
  function exportHint() {
    const link = h('button', {
      type: 'button',
      class: 'link-button',
      text: t('share.publish.exportLink', 'Export as a web page instead →'),
      onclick: () => {
        requestClose?.();
        openExport?.();
      },
    });
    return h('div', { class: 'share-xref-hint' }, [
      h('span', {
        text: t(
          'share.publish.exportHint',
          'Prefer an offline file to hand over? ',
        ),
      }),
      link,
    ]);
  }

  /** Copy `value`; a passing toast says whether it worked. */
  async function copy(value) {
    if (await copyToClipboard(value)) {
      toast?.success?.(t('common.copied', 'Copied'), { durationMs: 1500 });
    } else {
      toast?.error?.(
        t('common.copyFailed', 'Copy failed (select and copy manually).'),
      );
    }
  }

  /**
   * One copyable value: a label with its one-line help, the value read-only,
   * Copy (and Open for a page).
   */
  function linkRow({ kind, label, help, value, openHref, multiline = false }) {
    const field = multiline
      ? h('textarea', {
          class: 'form-input share-publish-url share-publish-snippet',
          readonly: true,
          'aria-label': label,
        })
      : h('input', {
          class: 'form-input share-publish-url',
          readonly: true,
          value,
          'aria-label': label,
        });
    if (multiline) field.value = value;
    field.addEventListener('focus', () => field.select());
    const actions = [
      h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t('common.copy', 'Copy'),
        onclick: () => copy(value),
      }),
    ];
    if (openHref) {
      actions.push(
        h('a', {
          class: 'btn btn-secondary btn-sm',
          href: openHref,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: t('common.open', 'Open'),
        }),
      );
    }
    return h('div', { class: 'share-publish-link', 'data-link': kind }, [
      h('div', { class: 'field-label', text: label }),
      help ? h('div', { class: 'help', text: help }) : null,
      h('div', { class: 'share-publish-url-row' }, [field, ...actions]),
    ]);
  }

  /**
   * The link block of a published deck: the language picker (only when the
   * deck has more than one version), Link and Embed as equal rows, and the
   * snippets folded underneath. The picker re-renders just this block.
   */
  function renderLinks() {
    const { currentLang, langs } = buildPublishedLinks(pres);
    if (!langs.some((l) => l.lang === selectedLang)) selectedLang = currentLang;
    const block = h('div', { class: 'share-publish-links' });

    // The rows are refilled on a language switch; the snippets' <details>
    // itself stays, so an unfolded block stays unfolded.
    const rows = h('div', { class: 'stack' });
    const snippetRows = h('div', { class: 'stack' });
    const snippets = h('details', { class: 'share-publish-snippets' }, [
      h('summary', {
        text: t('share.publish.snippets', 'Snippets for your own site'),
      }),
      snippetRows,
    ]);

    const fill = () => {
      const links = langs.find((l) => l.lang === selectedLang) || langs[0];
      rows.replaceChildren(
        linkRow({
          kind: 'page',
          label: t('share.publish.linkLabel', 'Link'),
          help: t(
            'share.publish.linkHelp',
            'A page to open and share. Findable, with a social preview.',
          ),
          value: links.url,
          openHref: links.url,
        }),
        linkRow({
          kind: 'embed',
          label: t('share.publish.embedLabel', 'Embed'),
          help: t(
            'share.publish.embedHelp',
            'Paste this URL into Notion or your own site. The controls sit below the slide.',
          ),
          value: links.embedUrl,
        }),
      );
      snippetRows.replaceChildren(
        linkRow({
          kind: 'iframe',
          label: t('share.publish.iframeLabel', 'iframe'),
          value: links.iframeSnippet,
          multiline: true,
        }),
        linkRow({
          kind: 'sdk',
          label: t('share.publish.sdkLabel', 'Embed SDK'),
          value: links.sdkSnippet,
          multiline: true,
        }),
      );
    };

    if (langs.length > 1) {
      const select = h(
        'select',
        {
          class: 'form-input is-compact',
          id: `share-publish-lang-${id}`,
          onchange: () => {
            selectedLang = select.value;
            fill();
          },
        },
        langs.map(({ lang }) =>
          h('option', { value: lang, text: getLangDisplayName(lang) }),
        ),
      );
      select.value = selectedLang;
      block.append(
        h('div', { class: 'share-publish-lang row' }, [
          h('label', {
            class: 'field-label',
            for: select.id,
            text: t('common.language', 'Language'),
          }),
          select,
        ]),
      );
    }
    fill();
    block.append(rows, snippets);
    return block;
  }

  function render() {
    section.innerHTML = '';
    const title = h('div', {
      class: 'share-section-title',
      text: t('share.publish.title', 'Put it on the open web'),
    });
    const help = h('div', {
      class: 'help share-publish-help',
      text: t(
        'share.publish.help',
        'A public, findable page with a social preview. It stays current and you can unpublish it anytime.',
      ),
    });
    section.append(title, help);

    if (!isPublished()) {
      const publishBtn = h('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: t('editor.publish.publish', 'Publish'),
        onclick: () => publishNow(publishBtn),
      });
      section.append(
        h('div', { class: 'share-publish-actions' }, [publishBtn]),
        publishError.el,
        exportHint(),
      );
      return;
    }

    // Published: the two links, the snippets, then management actions.
    section.append(renderLinks());

    const actions = h('div', { class: 'share-publish-actions' });
    actions.append(
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: t('share.publish.previewAddress', 'Preview and address…'),
        onclick: () => openPreviewAddress?.(),
      }),
    );
    if (
      notionAvailable?.() &&
      typeof pres?.notionSourcePageId === 'string' &&
      pres.notionSourcePageId
    ) {
      actions.append(
        h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          text: t('editor.publish.notion', 'Add to Notion page'),
          onclick: () => handleNotionPublish?.(),
        }),
      );
    }
    actions.append(
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        text: t('editor.publish.unpublish', 'Unpublish'),
        onclick: unpublish,
      }),
    );
    section.append(actions, exportHint());
  }

  render();

  return { el: section, refresh: render };
}
