/**
 * Pane host for the inspector rail.
 *
 * The inspector is one right-hand rail with swappable panes: settings today,
 * comments in phase 4 of the editor-UI track. Exactly one pane is active at a
 * time; toggling the active pane's trigger dismisses the rail entirely (the
 * canvas gets the space via the is-inspector-collapsed machinery).
 *
 * Lock/read-only gating is NOT this module's job: panes render inside the
 * editor shell, and every editing surface must consume the state-driven
 * getSlideLockKind seam itself (see editor-controller.js).
 *
 * @param {Object} options
 * @param {HTMLElement} options.panelEl - The .inspector-panel element
 * @param {Function} options.setCollapsed - (collapsed: boolean) => void
 * @param {Function} options.isCollapsed - () => boolean
 * @param {Function} [options.onActivePaneChange] - (name: string) => void
 * @returns {{ registerPane: Function, setActivePane: Function, getActivePane: Function, toggle: Function, open: Function }}
 */
export function createInspectorPanes({
  panelEl,
  setCollapsed,
  isCollapsed,
  onActivePaneChange,
} = {}) {
  const panes = new Map();
  let activeName = null;

  /**
   * Register a pane under a name. The element becomes a direct child of the
   * panel; the first registered pane becomes active.
   * @param {string} name
   * @param {HTMLElement} el
   */
  const registerPane = (name, el) => {
    el.classList.add('inspector-pane');
    el.dataset.pane = name;
    panes.set(name, el);
    panelEl.append(el);
    if (!activeName) setActivePane(name);
  };

  /**
   * Make the named pane the visible one (no-op for unknown names).
   * @param {string} name
   */
  const setActivePane = (name) => {
    if (!panes.has(name)) return;
    activeName = name;
    for (const [paneName, el] of panes) {
      el.classList.toggle('is-active', paneName === name);
    }
    onActivePaneChange?.(name);
  };

  const getActivePane = () => activeName;

  /**
   * Open the rail with the named pane active.
   * @param {string} name
   */
  const open = (name) => {
    setActivePane(name);
    setCollapsed?.(false);
  };

  /**
   * Toolbar-toggle semantics: if the rail is open on this pane, dismiss it;
   * otherwise open it with this pane active (also switches panes when the
   * rail is open on another pane).
   * @param {string} name
   */
  const toggle = (name) => {
    if (!isCollapsed?.() && activeName === name) {
      setCollapsed?.(true);
      return;
    }
    open(name);
  };

  return { registerPane, setActivePane, getActivePane, toggle, open };
}
