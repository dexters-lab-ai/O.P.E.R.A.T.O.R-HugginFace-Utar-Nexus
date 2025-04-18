/**
 * Bridge Module
 * Acts as a mediator between legacy code and modern components
 * Facilitates gradual migration to the new architecture
 */

import { eventBus } from './events.js';
import { stores } from '../store/index.js';

/**
 * Bridge legacy DOM events to the modern event system
 * This allows the modern components to react to events fired by legacy code
 */
export function bridgeLegacyEvents() {
  // Bridge legacy message submission to modern store
  document.addEventListener('message-submitted', (event) => {
    const { message, role, type } = event.detail || {};
    
    // Update the modern messages store
    const { timeline } = stores.messages.getState();
    stores.messages.setState({ 
      timeline: [...timeline, {
        role: role || 'user',
        type: type || 'chat',
        content: message,
        timestamp: new Date()
      }]
    });
    
    // Also emit an event for components to react to
    eventBus.emit('new-message', {
      role: role || 'user',
      type: type || 'chat',
      content: message,
      timestamp: new Date()
    });
  });
  
  // Bridge legacy task creation/updates
  document.addEventListener('task-created', (event) => {
    const { task } = event.detail || {};
    
    if (task) {
      const { tasks } = stores.tasks.getState();
      stores.tasks.setState({
        tasks: [...tasks, task]
      });
      
      // Emit event for task components
      eventBus.emit('task-added', task);
    }
  });
  
  document.addEventListener('task-updated', (event) => {
    const { taskId, status, progress } = event.detail || {};
    
    if (taskId) {
      const { tasks } = stores.tasks.getState();
      const updatedTasks = tasks.map(task => 
        task._id === taskId 
          ? { ...task, status, progress, lastUpdated: new Date() }
          : task
      );
      
      stores.tasks.setState({ tasks: updatedTasks });
      
      // Emit event for task components
      eventBus.emit('task-updated', { taskId, status, progress });
    }
  });
  
  // Bridge UI state changes
  document.addEventListener('theme-changed', (event) => {
    const { theme } = event.detail || {};
    
    if (theme) {
      stores.ui.setState({ theme });
    }
  });
  
  // Legacy history interactions
  document.addEventListener('history-toggled', (event) => {
    const { visible } = event.detail || {};
    
    stores.ui.setState({ historyOverlayVisible: visible });
    eventBus.emit('history-visibility-changed', { visible });
  });
}

/**
 * Bridge modern events to legacy code
 * This allows legacy code to react to events fired by modern components
 */
export function bridgeModernEvents() {
  // When new messages are added in modern components
  eventBus.on('modern-message-sent', (message) => {
    // Create a custom event for legacy code to listen to
    const event = new CustomEvent('modern-message-submitted', {
      detail: message,
      bubbles: true
    });
    
    document.dispatchEvent(event);
  });
  
  // When modern task state changes
  eventBus.on('modern-task-created', (task) => {
    const event = new CustomEvent('modern-task-created', {
      detail: { task },
      bubbles: true
    });
    
    document.dispatchEvent(event);
  });
  
  // When modern theme changes
  stores.ui.subscribe((state, prevState) => {
    if (state.theme !== prevState.theme) {
      const event = new CustomEvent('modern-theme-changed', {
        detail: { theme: state.theme },
        bubbles: true
      });
      
      document.dispatchEvent(event);
      
      // Also directly update the document theme attribute
      document.documentElement.setAttribute('data-theme', state.theme);
    }
  });
}

/**
 * Expose modern state and actions to legacy code
 * This allows legacy code to access and update modern state
 */
export function exposeModernAPI() {
  // Create a global namespace for modern API
  window.__OPERATOR_MODERN__ = {
    // Get current state from stores
    getState: () => ({
      ui: stores.ui.getState(),
      messages: stores.messages.getState(),
      tasks: stores.tasks.getState(),
      history: stores.history.getState()
    }),
    
    // Dispatch actions to the event bus
    dispatch: (action, payload) => {
      eventBus.emit(action, payload);
    },
    
    // Direct store updates
    updateMessages: (update) => {
      stores.messages.setState(update);
    },
    
    updateTasks: (update) => {
      stores.tasks.setState(update);
    },
    
    updateUI: (update) => {
      stores.ui.setState(update);
    },
    
    // Add message to timeline
    addMessage: (message) => {
      const { timeline } = stores.messages.getState();
      stores.messages.setState({
        timeline: [...timeline, {
          ...message,
          timestamp: message.timestamp || new Date()
        }]
      });
      
      eventBus.emit('new-message', message);
    },
    
    // Toggle layout presets
    setLayoutPreset: (preset) => {
      stores.ui.setState({ layoutPreset: preset });
      eventBus.emit('layout-preset-changed', { preset });
    }
  };
}

/**
 * Initialize all bridge functionality
 */
export function initializeBridge() {
  bridgeLegacyEvents();
  bridgeModernEvents();
  exposeModernAPI();
  
  console.log('Bridge initialized: Legacy and modern code can now communicate');
}

export default {
  initialize: initializeBridge,
  bridgeLegacyEvents,
  bridgeModernEvents,
  exposeModernAPI
};
