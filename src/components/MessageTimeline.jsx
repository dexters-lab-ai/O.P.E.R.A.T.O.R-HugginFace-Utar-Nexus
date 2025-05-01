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
  ERROR: 'error',
  THOUGHT: 'thought'
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

  // --- Thought Streaming Bubble Logic ---
  // Only one active thought bubble per session
  let activeThoughtId = null;

  // Function to create a single message item
  function createMessageItem(message) {
    const { role, type, content, timestamp, id, streaming } = message;
    
    // Create message element
    const msgEl = document.createElement('div');
    msgEl.className = `msg-item msg-${role || 'unknown'}`;
    if (type) msgEl.classList.add(`msg-${type}`);
    if (id) msgEl.dataset.messageId = id; // Add message ID for potential updates

    // Add fade-in animation for new messages
    msgEl.classList.add('fade-in-message');
    setTimeout(() => msgEl.classList.remove('fade-in-message'), 500);

    // Message metadata
    const metaEl = document.createElement('div');
    metaEl.className = 'msg-meta';
    
    // Role badge
    const roleEl = document.createElement('div');
    roleEl.className = 'msg-role';
    let roleIcon = '';
    switch (role) {
      case MESSAGE_ROLES.USER:
        roleIcon = 'fa-user';
        break;
      case MESSAGE_ROLES.ASSISTANT:
        roleIcon = 'fa-robot';
        break;
      case MESSAGE_ROLES.SYSTEM:
        roleIcon = 'fa-info-circle';
        break;
      default:
        roleIcon = 'fa-comment';
    }
    // Use FontAwesome solid style
    roleEl.innerHTML = `<i class="fas ${roleIcon}"></i>`;
    metaEl.appendChild(roleEl);
    
    // Type badge if not default
    if (type && type !== MESSAGE_TYPES.CHAT) {
      const typeEl = document.createElement('div');
      typeEl.className = `msg-type msg-${type}`;
      // Make thought type less prominent
      typeEl.textContent = type === MESSAGE_TYPES.THOUGHT ? 'Thinking...' : type;
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
    const sanitizedContent = (content || '')
        .replace(/</g, "&lt;").replace(/>/g, "&gt;"); // Basic HTML entity encoding

    contentEl.innerHTML = sanitizedContent
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/\*(.*?)\*/g, '<em>$1</em>')       // Italics
        .replace(/\n/g, '<br>') // Convert newlines to <br>
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'); // Links
    msgEl.appendChild(contentEl);
    
    // Check if message has error
    if (message.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'msg-error';
      errorEl.textContent = message.error;
      msgEl.appendChild(errorEl);
    }

    // Specific styling for thoughts
    if (type === MESSAGE_TYPES.THOUGHT) {
        msgEl.style.opacity = '0.6';
        msgEl.style.fontStyle = 'italic';
        msgEl.style.fontSize = '0.9em'; // Make thoughts slightly smaller
        msgEl.classList.add('msg-thought-item'); // Add class for CSS targeting
        if (streaming) {
          const typingEl = document.createElement('span');
          typingEl.className = 'typing-indicator';
          typingEl.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
          msgEl.appendChild(typingEl);
        }
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
    const filteredMessages = timeline.filter(msg => {
        if (filter === 'all') return true;
        if (filter === 'chat') return msg.type === MESSAGE_TYPES.CHAT || msg.type === MESSAGE_TYPES.THOUGHT;
        if (filter === 'command') return msg.type === MESSAGE_TYPES.COMMAND; // Assumes command results have this type
        if (filter === 'system') return msg.type === MESSAGE_TYPES.SYSTEM || msg.type === MESSAGE_TYPES.ERROR;
        return false; // Default case
    });

    // Render messages
    filteredMessages.forEach(message => {
      const msgEl = createMessageItem(message);
      messagesContainer.appendChild(msgEl);
    });
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Handle chat updates with fresh messages
  function handleChatUpdate(message) {
    console.log("MessageTimeline received chat-update:", message);
    const { timeline } = messagesStore.getState();

    // Create base message structure
    const baseMessage = {
      role: message.role || MESSAGE_ROLES.ASSISTANT,
      type: message.type || MESSAGE_TYPES.CHAT,
      content: message.payload?.text || '',
      timestamp: message.timestamp || Date.now(),
      id: message.id // Use server-provided ID if available
    };

    // Handle different message types
    switch (message.type) {
      case 'user_message':
        // User messages should always have a unique ID
        baseMessage.id = message.id || `user-${Date.now()}`;
        baseMessage.role = MESSAGE_ROLES.USER;
        break;

      case 'ai_thought_stream':
        // Handle thought streaming
        if (message.id) {
          // If we have an ID, use it to update the existing message
          const updatedTimeline = timeline.map(msg =>
            msg.id === message.id ? { ...msg, content: message.payload?.text || '', streaming: true } : msg
          );
          messagesStore.setState({ timeline: updatedTimeline });
          return;
        }
        // If no ID, create a new thought
        baseMessage.id = `thought-${Date.now()}`;
        baseMessage.type = MESSAGE_TYPES.THOUGHT;
        baseMessage.streaming = true;
        break;

      case 'chat_response':
        // Handle final responses
        if (message.id) {
          // If we have an ID, use it to update the existing message
          const updatedTimeline = timeline.map(msg =>
            msg.id === message.id ? { ...msg, content: message.payload?.text || '', streaming: false } : msg
          );
          messagesStore.setState({ timeline: updatedTimeline });
          return;
        }
        // If no ID, create a new message
        baseMessage.id = `response-${Date.now()}`;
        break;

      default:
        console.warn(`MessageTimeline received unhandled chat-update type: ${message.type}`);
        return;
    }

    // Remove any existing messages with the same content
    const uniqueTimeline = timeline.filter(msg => 
      !(msg.content === baseMessage.content && msg.type === baseMessage.type)
    );

    // Add the new message
    const newTimeline = [...uniqueTimeline, baseMessage];
    
    // Sort by timestamp to maintain proper order
    const sortedTimeline = newTimeline.sort((a, b) => a.timestamp - b.timestamp);
    
    // Update the store with the fresh timeline
    messagesStore.setState({
      timeline: sortedTimeline
    });
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

  // --- Internal State / Subscriptions ---
  let storeUnsubscribe = null;
  let chatUpdateUnsubscribe = null; // To store the unsubscribe function for chat-update

  // --- Event Handling --- 
  // Subscribe to store changes
  storeUnsubscribe = messagesStore.subscribe(() => {
    updateVisibleMessages();
  });

  // Subscribe to chat updates from WebSocket handler
  chatUpdateUnsubscribe = eventBus.on('chat-update', handleChatUpdate);

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
    if(storeUnsubscribe) storeUnsubscribe();
    if (chatUpdateUnsubscribe) {
        chatUpdateUnsubscribe(); // Unsubscribe from chat-update
        chatUpdateUnsubscribe = null;
    }

    console.log("MessageTimeline destroyed");
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
