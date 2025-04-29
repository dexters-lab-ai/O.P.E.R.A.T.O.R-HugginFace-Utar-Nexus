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

  // Update handleChatUpdate to merge thought streaming
  function handleChatUpdate(message) {
    console.log("MessageTimeline received chat-update:", message);
    const { timeline } = messagesStore.getState();
    let newMessage = null;

    switch (message.type) {
      case 'user_message':
        newMessage = {
          id: message.id || `local-${Date.now()}`,
          role: MESSAGE_ROLES.USER,
          type: MESSAGE_TYPES.CHAT,
          content: message.payload?.text || '',
          timestamp: message.timestamp || Date.now()
        };
        break;
      case 'ai_thought_stream':
        // Streaming: update or create single thought bubble
        if (!activeThoughtId) {
          activeThoughtId = message.id || `thought-${Date.now()}`;
          newMessage = {
            id: activeThoughtId,
            role: MESSAGE_ROLES.ASSISTANT,
            type: MESSAGE_TYPES.THOUGHT,
            content: message.payload?.text || '',
            timestamp: message.timestamp || Date.now(),
            streaming: true
          };
          messagesStore.setState({ timeline: [...timeline, newMessage] });
        } else {
          // Update existing bubble's content
          const updatedTimeline = timeline.map(msg =>
            msg.id === activeThoughtId ? { ...msg, content: message.payload?.text || '', streaming: true } : msg
          );
          messagesStore.setState({ timeline: updatedTimeline });
        }
        return;
      case 'chat_response':
        // Final AI response: render below thought bubble, mark bubble as done
        if (activeThoughtId) {
          const updatedTimeline = timeline.map(msg =>
            msg.id === activeThoughtId ? { ...msg, streaming: false } : msg
          );
          // Add final message
          const finalMsg = {
            id: message.id || `server-${Date.now()}`,
            role: MESSAGE_ROLES.ASSISTANT,
            type: MESSAGE_TYPES.CHAT,
            content: message.payload?.text || '',
            timestamp: message.timestamp || Date.now()
          };
          messagesStore.setState({ timeline: [...updatedTimeline, finalMsg] });
          activeThoughtId = null;
          return;
        }
        newMessage = {
          id: message.id || `server-${Date.now()}`,
          role: MESSAGE_ROLES.ASSISTANT,
          type: MESSAGE_TYPES.CHAT,
          content: message.payload?.text || '',
          timestamp: message.timestamp || Date.now()
        };
        break;
      default:
        console.warn(`MessageTimeline received unhandled chat-update type: ${message.type}`);
        return;
    }

    if (newMessage) {
      if (!timeline.some(msg => msg.id === newMessage.id)) {
        messagesStore.setState({ timeline: [...timeline, newMessage] });
        if (newMessage.type === MESSAGE_TYPES.THOUGHT) activeThoughtId = newMessage.id;
      }
    }
  }

  // Initialize with empty state
  messagesStore.setState({ 
    timeline: [],
    loading: false,
    error: null,
    filter: 'all'
  });

  // Render error state if present
  if (error) {
    container.innerHTML = `
      <div className="error-message">
        <i className="fas fa-exclamation-triangle"></i>
        <p>Failed to load messages</p>
      </div>
    `;
    return;
  }
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
