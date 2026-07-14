import { t } from '../../../lib/ui-i18n.js';

export function renderLikertSliderUi({
  h,
  interaction,
  myVote,
  open,
  busy,
  vote,
  clamp0,
  sliderDrag,
} = {}) {
  const min = 1;
  const max = 10;
  const currentVal = myVote != null ? clamp0(myVote) + 1 : 5;
  const minLabel = String(interaction?.minLabel || '').trim();
  const maxLabel = String(interaction?.maxLabel || '').trim();

  const valueText = h('div', {
    class: 'follow-interaction-slider-value',
    text:
      myVote != null
        ? t('follow.likertSlider.yourScore', 'Your score: {n}', { n: currentVal })
        : t('follow.likertSlider.chooseScore', 'Choose a score: {n}', { n: currentVal }),
  });

  const input = h('input', {
    class: 'follow-interaction-slider',
    type: 'range',
    min: String(min),
    max: String(max),
    step: '1',
    value: String(currentVal),
    disabled: !open || busy,
  });

  let pointerUsed = false;
  const submitCurrent = () => {
    const v = Number(input.value ?? NaN);
    if (!Number.isFinite(v)) return;
    vote?.(clamp0(v - 1));
  };

  input.addEventListener('input', () => {
    const v = Number(input.value ?? NaN);
    const shown = Number.isFinite(v) ? v : currentVal;
    valueText.textContent =
      myVote != null
        ? t('follow.likertSlider.yourScore', 'Your score: {n}', { n: shown })
        : t('follow.likertSlider.chooseScore', 'Choose a score: {n}', { n: shown });
  });

  // Mobile quirk: some browsers fire `change` while dragging, which would trigger a re-render
  // and "drop" the thumb. So we submit on pointer/touch release instead.
  input.addEventListener('pointerdown', () => {
    pointerUsed = true;
    sliderDrag?.start?.();
  });
  input.addEventListener('pointerup', () => {
    if (!open || busy) return;
    sliderDrag?.end?.();
    submitCurrent();
  });
  input.addEventListener('pointercancel', () => {
    pointerUsed = false;
    sliderDrag?.cancel?.();
  });
  input.addEventListener('touchstart', () => {
    sliderDrag?.start?.();
  });
  input.addEventListener('touchend', () => {
    if (!open || busy) return;
    pointerUsed = true;
    sliderDrag?.end?.();
    submitCurrent();
  });
  // Keyboard / non-pointer fallback.
  input.addEventListener('change', () => {
    if (pointerUsed) {
      // Pointer/touch already handled submission on release.
      pointerUsed = false;
      return;
    }
    if (!open || busy) return;
    submitCurrent();
  });

  const labels = h('div', { class: 'follow-interaction-slider-labels' }, [
    h('div', { class: 'follow-interaction-slider-label' }, [
      h('span', { class: 'follow-interaction-slider-num', text: '1' }),
      minLabel
        ? h('span', { class: 'follow-interaction-slider-text', text: minLabel })
        : null,
    ]),
    h('div', { class: 'follow-interaction-slider-label is-right' }, [
      h('span', { class: 'follow-interaction-slider-num', text: '10' }),
      maxLabel
        ? h('span', { class: 'follow-interaction-slider-text', text: maxLabel })
        : null,
    ]),
  ]);

  return h('div', { class: 'follow-interaction-slider-wrap' }, [
    valueText,
    input,
    labels,
  ]);
}
