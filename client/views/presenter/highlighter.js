/**
 * Presenter highlighter / laser pointer overlay.
 *
 * Modes:
 *   - "laser": Big colored circle follows the cursor with a fading trail
 *   - "draw": Click-drag to draw freehand lines that fade after a few seconds
 *   - null: Disabled (default)
 *
 * Keyboard shortcuts (configured in keys.js):
 *   - L: Toggle laser pointer
 *   - D: Toggle draw mode
 *   - Escape: Disable highlighter (handled in presenter.js)
 */

const DEFAULT_LASER_RADIUS = 12;
const LASER_TRAIL_LENGTH = 12;
const LASER_TRAIL_DECAY = 0.08; // opacity step per trail point
const DEFAULT_DRAW_STROKE_WIDTH = 4;
const DRAW_FADE_DURATION = 3000; // ms before a stroke fully fades

/**
 * @param {Object} opts
 * @param {(ev: object) => void} [opts.onEvent] Emits mirror events in slide-space
 *   (base 1600×900 units) so a second window can replay the laser/drawings.
 *   Left unset for a display-only mirror.
 * @param {boolean} [opts.interactive=true] When false, the overlay is a pure
 *   display surface driven by {@link applyRemoteEvent} — no pointer listeners,
 *   never captures input (the projector window).
 */
