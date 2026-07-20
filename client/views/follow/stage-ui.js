export function applyCapabilitiesToStage({ capabilities, slideWrap, interactionWrap } = {}) {
  const caps = capabilities && typeof capabilities === 'object' ? capabilities : null;
  const interacting = !!caps?.interaction;
  // Ensure stage mode is consistent immediately.
  if (interactionWrap) interactionWrap.style.display = interacting ? '' : 'none';
  if (slideWrap) slideWrap.style.display = interacting ? 'none' : '';
  // The stage is sized to a 16:9 slide on a portrait handheld. A poll or
  // feedback card has no such ratio and can be far taller, so the stage has
  // to stop being slide-shaped while one is showing.
  markStageMode(interactionWrap || slideWrap, interacting);
}

/** Flag the stage as showing an interaction rather than a slide. */
function markStageMode(child, interacting) {
  const stage = child?.parentElement;
  if (!stage) return;
  stage.classList.toggle('is-interaction', interacting);
}

export function showFollowMessage({
  h,
  slideWrap,
  interactionWrap,
  cleanupSlideRuntimes,
  msg,
} = {}) {
  cleanupSlideRuntimes?.(slideWrap);
  if (slideWrap) slideWrap.innerHTML = '';
  if (interactionWrap) interactionWrap.style.display = 'none';
  if (slideWrap) slideWrap.style.display = '';
  markStageMode(slideWrap || interactionWrap, false);
  // Render a "muted slide" placeholder so the follow stage keeps the familiar 16:9 look.
  slideWrap?.append(
    h('div', { class: 'slide follow-message-slide' }, [
      h('div', { class: 'slide-inner' }, [
        h('div', { class: 'follow-message-box', text: msg }),
      ]),
    ])
  );
}
