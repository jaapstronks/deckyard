/**
 * Slide-level AI refine box ("Refine") for the inspector.
 *
 * A one-line command input plus a button that POSTs the whole presentation to
 * `/api/ai/iterate`, scoped to the current slide, and applies the returned
 * slides immediately with a one-click Undo toast. There is no non-destructive
 * preview surface here, so applying-then-undo beats a preview the user can't
 * see reflected on the slide.
 *
 * Pure builder: returns the panel element (or null when unavailable), holding
 * its own in-flight state and AbortController. It closes over nothing in the
 * editor's render loop, so it can live beside `editor-form.js` rather than
 * inside its closure.
 */

import { t } from '../../../lib/ui-i18n.js';
import { readPreferredLlmVendor } from '../../../lib/net/llm-vendor.js';
import { h } from '../../../lib/dom.js';

/**
 * @param {object} ctx
 * @param {(path: string, opts?: object) => Promise<any>} ctx.api
 * @param {object} ctx.pres The presentation being edited.
 * @param {object} ctx.slide The currently selected slide.
 * @param {() => string|undefined} [ctx.getSelectedSlideId]
 * @param {(id: string) => void} [ctx.setSelectedSlideId]
 * @param {object} ctx.editorState
 * @param {object} ctx.toast
 * @returns {HTMLElement|null} The refine panel, or null when `api` is absent.
 */
export function buildAiIteratePanel({
  api,
  pres,
  slide,
  getSelectedSlideId,
  setSelectedSlideId,
  editorState,
  toast,
}) {
  if (!api) return null;

  const iteratePanel = h('div', { class: 'ai-iterate-panel' });
  const iterateForm = h('div', { class: 'ai-iterate-form' });
  const iterateInput = h('input', {
    type: 'text',
    class: 'form-input ai-iterate-input',
    placeholder: t(
      'editor.slide.aiIterate.placeholder',
      'Make this punchier, split this slide…',
    ),
  });
  const iterateBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary ai-iterate-btn',
    title: t('editor.slide.aiIterate.title', 'Use AI to refine this slide'),
  });
  iterateBtn.textContent = t('editor.slide.aiIterate.button', 'Refine');

  let isIterating = false;
  let iterateController = null;

  // While a refine is in flight the button becomes a Cancel control (with a
  // spinner) so the user can abort a slow LLM call instead of waiting.
  const setIterateBusy = (busy) => {
    isIterating = busy;
    iterateBtn.classList.toggle('is-loading', busy);
    iterateBtn.textContent = busy
      ? t('editor.slide.aiIterate.cancel', 'Cancel')
      : t('editor.slide.aiIterate.button', 'Refine');
  };

  const handleIterate = async () => {
    const command = iterateInput.value.trim();
    if (!command || isIterating) return;

    iterateController = new AbortController();
    setIterateBusy(true);

    try {
      const vendor = readPreferredLlmVendor() || null;
      const lang = pres?.i18n?.active === 'en-GB' ? 'en-GB' : 'nl';

      // This panel edits one slide: tell the server which slide so refine
      // scopes to it (faster) unless the command names another slide.
      const currentSlideIndex = pres.slides.findIndex((s) => s.id === slide.id);

      const resp = await api('/api/ai/iterate', {
        method: 'POST',
        signal: iterateController.signal,
        body: JSON.stringify({
          presentation: pres,
          command,
          lang,
          vendor,
          currentSlideIndex,
          applyChanges: true,
        }),
      });

      if (resp?.plan?.modifications?.length > 0 && resp.presentation?.slides) {
        // Apply the change immediately, then offer a one-click Undo.
        // There is no non-destructive preview surface here, so a preview the
        // user can't see reflected on the slide is worse than just applying
        // it and using the plan summary to explain what was done — with Undo
        // as the safety net. The editor's own undo history also captures it.
        const prevSlides = structuredClone(pres.slides);
        const prevSelectedId = getSelectedSlideId?.();

        pres.slides = resp.presentation.slides;
        // Keep the edited slide selected/visible if the server flagged one.
        if (
          resp.targetSlideIndex != null &&
          pres.slides[resp.targetSlideIndex]
        ) {
          setSelectedSlideId?.(pres.slides[resp.targetSlideIndex].id);
        }
        editorState.dirtyRefreshAll();
        iterateInput.value = '';

        // Explain what was done. The per-modification `reasoning` is the
        // human-readable account of the edit (e.g. "translated to Dutch,
        // keeping structure and formatting"); fall back to the terse plan
        // summary, then a generic string.
        const reasons = resp.plan.modifications
          .map((m) => String(m?.reasoning || '').trim())
          .filter(Boolean);
        const summaryText =
          (reasons.length ? reasons.join(' • ') : '') ||
          resp.plan.summary ||
          t('editor.slide.aiIterate.applied', 'Changes applied');
        toast.success(summaryText, {
          durationMs: 15000,
          action: {
            label: t('editor.slide.aiIterate.undo', 'Undo'),
            onClick: () => {
              pres.slides = structuredClone(prevSlides);
              if (
                prevSelectedId &&
                pres.slides.some((s) => s.id === prevSelectedId)
              ) {
                setSelectedSlideId?.(prevSelectedId);
              }
              editorState.dirtyRefreshAll();
              toast.info(
                t('editor.slide.aiIterate.reverted', 'Reverted the change.'),
              );
            },
          },
        });
      } else {
        toast.info(
          t('editor.slide.aiIterate.noChanges', 'No changes suggested'),
        );
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        toast.info(
          t('editor.slide.aiIterate.cancelled', 'Refinement cancelled.'),
        );
      } else {
        console.error('[AI Iterate] Error:', e);
        toast.error(
          t('editor.slide.aiIterate.failed', 'Refinement failed: {error}', {
            error: e?.message || String(e),
          }),
        );
      }
    } finally {
      iterateController = null;
      setIterateBusy(false);
    }
  };

  iterateBtn.onclick = () => {
    if (isIterating) {
      iterateController?.abort();
      return;
    }
    handleIterate();
  };
  iterateInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !isIterating) handleIterate();
  };

  iterateForm.append(iterateInput, iterateBtn);
  iteratePanel.append(iterateForm);
  return iteratePanel;
}
