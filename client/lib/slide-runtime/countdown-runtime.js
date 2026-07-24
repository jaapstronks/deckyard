/**
 * Client runtime for countdown-slide.
 *
 * Drives the presenter-controlled countdown timer rendered by
 * `shared/slide-types/types/countdown-slide.js`. The slide markup is static and
 * server-safe; all timing, controls and the zero-state lives here.
 *
 * Behaviour:
 *  - interactive (present / follow): Start / Pause / Reset controls are shown.
 *    The timer does NOT run on open unless `data-countdown-autostart="1"`.
 *  - non-interactive (thumb): controls hidden, timer never runs, shows the
 *    configured start time as a static preview.
 *
 * Timing is wall-clock based (a fixed end timestamp while running), so a slow
 * tick or a backgrounded tab can't make the countdown drift.
 */

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (Number.isFinite(v)) return Math.max(min, Math.min(max, Math.round(v)));
  return fallback;
}

function formatMmSs(totalSeconds) {
  const t = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Short two-tone beep using the Web Audio API. No external asset needed.
 * Only ever called from within a user gesture (presenter starting the timer),
 * so it satisfies browser autoplay policies.
 */
function playBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const beepAt = (start, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    };
    beepAt(now, 880);
    beepAt(now + 0.45, 1175);
    // Close the context shortly after the sound finishes.
    setTimeout(() => {
      try {
        ctx.close();
      } catch {
        // ignore
      }
    }, 1200);
  } catch {
    // ignore — sound is best-effort
  }
}

function initOne(slideEl, { interactive }) {
  if (!slideEl || slideEl.dataset.cdInit === '1') return () => {};
  slideEl.dataset.cdInit = '1';

  const display = slideEl.querySelector('[data-countdown-display="1"]');
  if (!display) return () => {};

  const controls = slideEl.querySelector('[data-countdown-controls="1"]');
  const btnStart = slideEl.querySelector('[data-countdown-action="start"]');
  const btnPause = slideEl.querySelector('[data-countdown-action="pause"]');
  const btnReset = slideEl.querySelector('[data-countdown-action="reset"]');

  const totalSeconds = clampInt(
    slideEl.dataset.countdownSeconds,
    1,
    60 * 60,
    300
  );
  const sound = slideEl.dataset.countdownSound === '1';
  const autoStart = slideEl.dataset.countdownAutostart === '1';

  // State: `remaining` holds the paused/initial value; while running we track
  // a fixed `endAt` wall-clock timestamp and derive remaining from it.
  let remaining = totalSeconds;
  let endAt = 0;
  let running = false;
  let reachedZero = false;
  let rafId = 0;
  let intervalId = 0;

  const setDisplay = (secs) => {
    display.textContent = formatMmSs(secs);
  };

  const updateButtons = () => {
    if (!interactive || !controls) return;
    if (btnStart) btnStart.hidden = running;
    if (btnPause) btnPause.hidden = !running;
  };

  const onZero = () => {
    if (reachedZero) return;
    reachedZero = true;
    slideEl.classList.add('is-zero');
    display.setAttribute('aria-live', 'assertive');
    if (sound) playBeep();
  };

  const stopTicking = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = 0;
    }
  };

  const tick = () => {
    if (!running) return;
    const left = (endAt - Date.now()) / 1000;
    if (left <= 0) {
      remaining = 0;
      running = false;
      stopTicking();
      setDisplay(0);
      updateButtons();
      onZero();
      return;
    }
    setDisplay(left);
  };

  const startTicking = () => {
    stopTicking();
    // Update the digits on whole-second boundaries; rAF would over-render.
    intervalId = setInterval(tick, 250);
    tick();
  };

  const start = () => {
    if (running) return;
    if (remaining <= 0) return; // need a reset first
    running = true;
    reachedZero = false;
    slideEl.classList.remove('is-zero');
    endAt = Date.now() + remaining * 1000;
    updateButtons();
    startTicking();
  };

  const pause = () => {
    if (!running) return;
    remaining = Math.max(0, (endAt - Date.now()) / 1000);
    running = false;
    stopTicking();
    setDisplay(remaining);
    updateButtons();
  };

  const reset = () => {
    running = false;
    reachedZero = false;
    stopTicking();
    remaining = totalSeconds;
    slideEl.classList.remove('is-zero');
    display.setAttribute('aria-live', 'off');
    setDisplay(remaining);
    updateButtons();
  };

  // Initial paint.
  setDisplay(remaining);

  if (!interactive) {
    // Thumbnail / static: show the start time, no controls, never run.
    if (controls) controls.hidden = true;
    return () => {
      stopTicking();
    };
  }

  if (controls) controls.hidden = false;
  updateButtons();

  const onStartClick = () => {
    start();
    // Drop focus so the presenter's space/arrow keys keep advancing slides.
    if (btnStart) btnStart.blur();
  };
  const onPauseClick = () => {
    pause();
    if (btnPause) btnPause.blur();
  };
  const onResetClick = () => {
    reset();
    if (btnReset) btnReset.blur();
  };

  btnStart?.addEventListener('click', onStartClick);
  btnPause?.addEventListener('click', onPauseClick);
  btnReset?.addEventListener('click', onResetClick);

  if (autoStart) start();

  return () => {
    stopTicking();
    btnStart?.removeEventListener('click', onStartClick);
    btnPause?.removeEventListener('click', onPauseClick);
    btnReset?.removeEventListener('click', onResetClick);
  };
}

/**
 * Initialize all countdown slides under `rootEl`.
 * @param {Element} rootEl - slide element or a container of slides.
 * @param {{ interactive?: boolean }} [opts]
 * @returns {() => void} cleanup function.
 */
export function initCountdownSlides(rootEl, { interactive = true } = {}) {
  if (!rootEl?.querySelectorAll) return () => {};

  const slides = [];
  try {
    if (rootEl.matches?.('.slide-countdown')) slides.push(rootEl);
  } catch {
    // ignore
  }
  slides.push(...Array.from(rootEl.querySelectorAll('.slide-countdown')));

  const cleanups = slides.map((el) => initOne(el, { interactive }));

  return () => {
    for (const fn of cleanups) {
      try {
        fn?.();
      } catch {
        // ignore
      }
    }
  };
}