export function createPresenterHighlighter({
  stageWrap,
  stage,
  baseW = 1600,
  baseH = 900,
  initialColor = '#ef4444',
  initialThickness = 4,
  initialPersistentDraw = false,
  onEvent = null,
  interactive = true,
} = {}) {
  if (!stageWrap || !stage) {
    return {
      el: null,
      setMode: () => {},
      getMode: () => null,
      setColor: () => {},
      getColor: () => '#ef4444',
      setThickness: () => {},
      getThickness: () => 4,
      setPersistentDraw: () => {},
      getPersistentDraw: () => false,
      clearDrawings: () => {},
      applyRemoteEvent: () => {},
      emitSnapshot: () => {},
      destroy: () => {},
    };
  }

  // State
  let mode = null; // null | 'laser' | 'draw'
  let color = initialColor;
  let thickness = initialThickness;
  let persistentDraw = initialPersistentDraw;
  let pointerX = -1000;
  let pointerY = -1000;
  let trail = []; // { x, y } for laser trail
  let isDrawing = false;
  let currentStroke = []; // { x, y } points for current freehand stroke
  let strokes = []; // { points, startTime, opacity } completed strokes
  let animationId = null;

  // Create canvas overlay
  const canvas = document.createElement('canvas');
  canvas.className = 'presenter-highlighter-canvas';
  canvas.style.cssText = `
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;
  `;
  stageWrap.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  // Resize canvas to match stageWrap dimensions (retina-aware)
  const resizeCanvas = () => {
    const rect = stageWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // Get current scale factor (same logic as stage-scale.js)
  const getScale = () => {
    const w = stageWrap.clientWidth || 1;
    const h = stageWrap.clientHeight || 1;
    return Math.max(0.05, Math.min(w / baseW, h / baseH));
  };

  // Get stage offset within stageWrap (for centering)
  const getStageOffset = () => {
    const w = stageWrap.clientWidth || 1;
    const h = stageWrap.clientHeight || 1;
    const scale = getScale();
    const sw = baseW * scale;
    const sh = baseH * scale;
    return {
      left: Math.max(0, (w - sw) / 2),
      top: Math.max(0, (h - sh) / 2),
    };
  };

  // Convert pointer event coordinates to canvas-local coordinates
  const pointerToCanvas = (e) => {
    const rect = stageWrap.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  // Canvas-px ↔ slide-space (base 1600×900) conversion. Mirror events travel in
  // slide-space so a second window with a different size/scale can replay them.
  const canvasToSlide = (x, y) => {
    const scale = getScale();
    const offset = getStageOffset();
    return { sx: (x - offset.left) / scale, sy: (y - offset.top) / scale };
  };
  const slideToCanvas = (sx, sy) => {
    const scale = getScale();
    const offset = getStageOffset();
    return { x: offset.left + sx * scale, y: offset.top + sy * scale };
  };

  // Check if pointer is within the slide area
  const isWithinSlide = (x, y) => {
    const scale = getScale();
    const offset = getStageOffset();
    const slideW = baseW * scale;
    const slideH = baseH * scale;
    return (
      x >= offset.left &&
      x <= offset.left + slideW &&
      y >= offset.top &&
      y <= offset.top + slideH
    );
  };

  // Draw a single frame
  const draw = () => {
    const rect = stageWrap.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (!mode) return;

    const scale = getScale();

    // Draw strokes (fading or persistent based on mode)
    const now = Date.now();
    if (persistentDraw) {
      // In persistent mode, strokes stay at full opacity
      for (const stroke of strokes) {
        stroke.opacity = 1;
      }
    } else {
      // In normal mode, strokes fade out over time
      strokes = strokes.filter((stroke) => {
        const elapsed = now - stroke.startTime;
        if (elapsed > DRAW_FADE_DURATION) return false;
        stroke.opacity = 1 - elapsed / DRAW_FADE_DURATION;
        return true;
      });
    }

    // Calculate sizes based on thickness setting
    const strokeWidth = thickness * scale;
    const laserRadius = (DEFAULT_LASER_RADIUS + (thickness - DEFAULT_DRAW_STROKE_WIDTH) * 1.5) * scale;

    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = hexToRgba(color, stroke.opacity);
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }

    // Draw current stroke (while drawing)
    if (isDrawing && currentStroke.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(currentStroke[0].x, currentStroke[0].y);
      for (let i = 1; i < currentStroke.length; i++) {
        ctx.lineTo(currentStroke[i].x, currentStroke[i].y);
      }
      ctx.stroke();
    }

    // Draw laser pointer and trail
    if (mode === 'laser' && isWithinSlide(pointerX, pointerY)) {
      // Trail (fading circles)
      for (let i = 0; i < trail.length; i++) {
        const opacity = (trail.length - i) * LASER_TRAIL_DECAY;
        const radius = laserRadius * (0.5 + 0.5 * (i / trail.length));
        ctx.beginPath();
        ctx.arc(trail[i].x, trail[i].y, radius, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(color, Math.min(0.6, opacity));
        ctx.fill();
      }

      // Main pointer circle
      ctx.beginPath();
      ctx.arc(pointerX, pointerY, laserRadius, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(color, 0.85);
      ctx.fill();

      // Inner bright spot
      ctx.beginPath();
      ctx.arc(pointerX, pointerY, laserRadius * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba('#ffffff', 0.9);
      ctx.fill();
    }
  };

  // Mirror emit: coalesce laser position to one event per animation frame (and
  // a single 'leave' when the pointer exits the slide) so we don't flood the
  // channel with raw pointermove events.
  const lastEmit = { x: NaN, y: NaN, active: false };
  const maybeEmitLaser = () => {
    if (!onEvent || mode !== 'laser') return;
    if (isWithinSlide(pointerX, pointerY)) {
      if (pointerX !== lastEmit.x || pointerY !== lastEmit.y) {
        lastEmit.x = pointerX;
        lastEmit.y = pointerY;
        lastEmit.active = true;
        const s = canvasToSlide(pointerX, pointerY);
        onEvent({ t: 'laser', sx: s.sx, sy: s.sy });
      }
    } else if (lastEmit.active) {
      lastEmit.active = false;
      onEvent({ t: 'leave' });
    }
  };

  const emitMode = () => {
    onEvent?.({
      t: 'mode',
      mode,
      color,
      thickness,
      persistent: persistentDraw,
    });
  };

  // Animation loop
  const animate = () => {
    maybeEmitLaser();
    draw();
    animationId = requestAnimationFrame(animate);
  };

  // Event handlers
  const onPointerMove = (e) => {
    if (!mode) return;
    const pos = pointerToCanvas(e);
    pointerX = pos.x;
    pointerY = pos.y;

    // Update trail for laser mode
    if (mode === 'laser') {
      trail.unshift({ x: pos.x, y: pos.y });
      if (trail.length > LASER_TRAIL_LENGTH) {
        trail.pop();
      }
    }

    // Add point to current stroke for draw mode
    if (mode === 'draw' && isDrawing && isWithinSlide(pos.x, pos.y)) {
      currentStroke.push({ x: pos.x, y: pos.y });
      if (onEvent) {
        const s = canvasToSlide(pos.x, pos.y);
        onEvent({ t: 'move', sx: s.sx, sy: s.sy });
      }
    }
  };

  const onPointerDown = (e) => {
    if (mode !== 'draw') return;
    const pos = pointerToCanvas(e);
    if (!isWithinSlide(pos.x, pos.y)) return;
    isDrawing = true;
    currentStroke = [{ x: pos.x, y: pos.y }];
    if (onEvent) {
      const s = canvasToSlide(pos.x, pos.y);
      onEvent({ t: 'down', sx: s.sx, sy: s.sy });
    }
  };

  const onPointerUp = () => {
    if (mode !== 'draw' || !isDrawing) return;
    isDrawing = false;
    if (currentStroke.length >= 2) {
      strokes.push({
        points: [...currentStroke],
        startTime: Date.now(),
        opacity: 1,
      });
    }
    currentStroke = [];
    onEvent?.({ t: 'up' });
  };

  const onPointerLeave = () => {
    pointerX = -1000;
    pointerY = -1000;
    trail = [];
    if (isDrawing) {
      onPointerUp();
    }
  };

  // Hex color to rgba
  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Enable/disable pointer events based on mode
  const updatePointerEvents = () => {
    // A display-only mirror never captures input.
    if (!interactive) {
      canvas.style.pointerEvents = 'none';
      canvas.style.cursor = 'default';
      return;
    }
    if (mode === 'draw') {
      canvas.style.pointerEvents = 'auto';
      canvas.style.cursor = 'crosshair';
    } else if (mode === 'laser') {
      canvas.style.pointerEvents = 'auto';
      canvas.style.cursor = 'none';
    } else {
      canvas.style.pointerEvents = 'none';
      canvas.style.cursor = 'default';
    }
  };

  // Public API
  const setMode = (newMode) => {
    const validModes = [null, 'laser', 'draw'];
    if (!validModes.includes(newMode)) return;
    mode = newMode;
    trail = [];
    currentStroke = [];
    isDrawing = false;
    // Clear strokes when switching modes
    if (newMode === null) {
      strokes = [];
    }
    updatePointerEvents();
    // Update stageWrap data attribute for CSS hooks
    if (mode) {
      stageWrap.dataset.highlighterMode = mode;
    } else {
      delete stageWrap.dataset.highlighterMode;
    }
    emitMode();
  };

  const getMode = () => mode;

  const setColor = (newColor) => {
    if (typeof newColor === 'string' && newColor.startsWith('#')) {
      color = newColor;
      onEvent?.({ t: 'color', color });
    }
  };

  const getColor = () => color;

  const setThickness = (newThickness) => {
    const n = parseInt(newThickness, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 10) {
      thickness = n;
      onEvent?.({ t: 'thickness', thickness });
    }
  };

  const getThickness = () => thickness;

  const setPersistentDraw = (value) => {
    persistentDraw = !!value;
    onEvent?.({ t: 'persistent', value: persistentDraw });
  };

  const getPersistentDraw = () => persistentDraw;

  const clearDrawings = () => {
    strokes = [];
    currentStroke = [];
    isDrawing = false;
    onEvent?.({ t: 'clear' });
  };

  // Re-emit the current overlay state (mode/color/thickness/persistent) so a
  // projector that connects mid-presentation can catch up.
  const emitSnapshot = () => emitMode();

  // Replay a mirror event from the master window (display-only projector).
  // Coordinates arrive in slide-space and convert to this window's canvas px.
  const applyRemoteEvent = (ev) => {
    if (!ev || typeof ev !== 'object') return;
    switch (ev.t) {
      case 'mode':
        if (ev.color) setColor(ev.color);
        if (ev.thickness) setThickness(ev.thickness);
        if (typeof ev.persistent === 'boolean') setPersistentDraw(ev.persistent);
        setMode(ev.mode || null);
        break;
      case 'color':
        setColor(ev.color);
        break;
      case 'thickness':
        setThickness(ev.thickness);
        break;
      case 'persistent':
        setPersistentDraw(ev.value);
        break;
      case 'clear':
        clearDrawings();
        break;
      case 'laser': {
        const p = slideToCanvas(ev.sx, ev.sy);
        pointerX = p.x;
        pointerY = p.y;
        trail.unshift({ x: p.x, y: p.y });
        if (trail.length > LASER_TRAIL_LENGTH) trail.pop();
        break;
      }
      case 'leave':
        pointerX = -1000;
        pointerY = -1000;
        trail = [];
        if (isDrawing) {
          isDrawing = false;
          currentStroke = [];
        }
        break;
      case 'down': {
        const p = slideToCanvas(ev.sx, ev.sy);
        isDrawing = true;
        currentStroke = [{ x: p.x, y: p.y }];
        break;
      }
      case 'move': {
        if (!isDrawing) break;
        const p = slideToCanvas(ev.sx, ev.sy);
        currentStroke.push({ x: p.x, y: p.y });
        break;
      }
      case 'up':
        if (!isDrawing) break;
        isDrawing = false;
        if (currentStroke.length >= 2) {
          strokes.push({
            points: [...currentStroke],
            startTime: Date.now(),
            opacity: 1,
          });
        }
        currentStroke = [];
        break;
      default:
        break;
    }
  };

  const destroy = () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    stageWrap.removeEventListener('pointermove', onPointerMove);
    stageWrap.removeEventListener('pointerdown', onPointerDown);
    stageWrap.removeEventListener('pointerup', onPointerUp);
    stageWrap.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', resizeCanvas);
    if (ro) {
      ro.disconnect();
      ro = null;
    }
    canvas.remove();
  };

  // Initialize
  resizeCanvas();
  updatePointerEvents();

  // Resize observer for canvas
  let ro = null;
  try {
    ro = new ResizeObserver(resizeCanvas);
    ro.observe(stageWrap);
  } catch {
    window.addEventListener('resize', resizeCanvas, { passive: true });
  }

  // Attach input listeners only when interactive (the master window). The
  // projector overlay is driven purely by applyRemoteEvent.
  if (interactive) {
    stageWrap.addEventListener('pointermove', onPointerMove, { passive: true });
    stageWrap.addEventListener('pointerdown', onPointerDown);
    stageWrap.addEventListener('pointerup', onPointerUp);
    stageWrap.addEventListener('pointerleave', onPointerLeave);
  }

  // Start animation loop
  animate();

  return {
    el: canvas,
    setMode,
    getMode,
    setColor,
    getColor,
    setThickness,
    getThickness,
    setPersistentDraw,
    getPersistentDraw,
    clearDrawings,
    applyRemoteEvent,
    emitSnapshot,
    destroy,
  };
}
