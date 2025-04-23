/**
 * Message Timeline Component
 * Displays a unified timeline of chat messages and command results
 */

import { eventBus, addEvent } from '../utils/events.js';
import { messagesStore } from '../store/index.js';
import { getMessageHistory } from '../api/messages.js';

// Message type constants
export const MESSAGE_TYPES = {
  CHAT: 'chat',
  COMMAND: 'command',
  SYSTEM: 'system',
  ERROR: 'error'
};

// Message role constants
export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
};

/**
 * Create a message timeline component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Timeline container element
 */
export function MessageTimeline(props = {}) {
  const {
    containerId = 'message-timeline',
    initialFilter = 'all'
  } = props;

  // Create component container
  const container = document.createElement('div');
  container.id = containerId;
  container.className = 'message-timeline';

  // Create filter toolbar
  const filterToolbar = document.createElement('div');
  filterToolbar.className = 'timeline-filters';
  
  // Filter buttons
  const filterButtons = [
    { text: 'All', value: 'all' },
    { text: 'Chat', value: 'chat' },
    { text: 'Command', value: 'command' }
  ];
  
  // Current active filter
  let activeFilter = initialFilter;
  
  // Add filter buttons
  filterButtons.forEach(filter => {
    const button = document.createElement('button');
    button.className = `timeline-filter-btn ${filter.value === activeFilter ? 'active' : ''}`;
    button.textContent = filter.text;
    button.dataset.filter = filter.value;
    
    button.addEventListener('click', () => {
      // Update active filter
      activeFilter = filter.value;
      
      // Update UI
      filterToolbar.querySelectorAll('.timeline-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === activeFilter);
      });
      
      // Update store
      messagesStore.setState({ filter: activeFilter });
      
      // Update visible messages
      updateVisibleMessages();
    });
    
    filterToolbar.appendChild(button);
  });
  
  container.appendChild(filterToolbar);

  // Create messages container
  const messagesContainer = document.createElement('div');
  messagesContainer.className = 'message-timeline-container';
  container.appendChild(messagesContainer);

  // Function to create a single message item
  function createMessageItem(message) {
    const { role, type, content, timestamp } = message;
    
    // Create message element
    const msgEl = document.createElement('div');
    msgEl.className = `msg-item msg-${role}`;
    if (type) msgEl.classList.add(`msg-${type}`);
    
    // Message metadata
    const metaEl = document.createElement('div');
    metaEl.className = 'msg-meta';
    
    // Role badge
    const roleEl = document.createElement('div');
    roleEl.className = 'msg-role';
    
    // Set icon based on role
    let roleIcon = '';
    switch (role) {
      case MESSAGE_ROLES.USER:
        roleIcon = 'fa-user';
        break;
      case MESSAGE_ROLES.ASSISTANT:
        roleIcon = 'fa-robot';
        break;
      case MESSAGE_ROLES.SYSTEM:
        roleIcon = 'fa-cog';
        break;
      default:
        roleIcon = 'fa-comment';
    }
    
    roleEl.innerHTML = `<i class="fas ${roleIcon}"></i>`;
    metaEl.appendChild(roleEl);
    
    // Type badge if not default
    if (type && type !== MESSAGE_TYPES.CHAT) {
      const typeEl = document.createElement('div');
      typeEl.className = `msg-type msg-${type}`;
      typeEl.textContent = type;
      metaEl.appendChild(typeEl);
    }
    
    // Timestamp
    const timeEl = document.createElement('div');
    timeEl.className = 'msg-time';
    
    // Format timestamp
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    timeEl.textContent = timeStr;
    
    metaEl.appendChild(timeEl);
    msgEl.appendChild(metaEl);
    
    // Message content
    const contentEl = document.createElement('div');
    contentEl.className = 'msg-content';
    contentEl.textContent = content;
    msgEl.appendChild(contentEl);
    
    // Check if message has error
    if (message.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'msg-error';
      errorEl.textContent = message.error;
      msgEl.appendChild(errorEl);
    }
    
    return msgEl;
  }

  // Function to update visible messages based on filter
  function updateVisibleMessages() {
    // Get messages from store
    const { timeline, filter } = messagesStore.getState();
    
    // Clear current messages
    messagesContainer.innerHTML = '';
    
    // Check if empty
    if (!timeline.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'message-timeline-empty';
      emptyEl.innerHTML = '<i class="fas fa-comments"></i><p>No messages yet</p>';
      messagesContainer.appendChild(emptyEl);
      return;
    }
    
    // Filter messages if needed
    const filteredMessages = filter === 'all' 
      ? timeline 
      : timeline.filter(msg => msg.type === filter);
    
    // Render messages
    filteredMessages.forEach(message => {
      const msgEl = createMessageItem(message);
      messagesContainer.appendChild(msgEl);
    });
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Load initial messages
  function loadMessages() {
    messagesStore.setState({ loading: true, error: null });
    
    getMessageHistory()
      .then(data => {
        if (data && Array.isArray(data.items)) {
          messagesStore.setState({ 
            timeline: data.items,
            pagination: {
              page: data.currentPage || 1,
              totalItems: data.totalItems || 0,
              totalPages: data.totalPages || 1
            },
            loading: false
          });
          
          updateVisibleMessages();
        }
      })
      .catch(error => {
        console.error('Failed to load messages:', error);
        messagesStore.setState({ 
          error: error.message || 'Failed to load messages',
          loading: false
        });
        
        // Show error in timeline
        messagesContainer.innerHTML = `
          <div class="message-timeline-empty error">
            <i class="fas fa-exclamation-triangle"></i>
            <p>Failed to load messages</p>
          </div>
        `;
      });
  }

  // Subscribe to store changes
  const unsubscribe = messagesStore.subscribe(() => {
    updateVisibleMessages();
  });

  // Listen for new messages from event bus
  const unsubscribeEvent = eventBus.on('new-message', (message) => {
    const { timeline } = messagesStore.getState();
    messagesStore.setState({ 
      timeline: [...timeline, message]
    });
    
    // Update view
    updateVisibleMessages();
  });

  // Initialize component
  loadMessages();

  // Expose public methods
  container.refresh = loadMessages;
  container.filter = (filterType) => {
    activeFilter = filterType;
    messagesStore.setState({ filter: filterType });
    updateVisibleMessages();
  };
  
  // Cleanup method
  container.destroy = () => {
    unsubscribe();
    unsubscribeEvent();
    
    // Remove event listeners
    filterToolbar.querySelectorAll('.timeline-filter-btn').forEach(btn => {
      btn.removeEventListener('click', null);
    });
  };

  return container;
}

/**
 * Mount a message timeline to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - Timeline properties
 * @returns {HTMLElement} The mounted timeline
 */
MessageTimeline.mount = (parent, props = {}) => {
  const timeline = MessageTimeline(props);
  parent.appendChild(timeline);
  return timeline;
};

export default MessageTimeline;
