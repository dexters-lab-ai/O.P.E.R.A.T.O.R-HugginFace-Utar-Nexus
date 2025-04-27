// LayoutManager.js
// Modern, modular layout manager for OPERATOR app

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';

export const LAYOUT_PRESETS = {
  DEFAULT: 'default',
  CENTERED: 'centered',
  FOCUS: 'focus',
  EXPANDED: 'expanded',
};

/**
 * LayoutManager factory
 * @param {Object} props
 * @param {string} [props.initialPreset]
 * @param {string} [props.containerId]
 * @param {HTMLElement} [props.container]
 * @param {boolean} [props.startCollapsed]
 * @returns {Object} API
 */
export function LayoutManager({
  initialPreset = LAYOUT_PRESETS.DEFAULT,
  containerId = 'layout-manager',
  container = null,
  startCollapsed = false,
} = {}) {
  // Determine root element
  const element = (() => {
    if (container instanceof HTMLElement) return container;
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      el.className = 'layout-container';
      document.body.appendChild(el);
    }
    return el;
  })();
  if (!(element instanceof HTMLElement)) {
    throw new Error('[LayoutManager] No valid root element.');
  }

  // Internal state
  let activePreset = initialPreset;
  const collapsibleStates = { sidebar: startCollapsed, commandCenter: false, timeline: false };

  // Helper to update sidebar collapse
  function updateSidebarCollapse(collapsed) {
    collapsibleStates.sidebar = collapsed;
    element.classList.toggle('sidebar-collapsed', collapsed);
  }

  // Listen for sidebar toggle events
  eventBus.on('sidebar-toggled', ({ collapsed }) => {
    updateSidebarCollapse(collapsed);
  });

  // Apply layout preset
  function applyPreset(preset) {
    if (!Object.values(LAYOUT_PRESETS).includes(preset)) {
      console.error(`[LayoutManager] Invalid preset: ${preset}`);
      return;
    }
    activePreset = preset;
    Object.values(LAYOUT_PRESETS).forEach(p => element.classList.remove(`layout-preset-${p}`));
    element.classList.add(`layout-preset-${preset}`);

    switch (preset) {
      case LAYOUT_PRESETS.FOCUS:
        updateSidebarCollapse(true);
        break;
      case LAYOUT_PRESETS.EXPANDED:
        updateSidebarCollapse(false);
        break;
      default:
        updateSidebarCollapse(collapsibleStates.sidebar);
    }

    stores.ui.setState({ layoutPreset: preset, taskResultsCollapsed: collapsibleStates.sidebar });
    eventBus.emit('layout-preset-changed', { preset });
  }

  // Toggle functions
  function toggleSidebar() {
    updateSidebarCollapse(!collapsibleStates.sidebar);
    // Persist collapse state
    localStorage.setItem('sidebar_collapsed', collapsibleStates.sidebar);
    stores.ui.setState({ taskResultsCollapsed: collapsibleStates.sidebar });
    eventBus.emit('sidebar-toggled', { collapsed: collapsibleStates.sidebar });
  }

  function toggleCommandCenter() {
    collapsibleStates.commandCenter = !collapsibleStates.commandCenter;
    element.classList.toggle('command-collapsed', collapsibleStates.commandCenter);
    stores.ui.setState({ commandCenterCollapsed: collapsibleStates.commandCenter });
    eventBus.emit('command-center-toggled', { collapsed: collapsibleStates.commandCenter });
  }

  function toggleTimeline() {
    collapsibleStates.timeline = !collapsibleStates.timeline;
    element.classList.toggle('timeline-collapsed', collapsibleStates.timeline);
    stores.ui.setState({ timelineCollapsed: collapsibleStates.timeline });
    eventBus.emit('timeline-toggled', { collapsed: collapsibleStates.timeline });
  }

  function swapCommandAndTimeline() {
    element.classList.toggle('swap-command-timeline');
    const isSwapped = element.classList.contains('swap-command-timeline');
    stores.ui.setState({ commandTimelineSwapped: isSwapped });
    eventBus.emit('command-timeline-swapped', { swapped: isSwapped });
  }

  // Integration API
  function setNavigation(navBar) {
    if (navBar instanceof HTMLElement && !element.contains(navBar)) {
      element.insertBefore(navBar, element.firstChild);
    } else if (!(navBar instanceof HTMLElement)) {
      console.warn('[LayoutManager] setNavigation invalid element:', navBar);
    }
  }

  function setTaskBar(taskBar) {
    if (taskBar instanceof HTMLElement && !element.contains(taskBar)) {
      element.appendChild(taskBar);
    } else if (!(taskBar instanceof HTMLElement)) {
      console.warn('[LayoutManager] setTaskBar invalid element:', taskBar);
    }
  }

  function setSidebar(sidebar) {
    if (sidebar instanceof HTMLElement && !element.contains(sidebar)) {
      const idx = element.children.length > 0 ? 1 : element.children.length;
      element.insertBefore(sidebar, element.children[idx]);
    } else if (!(sidebar instanceof HTMLElement)) {
      console.warn('[LayoutManager] setSidebar invalid element:', sidebar);
    }
  }

  function setContent(contentObj = {}) {
    element.querySelectorAll('.main-content').forEach(el => el.remove());
    Object.values(contentObj).forEach(node => {
      if (node instanceof HTMLElement) {
        node.classList.add('main-content');
        element.appendChild(node);
      }
    });
  }

  // Setup event listeners and cleanup
  function setupEventListeners() {
    const unsubStore = stores.ui.subscribe(state => {
      if (state.layoutPreset && state.layoutPreset !== activePreset) applyPreset(state.layoutPreset);
      if (state.taskResultsCollapsed !== undefined && state.taskResultsCollapsed !== collapsibleStates.sidebar) updateSidebarCollapse(state.taskResultsCollapsed);
      if (state.commandCenterCollapsed !== undefined && state.commandCenterCollapsed !== collapsibleStates.commandCenter) {
        collapsibleStates.commandCenter = state.commandCenterCollapsed;
        element.classList.toggle('command-collapsed', state.commandCenterCollapsed);
      }
      if (state.timelineCollapsed !== undefined && state.timelineCollapsed !== collapsibleStates.timeline) {
        collapsibleStates.timeline = state.timelineCollapsed;
        element.classList.toggle('timeline-collapsed', state.timelineCollapsed);
      }
      if (state.commandTimelineSwapped !== undefined) {
        const isSwapped = element.classList.contains('swap-command-timeline');
        if (state.commandTimelineSwapped !== isSwapped) {
          element.classList.toggle('swap-command-timeline', state.commandTimelineSwapped);
        }
      }
    });

    const unsubEvents = [
      eventBus.on('layout-preset-requested', ({ preset }) => applyPreset(preset)),
      eventBus.on('sidebar-toggle-requested', () => toggleSidebar()),
      eventBus.on('command-center-toggle-requested', () => toggleCommandCenter()),
      eventBus.on('timeline-toggle-requested', () => toggleTimeline()),
      eventBus.on('swap-command-timeline-requested', () => swapCommandAndTimeline()),
    ];

    return () => {
      unsubStore();
      unsubEvents.forEach(unsub => unsub());
    };
  }

  // Initialize
  applyPreset(activePreset);
  stores.ui.setState({ layoutPreset: activePreset });
  const cleanup = setupEventListeners();

  return {
    element,
    setNavigation,
    setTaskBar,
    setSidebar,
    setContent,
    applyPreset,
    toggleSidebar,
    toggleCommandCenter,
    toggleTimeline,
    swapCommandAndTimeline,
    cleanup,
    getCollapsibleStates: () => ({ ...collapsibleStates }),
  };
}

export default LayoutManager;
