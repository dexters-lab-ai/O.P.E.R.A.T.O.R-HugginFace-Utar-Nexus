/**
 * OPERATOR Store
 * Centralized state management using a simple publish/subscribe pattern
 * This will later be replaced with a more robust solution (like Zustand or Pinia)
 */

/**
 * Create a simple reactive store
 * @param {Object} initialState - Initial state object
 * @returns {Object} Store methods and state
 */
export function createStore(initialState = {}) {
  // Internal state
  let state = { ...initialState };
  const listeners = new Set();

  /**
   * Get current state (immutable)
   * @returns {Object} Shallow copy of current state
   */
  const getState = () => ({ ...state });

  /**
   * Update state and notify subscribers
   * @param {Object|Function} updater - New state object or updater function
   */
  const setState = (updater) => {
    const newState = typeof updater === 'function' 
      ? updater(state)
      : updater;
    
    state = { ...state, ...newState };
    notifyListeners();
  };

  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback for state updates
   * @returns {Function} Unsubscribe function
   */
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  /**
   * Notify all listeners of state change
   */
  const notifyListeners = () => {
    listeners.forEach(listener => listener(state));
  };

  return {
    getState,
    setState,
    subscribe
  };
}

// Create application stores

/**
 * UI State Store
 * Manages UI-related state like active tabs, overlays, modals
 */
export const uiStore = createStore({
  activeTab: 'nli',
  activeSubtab: 'active',
  overlays: {
    history: false,
    settings: false
  },
  modals: {
    historyDetails: {
      visible: false,
      taskId: null
    }
  },
  theme: 'dark'
});

/**
 * Tasks Store
 * Manages active tasks state
 */
export const tasksStore = createStore({
  active: [],
  scheduled: [],
  repetitive: [],
  loading: false,
  error: null,
  streams: {},
  intermediateResults: {}
});

// Task store helper methods
tasksStore.setActiveTasks = tasks => tasksStore.setState({ active: tasks });
tasksStore.updateTask = (taskId, patch) => tasksStore.setState(state => ({
  active: state.active.map(task => task._id === taskId ? { ...task, ...patch } : task)
}));
tasksStore.removeTask = taskId => tasksStore.setState(state => ({
  active: state.active.filter(task => task._id !== taskId)
}));
tasksStore.addStream = (taskId, es) => tasksStore.setState(state => ({
  streams: { ...state.streams, [taskId]: es }
}));
tasksStore.closeStream = taskId => {
  const es = tasksStore.getState().streams[taskId];
  if (es) es.close();
  tasksStore.setState(state => {
    const streams = { ...state.streams };
    delete streams[taskId];
    return { streams };
  });
};
// Add helper for intermediate results
tasksStore.addIntermediate = (taskId, item) => tasksStore.setState(state => ({
  intermediateResults: {
    ...state.intermediateResults,
    [taskId]: [...(state.intermediateResults[taskId] || []), item]
  }
}));

/**
 * History Store
 * Manages task history state
 */
export const historyStore = createStore({
  items: [],
  selectedItem: null,
  loading: false,
  error: null,
  pagination: {
    page: 1,
    limit: 20,
    totalItems: 0,
    totalPages: 0
  }
});

// Re-export messagesStore for legacy components
export { messagesStore } from './messages.js';

// Export all stores as a single object
export const stores = {
  ui: uiStore,
  tasks: tasksStore,
  history: historyStore
};

export default stores;
