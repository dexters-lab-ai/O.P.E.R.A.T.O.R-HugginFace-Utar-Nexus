/**
 * Message Timeline Component
 * Displays a unified timeline of chat messages and command results
 */

import { eventBus, addEvent } from '../utils/events.js';
import api from '../utils/api.js';

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

  // Local state: messages list and current filter
  let messages = [];
  let activeFilter = initialFilter;

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
  
  // Add filter buttons
  filterButtons.forEach(filter => {
    const button = document.createElement('button');
    button.className = `timeline-filter-btn ${filter.value === activeFilter ? 'active' : ''}`;
    button.textContent = filter.text;
    button.dataset.filter = filter.value;
    
    button.addEventListener('click', () => {
      // Update active filter
      activeFilter = filter.value;
      
      // Update UI button states
      filterToolbar.querySelectorAll('.timeline-filter-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === activeFilter));
      
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
    // Clear current messages
    messagesContainer.innerHTML = '';
    
    // If no messages, show empty state
    if (messages.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'message-timeline-empty';
      emptyEl.innerHTML = '<i class="fas fa-comments"></i><p>No messages yet</p>';
      messagesContainer.appendChild(emptyEl);
      return;
    }
    
    // Filter messages if needed
    const filtered = activeFilter === 'all' ? messages : messages.filter(msg => msg.type === activeFilter);
    
    // Render messages
    filtered.forEach(message => {
      const msgEl = createMessageItem(message);
      messagesContainer.appendChild(msgEl);
    });
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Function to load initial messages
  function loadMessages() {
    api.messages.getHistory()
      .then(data => {
        if (data && Array.isArray(data.items)) {
          messages = data.items;
          updateVisibleMessages();
        }
      })
      .catch(error => {
        console.error('Failed to load messages:', error);
        messagesContainer.innerHTML = `
          <div class="message-timeline-empty error">
            <i class="fas fa-exclamation-triangle"></i>
            <p>Failed to load messages</p>
          </div>
        `;
      });
  }

  // Listen for new persisted messages
  eventBus.on('new-message', message => {
    messages.push(message);
    updateVisibleMessages();
  });

  // Initialize component
  loadMessages();

  // Expose public methods
  container.refresh = loadMessages;
  container.filter = (filterType) => {
    activeFilter = filterType;
    updateVisibleMessages();
  };
  
  // Cleanup method
  container.destroy = () => {
    // Clean up filter button listeners by replacing nodes
    filterToolbar.querySelectorAll('.timeline-filter-btn').forEach(btn => btn.replaceWith(btn.cloneNode(true)));
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
