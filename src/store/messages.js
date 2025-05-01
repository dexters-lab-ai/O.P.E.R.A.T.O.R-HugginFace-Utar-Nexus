/**
 * Messages Store
 * Manages the message timeline and related state
 */

import { createStore } from './index.js';

// Message types
const MESSAGE_TYPES = {
  CHAT: 'chat',
  COMMAND: 'command',
  SYSTEM: 'system',
  ERROR: 'error',
  THOUGHT: 'thought'
};

// Create store with initial state
const messagesStore = createStore({
  timeline: [],
  filter: 'all',
  loading: false,
  error: null,
  pagination: {
    page: 1,
    limit: 30,
    totalItems: 0,
    totalPages: 0
  }
});

// Helper functions for message operations
messagesStore.addMessage = function(message) {
  if (!message || !message.id) {
    throw new Error('Message must have an ID');
  }

  const state = messagesStore.getState();
  
  // Keep only last 100 messages
  const newTimeline = [...state.timeline.slice(-99), message];
  
  messagesStore.setState({
    timeline: newTimeline
  });
};

messagesStore.updateMessage = function(id, updates) {
  const state = messagesStore.getState();
  const message = state.timeline.find(msg => msg.id === id);
  
  if (!message) {
    console.warn(`Message with ID ${id} not found`);
    return;
  }

  const updatedMessage = { ...message, ...updates };
  const newTimeline = state.timeline.map(msg => 
    msg.id === id ? updatedMessage : msg
  );

  messagesStore.setState({
    timeline: newTimeline
  });
};

// Removed loadMore functionality since we're not using pagination anymore

// For backward compatibility with existing imports
window.messagesStore = messagesStore;
window.MESSAGE_TYPES = MESSAGE_TYPES;

messagesStore.cleanup = function() {
  const state = messagesStore.getState();
  const now = Date.now();
  const cutoff = now - (7 * 24 * 60 * 60 * 1000); // 7 days ago

  const newTimeline = state.timeline.filter(msg => 
    msg.timestamp > cutoff
  );

  messagesStore.setState({ 
    timeline: newTimeline
  });
};

messagesStore.createMessage = function(props) {
  if (!props || !props.role || !props.content) {
    throw new Error('Message must have role and content');
  }

  const { role, content, type = 'chat', id = `msg-${Date.now()}` } = props;
  return {
    id,
    role,
    type,
    content,
    timestamp: Date.now(),
    error: null,
    metadata: {}
  };
};

// Export the store and types
export { messagesStore, MESSAGE_TYPES };

// Export the combined object as default
export default {
  ...messagesStore,
  MESSAGE_TYPES
};
