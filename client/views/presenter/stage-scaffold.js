export function createPresenterStageScaffold({ h, pres } = {}) {
  const deck = h('div', {
    id: 'deck',
    class: 'deck',
    'aria-live': 'polite',
  });
  const stageWrap = h('div', { class: 'deck-stage' });

  // Presenter-only slide-to-slide transitions (deck-level setting).
  // Keep defaults conservative: no motion unless the deck explicitly opts in.
  try {
    const presetRaw = String(pres?.settings?.transitions?.preset || '').trim();
    const allowed = new Set(['none', 'fade', 'slide', 'push', 'morph', 'cube']);
    const preset = allowed.has(presetRaw) ? presetRaw : 'none';
    stageWrap.dataset.slideTransition = preset;
  } catch {
    stageWrap.dataset.slideTransition = 'none';
  }

  // Step mode: when enabled, step-able content starts hidden via CSS.
  // This prevents a flash when transition is 'none' (content visible before JS hides it).
  try {
    if (pres?.settings?.stepParagraphs) {
      stageWrap.dataset.stepMode = 'on';
    }
  } catch {
    // ignore
  }

  // Slides are designed at a fixed px layout (1600×900). In non-fullscreen mode
  // the available stage area can be smaller, so we scale the whole stage to fit
  // (like embeds/exports) instead of cropping slide content.
  const stage = h('div', { class: 'deck-stage-inner' });
  stageWrap.append(stage);

  // Remaining-build indicator: small dots in the corner of the slide area that
  // tell the presenter how many step-reveals are still hidden on this slide.
  // Persistently visible (independent of the auto-hiding chrome) but subtle;
  // fades out once everything is revealed, so "no dots" means "safe to advance".
  const stepIndicator = h('div', {
    class: 'presenter-step-indicator',
    'aria-hidden': 'true',
  });
  stageWrap.append(stepIndicator);

  const progress = h('div', { class: 'presenter-progress' });
  const progressText = h('div', { class: 'presenter-progress-text' });
  const progressBar = h('div', { class: 'presenter-progress-bar' });
  const progressFill = h('div', { class: 'presenter-progress-fill' });
  progressBar.append(progressFill);
  progress.append(progressText, progressBar);

  const edgeHint = h('div', {
    class: 'presenter-edge-hint',
    text: '',
  });

  deck.append(stageWrap, edgeHint);

  return {
    deck,
    stageWrap,
    stage,
    stepIndicator,
    progress,
    progressText,
    progressFill,
    edgeHint,
  };
}
