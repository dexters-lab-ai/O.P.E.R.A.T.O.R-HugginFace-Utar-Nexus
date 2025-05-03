/**
 * Command Center Component
 * Centralized input area for chat messages and commands
 */

import { eventBus } from '../utils/events.js';
import { uiStore, messagesStore, tasksStore } from '../store/index.js';
import { cancelTask, createTask } from '../api/tasks.js';
import Button from './base/Button.jsx';
import Dropdown from './base/Dropdown.jsx';
import api from '../utils/api.js';
import NeuralFlow from '../utils/NeuralFlow.js';

// Tab types
export const TAB_TYPES = {
  NLI: 'nli',
  ACTIVE_TASKS: 'active-tasks',
  MANUAL: 'manual',
  REPETITIVE: 'repetitive',
  SCHEDULED: 'scheduled'
};

// Buffer for assembling complete function call arguments per task
const functionCallBuffers = {};

/**
 * Create a command center component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Command center container
 */
export function CommandCenter(props = {}) {
  const {
    containerId = 'command-center',
    initialTab = TAB_TYPES.NLI
  } = props;

  // Map of per-task NeuralFlow visualization instances
  const neuralFlows = {};

  // Create component container
  const container = document.createElement('div');
  container.className = 'command-center';
  if (containerId) container.id = containerId;

  // Create card container
  const card = document.createElement('div');
  card.className = 'command-center-card';
  card.id = 'task-input-card';

  // Initialize messages store with loading state
  messagesStore.setState({ timeline: [], isLoading: true });
  
  /**
   * Load message history directly from DB - no temporary storage
   * Ensures only the most recent messages appear in the chat timeline
   * @param {Set} preserveTaskIds - Optional set of task IDs to preserve during refresh
   */
  async function loadMessageHistory(preserveTaskIds = new Set()) {
    try {
      messagesStore.setState({ isLoading: true });
      console.log('[DEBUG] Loading latest message history from DB...');
      
      // Save existing thought bubbles before refresh
      const existingBubbles = new Map();
      if (preserveTaskIds.size > 0) {
        document.querySelectorAll('.thought-bubble[data-task-id]').forEach(bubble => {
          const taskId = bubble.getAttribute('data-task-id');
          if (preserveTaskIds.has(taskId)) {
            existingBubbles.set(taskId, bubble.cloneNode(true));
          }
        });
      }
      
      // Use current timestamp to ensure we only get recent messages (last 24 hours)
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const timestamp = oneDayAgo.toISOString();
      
      // Direct fetch from DB with time filter and proper sorting
      const response = await fetch(`/api/messages/history?limit=20&since=${timestamp}&sort=desc`);
      
      if (!response.ok) {
        throw new Error(`DB fetch failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[DEBUG] DB fetch result:', data);
      
      // Clear any cached messages from memory and use only DB results
      sessionStorage.removeItem('messageCache');
      localStorage.removeItem('messageHistory');
      
      // Get messages array from response
      const messagesArray = data.items || data.messages || [];
      
      if (Array.isArray(messagesArray) && messagesArray.length > 0) {
        // Filter valid messages and ensure freshness (newer than yesterday)
        const yesterday = Date.now() - (24 * 60 * 60 * 1000);
        const validMessages = messagesArray.filter(msg => 
          msg && typeof msg === 'object' && 
          msg.role && msg.content && msg.timestamp &&
          new Date(msg.timestamp).getTime() > yesterday
        );
        
        console.log(`[DEBUG] Found ${validMessages.length} valid recent messages out of ${messagesArray.length} total`);
        
        // Sort with newest messages at the bottom
        const sortedMessages = [...validMessages].sort((a, b) => {
          return new Date(a.timestamp) - new Date(b.timestamp);
        });
        
        // Clean replacement of timeline
        messagesStore.setState({ 
          timeline: sortedMessages,
          isLoading: false 
        });
        
        // Restore preserved task bubbles
        setTimeout(() => {
          const timeline = document.querySelector('.message-timeline-container');
          if (!timeline) return;
          
          // Add back preserved bubbles
          preserveTaskIds.forEach(taskId => {
            // First remove any duplicates
            const existingElements = timeline.querySelectorAll(`.thought-bubble[data-task-id="${taskId}"]`);
            existingElements.forEach(el => el.remove());
            
            // Then add the preserved bubble
            if (existingBubbles.has(taskId)) {
              timeline.appendChild(existingBubbles.get(taskId));
            }
          });
          
          // Robust scroll to bottom
          scrollToLatestMessage(true);
        }, 100);
      } else {
        console.warn('[DEBUG] No messages found in DB fetch');
        messagesStore.setState({ isLoading: false });
      }
    } catch (error) {
      console.error('Error loading message history:', error);
      messagesStore.setState({ isLoading: false });
      
      // Show notification to user only on initial load failures
      eventBus.emit('notification', {
        message: 'Failed to load message history. Please refresh to try again.',
        type: 'error',
        duration: 5000
      });
    }
  }
  
  /**
   * Helper function to scroll the message container to the bottom
   */
  /**
   * Robust function to scroll message container to bottom
   * Uses multiple selectors and redundancy to ensure we find the right container
   */
  function scrollToLatestMessage(immediate = false) {
    // Try multiple selector patterns to find the container (from most to least specific)
    const container = 
      document.querySelector('#command-center .message-timeline-container') || 
      document.querySelector('.message-timeline-container') ||
      document.querySelector('.message-timeline') ||
      document.querySelector('.content-wrapper .message-timeline');
    
    if (!container) {
      console.warn('[DEBUG] Message timeline container not found yet, will retry later');
      return false; // Return false to indicate scroll didn't happen
    }
    
    try {
      // Get the last message element for a more focused scroll
      const lastMessage = container.querySelector('.thought-bubble:last-child, .message-item:last-child');
      
      // Single-pass scrolling with all methods
      // First strategy: Direct scrollTop assignment
      container.scrollTop = container.scrollHeight;
      
      // Second strategy: ScrollIntoView for the last message
      if (lastMessage) {
        lastMessage.scrollIntoView({ behavior: immediate ? 'auto' : 'smooth', block: 'end' });
      }
      
      // Third strategy: Use scrollTo API 
      container.scrollTo({
        top: container.scrollHeight,
        behavior: immediate ? 'auto' : 'smooth'
      });
      
      return true; // Return true to indicate scroll was successful
    } catch (err) {
      console.warn('[DEBUG] Error during scroll:', err.message);
      return false;
    }
  }
  
  // Set up observer to watch for changes to the message container
  // This ensures we auto-scroll when new messages are added
  setTimeout(() => {
    const timelineContainer = document.querySelector('.message-timeline-container');
    if (timelineContainer) {
      const observer = new MutationObserver(mutations => {
        // Look for additions that are actual message elements
        const relevantMutations = mutations.some(mutation => {
          return Array.from(mutation.addedNodes).some(node => 
            node.nodeType === 1 && 
            (node.classList.contains('thought-bubble') || 
             node.classList.contains('bubble-card') ||
             node.classList.contains('message'))
          );
        });
        
        if (relevantMutations) {
          scrollToLatestMessage();
        }
      });
      
      // Observe for new children and changes to existing children
      observer.observe(timelineContainer, { 
        childList: true, 
        subtree: true,
        attributes: true, 
        attributeFilter: ['class', 'style'] 
      });
      
      // Scroll on initial setup
      scrollToLatestMessage(true);
    }
  }, 300);  // Short delay to ensure DOM is ready
  
  // Active task IDs to preserve during refreshes
  const activeTaskIds = new Set();
  
  // Load message history when component initializes
  window.addEventListener('DOMContentLoaded', () => {
    loadMessageHistory();
  });
  
  // Progressive scroll attempts to catch the timeline when it becomes available
  // Uses a smarter retry pattern with exponential backoff
  let scrollSuccess = false;
  const scrollAttempts = [100, 300, 600, 1000, 2000, 4000];
  
  // Create sequential attempts that only run if previous attempts failed
  scrollAttempts.forEach((delay, index) => {
    setTimeout(() => {
      if (!scrollSuccess) {
        // Only try if we haven't succeeded yet
        const result = scrollToLatestMessage(true);
        if (result) {
          scrollSuccess = true;
          console.log(`[DEBUG] Scroll succeeded on attempt ${index + 1}`);
        } else if (index === scrollAttempts.length - 1) {
          console.warn('[DEBUG] All scroll attempts completed, some may have failed');
        }
      }
    }, delay);
  });
  
  // Use IntersectionObserver for an efficient way to detect when
  // the timeline is actually visible before attempting to scroll
  const contentObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Timeline is now visible in viewport, scroll to bottom
          const success = scrollToLatestMessage(true);
          if (success) {
            console.log('[DEBUG] Scroll triggered by intersection observer');
          }
        }
      });
    }, {threshold: 0.1}
  );
  
  // Try to observe multiple potential timeline selectors
  setTimeout(() => {
    // Try multiple selectors to find the timeline
    const selectors = [
      '#command-center .message-timeline-container',
      '.message-timeline-container',
      '.message-timeline',
      '.content-wrapper .message-timeline'
    ];
    
    let observedElement = false;
    
    // Try each selector
    selectors.forEach(selector => {
      if (!observedElement) {
        const timeline = document.querySelector(selector);
        if (timeline) {
          contentObserver.observe(timeline);
          console.log(`[DEBUG] Timeline observer attached to: ${selector}`);
          observedElement = true;
          
          // Force an initial scroll once we find the element
          scrollToLatestMessage(true);
        }
      }
    });
    
    if (!observedElement) {
      console.warn('[DEBUG] Could not find timeline to observe. Will retry.');
      // Try again later if we couldn't find it
      setTimeout(() => {
        const timeline = document.querySelector('.message-timeline-container');
        if (timeline) {
          contentObserver.observe(timeline);
          scrollToLatestMessage(true);
        }
      }, 1000);
    }
  }, 500);
  
  // Single resize handler with debounce to avoid duplicate handlers
  window.addEventListener('resize', debounce(() => scrollToLatestMessage(true), 200));
  
  // Helper function to limit resize event frequency
  function debounce(func, wait) {
    let timeout;
    return function() {
      const context = this;
      const args = arguments;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }
  
  // Add a MutationObserver to detect when new content is added to the timeline
  setTimeout(() => {
    const timeline = document.querySelector('.message-timeline-container');
    if (timeline) {
      // Only watch for childList changes (new messages added)
      const observer = new MutationObserver(() => scrollToLatestMessage());
      observer.observe(timeline, { childList: true });
    }
  }, 300);
  
  // DISABLED: Periodic message timeline refresh - causing disappearing tasks
  // The initial load will be sufficient, and new messages will be added via WebSocket
  // We won't refresh the timeline automatically to prevent disrupting active tasks
  
  // Keeping this code commented for reference:
  /*
  setInterval(() => {
    // Before refreshing, store active task IDs
    document.querySelectorAll('.thought-bubble[data-task-id]').forEach(bubble => {
      const taskId = bubble.getAttribute('data-task-id');
      if (taskId) activeTaskIds.add(taskId);
    });
    
    // Pass the active task IDs to the load function to preserve them
    loadMessageHistory(activeTaskIds);
  }, 60000); // Refresh every minute
  */
  
  // Add cleanup function
  const originalDestroy = container.destroy;
  container.destroy = () => {
    // No need to clear message refresh interval since it's disabled
    // Just ensure websocket is cleaned up
    if (ws) {
      try {
        ws.close(1000);
      } catch (e) {
        console.warn('Error closing websocket:', e);
      }
      ws = null;
    }
    
    if (typeof originalDestroy === 'function') {
      originalDestroy();
    }
  };

  // Create card title
  const cardTitle = document.createElement('h3');
  cardTitle.className = 'card-title';
  cardTitle.innerHTML = '<i class="fas fa-terminal"></i> Command Center';
  
  // Add tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.innerHTML = `
    <span class="guide-dot">?</span>
    <span class="tooltip-text">Enter natural language commands below or use the other tabs for fixed input modes.</span>
  `;
  cardTitle.appendChild(tooltip);
  
  card.appendChild(cardTitle);

  // Create tab buttons
  const tabButtons = document.createElement('div');
  tabButtons.className = 'tab-buttons';
  tabButtons.id = 'task-type-tabs';

  // Define tabs
  const tabs = [
    { id: TAB_TYPES.NLI, label: 'Chat', icon: 'fa-comments' },
    { id: TAB_TYPES.MANUAL, label: 'General Task', icon: 'fa-tasks' },
    { id: TAB_TYPES.REPETITIVE, label: 'Repetitive', icon: 'fa-sync' },
    { id: TAB_TYPES.SCHEDULED, label: 'Scheduled', icon: 'fa-calendar' }
  ];

  // Current active tab
  let activeTab = initialTab;

  // WebSocket State
  let ws = null;
  let wsConnected = false;
  let connecting = false;
  let reconnectAttempts = 0;
  let userId = null; // Will be fetched

  // WebSocket Constants
  const WS_URL = `ws://${window.location.host}/ws`;
  const RETRY_DELAY = 5000; // 5 seconds

  // --- User ID Management Helper with /api/whoami sync and force sync on load ---
  async function syncUserIdWithBackend() {
    try {
      const resp = await fetch('/api/whoami');
      const data = await resp.json();
      if (data.userId) {
        localStorage.setItem('userId', data.userId);
        sessionStorage.setItem('userId', data.userId);
        console.debug('[DEBUG] syncUserIdWithBackend: Synced userId from /api/whoami:', data.userId);
        initWebSocket(data.userId);
        return data.userId;
      }
    } catch (err) {
      console.warn('[DEBUG] syncUserIdWithBackend: Failed to sync with /api/whoami', err);
    }
    // fallback to old logic
    return getOrSyncUserId();
  }

  // --- On app load: force userId sync before anything else ---
  (async () => {
    const userId = await syncUserIdWithBackend();
    console.debug('[DEBUG] App load: userId after sync', userId);
    // WebSocket is initialized in syncUserIdWithBackend, no need to init twice
  })();

  // --- User ID Management Helper with /api/whoami sync ---
  async function getOrSyncUserId() {
    let userId = localStorage.getItem('userId');
    if (userId) {
      console.debug('[DEBUG] getOrSyncUserId: Found userId in localStorage:', userId);
      return userId;
    }
    // Try to get from sessionStorage (if backend writes it)
    userId = sessionStorage.getItem('userId');
    if (userId) {
      localStorage.setItem('userId', userId);
      console.debug('[DEBUG] getOrSyncUserId: Synced userId from sessionStorage:', userId);
      return userId;
    }
    // Try to sync with backend via /api/whoami
    try {
      const resp = await fetch('/api/whoami');
      const data = await resp.json();
      if (data.userId) {
        userId = data.userId;
        localStorage.setItem('userId', userId);
        sessionStorage.setItem('userId', userId);
        console.debug('[DEBUG] getOrSyncUserId: Synced userId from /api/whoami:', userId);
        return userId;
      }
    } catch (err) {
      console.warn('[DEBUG] getOrSyncUserId: Failed to sync with /api/whoami', err);
    }
    // If not found, create a guest userId
    userId = 'guest_' + Date.now() + '_' + Math.floor(Math.random()*100000);
    localStorage.setItem('userId', userId);
    sessionStorage.setItem('userId', userId);
    console.debug('[DEBUG] getOrSyncUserId: Created guest userId:', userId);
    return userId;
  }

  // --- WebSocket Functions (adapted from UnifiedCommandSection) ---
  const initWebSocket = (currentUserId) => {
    // Skip if already connected or in-flight
    if (connecting || (ws && ws.readyState === WebSocket.OPEN)) {
      console.debug('[DEBUG] CommandCenter: already connected or connecting – skipping init.');
      return;
    }
    connecting = true;
    console.log('[DEBUG] CommandCenter: initWebSocket called with userId:', currentUserId);
    if (!currentUserId) {
      console.error('WebSocket: Cannot initialize without userId.');
      return; // Don't attempt if no userId
    }
    userId = currentUserId; // Store userId for potential reconnects

    // Close existing connection if any before creating a new one
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      console.log('WebSocket: Closing existing connection before reconnecting.');
      ws.close(1000, 'Reinitializing connection');
    }

    const wsUrl = `${WS_URL}?userId=${encodeURIComponent(userId)}`;
    console.log(`[DEBUG] CommandCenter: Attempting WebSocket connection to: ${wsUrl}`);
    try {
      ws = new WebSocket(wsUrl);
      console.log('[DEBUG] CommandCenter: WebSocket object created.');
    } catch (e) {
      connecting = false;
      console.error('[DEBUG] CommandCenter: Error creating WebSocket object:', e);
      return; // Stop if creation fails
    }

    ws.onopen = () => {
      console.log(`[DEBUG] CommandCenter: WebSocket ONOPEN event for userId=${userId}`);
      connecting = false;
      wsConnected = true;
      reconnectAttempts = 0; // Reset attempts on successful connection

      // Optional: Send any queued messages if needed
      // flushUnsentMessages(userId);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('WebSocket: Received message:', message);

        // Process task steps from WebSocket events
        if (message.event === 'functionCallPartial') {
          console.debug('[DEBUG] WS functionCallPartial:', message.functionName, message.partialArgs);
          functionCallBuffers[message.taskId] = (functionCallBuffers[message.taskId] || '') + message.partialArgs;
          let args;
          try { args = JSON.parse(functionCallBuffers[message.taskId]); } catch { return; }
          delete functionCallBuffers[message.taskId];
          tasksStore.addStepLog(message.taskId, { type: 'functionCall', functionName: message.functionName, args, timestamp: new Date().toISOString() });
          renderStepLogs(message.taskId);
          const timelineEl = document.querySelector('.message-timeline-container');
          if (timelineEl) {
            let bubble = timelineEl.querySelector(`.thought-bubble[data-task-id="${message.taskId}"]`);
            if (!bubble) {
              bubble = document.createElement('div');
              bubble.className = 'thought-bubble creative-bubble typing-bubble';
              bubble.setAttribute('data-task-id', message.taskId);
              timelineEl.appendChild(bubble);
            }
            bubble.innerHTML = `<div><em>Function:</em> ${message.functionName}</div><pre class="typing-content"></pre>`;
            const pre = bubble.querySelector('.typing-content'); const text = JSON.stringify(args, null, 2);
            let i = 0; const ti = setInterval(() => { pre.textContent += text.charAt(i++); bubble.scrollTop = bubble.scrollHeight; if (i >= text.length) clearInterval(ti); }, 20);
          }
          return;
        }

        if (message.event === 'planLog') {
          console.debug('[DEBUG] WS planLog:', message.message);
          // Extract step number if available
          let stepNumber = null;
          let stepAction = message.message;
          
          // Try to extract step number from messages like "Executing step 4: action - click..."
          const stepMatch = message.message.match(/step\s+(\d+):\s*(.+)/i);
          if (stepMatch) {
            stepNumber = parseInt(stepMatch[1]);
            stepAction = stepMatch[2];
          }
          
          // Add to task steps in store
          const tid = message.taskId || message.task_id;
          if (!tid) {
            console.warn('planLog message missing taskId:', message);
            return;
          }
          
          tasksStore.addStepLog(tid, {
            type: 'planLog',
            message: message.message,
            stepNumber: stepNumber,
            action: stepAction,
            timestamp: new Date().toISOString()
          });
          
          // Update thought bubble with this log using NeuralFlow visualization
          const timeline = document.querySelector('.message-timeline-container');
          if (timeline) {
            // Safely get or create the bubble for this task
            let bubble = document.querySelector(`.thought-bubble[data-task-id="${tid}"]`);
            if (!bubble) {
              try {
                // Create a new bubble for this task
                bubble = document.createElement('div');
                bubble.className = 'thought-bubble creative-bubble';
                bubble.setAttribute('data-task-id', tid);
                bubble.style.animation = 'fadeIn 0.3s';
                // Set minimum height for visualization area
                bubble.style.minHeight = '180px';
                bubble.style.height = '220px';
                timeline.appendChild(bubble);
                
                // Initialize NeuralFlow visualizer
                console.log(`Creating new NeuralFlow for task ${tid}`);
                neuralFlows[tid] = new NeuralFlow(bubble);
              } catch (error) {
                console.error(`Error creating bubble or NeuralFlow for task ${tid}:`, error);
                return;
              }
            }
            
            // Safely add the node to the neural flow
            try {
              try {
                if (neuralFlows[tid]) {
                  // Check if the neural flow instance is valid
                  if (typeof neuralFlows[tid].addNode === 'function') {
                    neuralFlows[tid].addNode(message.message);
                  } else {
                    // Recreate the neural flow if it's corrupted
                    console.warn(`NeuralFlow for task ${tid} is invalid, recreating...`);
                    neuralFlows[tid] = new NeuralFlow(bubble);
                    neuralFlows[tid].addNode(message.message);
                  }
                } else {
                  console.warn(`NeuralFlow for task ${tid} not found, initializing...`);
                  try {
                    // Safe initialization of NeuralFlow
                    neuralFlows[tid] = new NeuralFlow(bubble);
                    neuralFlows[tid].addNode(message.message);
                  } catch (innerError) {
                    console.error(`Failed to initialize NeuralFlow for ${tid}:`, innerError);
                    // Create a basic fallback display for the message
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'neural-flow-fallback';
                    messageDiv.textContent = message.message;
                    bubble.appendChild(messageDiv);
                  }
                }
              } catch (flowError) {
                console.error(`Error handling NeuralFlow for task ${tid}:`, flowError);
                // Ensure the message is still displayed even if visualization fails
                if (!bubble.querySelector('.neural-flow-fallback')) {
                  const fallbackMsg = document.createElement('div');
                  fallbackMsg.className = 'neural-flow-fallback';
                  fallbackMsg.textContent = message.message;
                  bubble.appendChild(fallbackMsg);
                }
              }
              bubble.classList.remove('loading');
              
              // Auto-scroll to bottom
              timeline.scrollTop = timeline.scrollHeight;
            } catch (error) {
              console.error(`Error updating NeuralFlow for task ${tid}:`, error);
            }
          }
          return;
        }

        // Handle streaming messages
        if (message.type === 'chat_response_stream' || message.type === 'ai_thought_stream') {
          // Extract clean content from streaming message
          const content = message.content?.trim();
          
          // Skip empty or malformed messages
          if (!content) return;

          // Get or create the thought container
          let thoughtContainer = document.querySelector(`.thought-bubble[data-task-id="${message.task_id}"]`);
          if (!thoughtContainer) {
            thoughtContainer = document.createElement('div');
            thoughtContainer.className = 'thought-bubble creative-bubble';
            thoughtContainer.setAttribute('data-task-id', message.task_id);
            thoughtContainer.style.animation = 'fadeIn 0.3s';
            
            // Add loading state
            thoughtContainer.classList.add('loading');
            
            // Find the message timeline and append
            const timeline = document.querySelector('.message-timeline-container');
            if (timeline) {
              timeline.appendChild(thoughtContainer); // Add bubble to timeline container
            }
          }

          const thoughtBuffers = {};
          thoughtBuffers[message.task_id] = (thoughtBuffers[message.task_id] || '') + content;
          if (!message.completed) return;
          const fullContent = thoughtBuffers[message.task_id];
          delete thoughtBuffers[message.task_id];
          thoughtContainer.textContent = fullContent;

          // Handle completion
          thoughtContainer.classList.remove('loading');
            
          // Add completion animation
          thoughtContainer.style.animation = 'pulse 1.5s infinite';
            
          // Emit completion event
          eventBus.emit('thought_completed', {
            taskId: message.task_id,
            content: fullContent,
            url: message.url
          });
        }

        // Handle other message types
        if (message.event) {
          eventBus.emit(message.event, message);
        }
      } catch (error) {
        console.error('WebSocket message handling error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[DEBUG] CommandCenter: WebSocket ONERROR event:', error);
      connecting = false;
      // The 'close' event handler will manage reconnection logic.
    };

    ws.onclose = (event) => {
      console.log(`[DEBUG] CommandCenter: WebSocket ONCLOSE event. Code: ${event.code}, Reason: '${event.reason}'. Clean close: ${event.wasClean}`);
      wsConnected = false;
      connecting = false;
      ws = null; // Null out on close

      // Avoid reconnecting on manual close (1000) or going away (1001) triggered by destroy()
      if (event.code !== 1000 && event.code !== 1001) {
        reconnectAttempts++;
        // Exponential backoff with cap
        const delay = RETRY_DELAY * Math.pow(2, Math.min(reconnectAttempts - 1, 4)); 
        console.log(`WebSocket: Attempting reconnect #${reconnectAttempts} in ${delay / 1000}s...`);
        setTimeout(() => initWebSocket(userId), delay); // Use stored userId
      } else {
          console.log("WebSocket: Closed cleanly or intentionally, no reconnect attempt.");
      }
    };
  };
  // --- End WebSocket Functions ---

  // Create tab buttons
  tabs.forEach(tab => {
    const button = document.createElement('button');
    button.className = `tab-btn ${tab.id === activeTab ? 'active' : ''}`;
    button.dataset.taskType = tab.id;
    button.id = `${tab.id}-tab`;
    
    // Add icon or label
    if (tab.icon) button.innerHTML = `<i class="fas ${tab.icon}"></i> ${tab.label}`;
    else button.textContent = tab.label;
    button.addEventListener('click', () => {
      activeTab = tab.id;
      tabButtons.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.taskType === activeTab));
      showActiveSection(activeTab);
      uiStore.setState({ activeTab });
    });
    tabButtons.appendChild(button);
  });
  card.appendChild(tabButtons);

  // Create task sections container
  const taskSections = document.createElement('div');
  taskSections.id = 'task-sections';

  // Section switcher helper
  function showActiveSection(tab) {
    taskSections.querySelectorAll('.task-section').forEach(sec => sec.classList.remove('active'));
    if (tab === TAB_TYPES.NLI) {
      document.getElementById('unified-input-section').classList.add('active');
    } else {
      const sec = document.getElementById(`${tab}-section`);
      if (sec) sec.classList.add('active');
    }
  }

  // --- End WebSocket Functions ---

  // Create sections for each tab
  
  // 1. NLI (Chat) Section
  const nliSection = document.createElement('div');
  nliSection.className = 'task-section';
  nliSection.id = 'unified-input-section';
  if (activeTab === TAB_TYPES.NLI) nliSection.classList.add('active');
  
  const nliForm = document.createElement('form');
  nliForm.id = 'unified-input-form';
  nliForm.autocomplete = 'off';
  
  const inputBar = document.createElement('div');
  inputBar.className = 'unified-input-bar';
  
  const textarea = document.createElement('textarea');
  textarea.id = 'unified-input';
  textarea.className = 'unified-input-textarea';
  textarea.rows = 2;
  textarea.placeholder = 'Type your message, command, or task...';
  textarea.required = true;
  
  // Engine dropdown - Fixed implementation
  const engineDropdownContainer = document.createElement('div');
  engineDropdownContainer.className = 'engine-dropdown-container';
  
  // Define engine options with their icons
  const engineIcons = { 
    'Nexus': 'fa-brain', 
    'UITars': 'fa-clipboard-list', 
    'browserless': 'fa-globe', 
    'YAML': 'fa-file-code' 
  };
  
  // Get selected engine from localStorage or use default
  let selectedEngine = localStorage.getItem('selectedEngine') || 'Nexus';
  if (!engineIcons[selectedEngine]) {
    selectedEngine = 'Nexus';
    localStorage.setItem('selectedEngine', selectedEngine);
  }
  
  // Create trigger button
  const engineTrigger = document.createElement('button');
  engineTrigger.type = 'button';
  engineTrigger.className = 'engine-dropdown-trigger';
  engineTrigger.innerHTML = `<i class="fas ${engineIcons[selectedEngine]}"></i> <span class="engine-label">${selectedEngine}</span> <i class="fas fa-chevron-down dropdown-chevron"></i>`;
  engineDropdownContainer.appendChild(engineTrigger);
  
  // Create dropdown with engine options
  const engineDropdown = Dropdown({
    trigger: engineTrigger,
    items: Object.keys(engineIcons).map(engine => ({
      text: engine,
      icon: engineIcons[engine],
      onClick: () => {
        console.log(`Setting engine to: ${engine}`);
        selectedEngine = engine;
        localStorage.setItem('selectedEngine', engine);
        
        const iconEl = engineTrigger.querySelector('i:first-child');
        const labelEl = engineTrigger.querySelector('.engine-label');
        
        if (iconEl && labelEl) {
          iconEl.className = `fas ${engineIcons[engine]}`;
          labelEl.textContent = engine;
        }
        
        // Emit event for engine change
        eventBus.emit('engineChange', { engine });
      }
    })),
    className: 'engine-dropdown',
    id: 'engine-dropdown',
    position: 'bottom-left',
    width: 150
  });
  engineDropdownContainer.appendChild(engineDropdown);
  
  // Send button
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'btn btn-unified-send';
  sendBtn.id = 'unified-send-btn';
  sendBtn.title = 'Send';
  sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
  
  // allow Enter key (without Shift) in textarea to submit form
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });
  
  inputBar.appendChild(textarea);
  
  const inputControls = document.createElement('div');
  inputControls.className = 'input-controls';
  inputControls.appendChild(engineDropdownContainer);
  inputControls.appendChild(sendBtn);
  inputBar.appendChild(inputControls);
  
  nliForm.appendChild(inputBar);
  
  nliForm.addEventListener('submit', async e => {
    e.preventDefault();
    const content = textarea.value.trim();
    if (!content) return;
    console.debug('[DEBUG] CommandCenter: sending message', content);
    console.debug('[DEBUG] SSE connecting for chat prompt:', content);
    const sseUrl = `/api/nli?prompt=${encodeURIComponent(content)}`;
    console.debug('[DEBUG] SSE endpoint URL:', sseUrl);
    const { timeline } = messagesStore.getState();
    // Add user message locally
    const userMsg = { id: `user-${Date.now()}`, role: 'user', type: 'chat', content, timestamp: new Date().toISOString() };
    // Initialize thought bubble placeholder
    const thoughtId = `thought-${Date.now()}`;
    const thoughtMsg = { id: thoughtId, role: 'assistant', type: 'thought', content: '', timestamp: null };
    messagesStore.setState({ timeline: [...timeline, userMsg, thoughtMsg] });
    textarea.value = '';

    // Stream thought updates via SSE
    const es = new EventSource(sseUrl);
    es.onopen = () => console.debug('[DEBUG] SSE connection opened');
    es.onerror = err => console.error('[DEBUG] SSE error', err);
    es.onmessage = e => {
      const raw = e.data;
      console.debug('[DEBUG] SSE raw event data:', raw);
      try {
        const data = JSON.parse(raw);
        console.debug('[DEBUG] Parsed SSE event:', data);
        switch (data.event) {
          case 'taskStart':
            console.debug('[DEBUG] taskStart:', data.payload);
            tasksStore.addStream(data.payload.taskId, es);
            handleTaskStart(data.payload);
            break;
          case 'stepProgress':
            console.debug('[DEBUG] stepProgress:', data);
            handleStepProgress(data);
            break;
          case 'taskComplete':
            console.debug('[DEBUG] taskComplete:', data);
            es.close();
            handleTaskComplete(data);
            break;
          case 'taskError':
            console.debug('[DEBUG] taskError:', data);
            es.close();
            handleTaskError(data);
            break;
          case 'thoughtUpdate':
            console.debug('[DEBUG] Appending thoughtUpdate chunk');
            {
              const { timeline: current } = messagesStore.getState();
              messagesStore.setState({ timeline: current.map(msg => msg.id === thoughtId ? { ...msg, content: msg.content + data.text } : msg) });
            }
            break;
          case 'functionCallPartial':
            console.debug('[DEBUG] functionCallPartial:', data.functionName, data.partialArgs);
            functionCallBuffers[data.taskId] = (functionCallBuffers[data.taskId] || '') + data.partialArgs;
            let args;
            try { args = JSON.parse(functionCallBuffers[data.taskId]); } catch { return; }
            delete functionCallBuffers[data.taskId];
            tasksStore.addStepLog(data.taskId, { type: 'functionCall', functionName: data.functionName, args, timestamp: new Date().toISOString() });
            renderStepLogs(data.taskId);
            const timelineEl = document.querySelector('.message-timeline-container');
            if (timelineEl) {
              let bubble = timelineEl.querySelector(`.thought-bubble[data-task-id="${data.taskId}"]`);
              if (!bubble) {
                bubble = document.createElement('div');
                bubble.className = 'thought-bubble creative-bubble typing-bubble';
                bubble.setAttribute('data-task-id', data.taskId);
                timelineEl.appendChild(bubble);
              }
              bubble.innerHTML = `<div><em>Function:</em> ${data.functionName}</div><pre class="typing-content"></pre>`;
              const pre = bubble.querySelector('.typing-content'); const text = JSON.stringify(args, null, 2);
              let i = 0; const ti = setInterval(() => { pre.textContent += text.charAt(i++); bubble.scrollTop = bubble.scrollHeight; if (i >= text.length) clearInterval(ti); }, 20);
            }
            return;
          case 'thoughtComplete':
            console.debug('[DEBUG] SSE thoughtComplete received');
            es.close();
            // Finalize bubble: mark as chat complete
            const { timeline: curr } = messagesStore.getState();
            messagesStore.setState({ timeline: curr.map(msg =>
              msg.id === thoughtId
                ? { ...msg, type: 'chat', timestamp: new Date().toISOString() }
                : msg
            ) });
            break;
          default:
            console.debug('[DEBUG] SSE event:', data.event, data.text || '');
            // Handle other message types
            if (data.event) {
              eventBus.emit(data.event, data);
            }
        }
      } catch (err) {
        console.error('SSE parsing error:', err);
      }
    };
  });
  
  nliSection.appendChild(nliForm);
  taskSections.appendChild(nliSection);
  
  // 2. Active Tasks Section
  // Removed
  
  // Add other sections (manual, repetitive, scheduled)
  // For brevity, we're not implementing these fully now
  const otherSections = [
    { id: 'manual-section', type: TAB_TYPES.MANUAL },
    { id: 'repetitive-section', type: TAB_TYPES.REPETITIVE },
    { id: 'scheduled-section', type: TAB_TYPES.SCHEDULED }
  ];
  
  otherSections.forEach(section => {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'task-section';
    sectionEl.id = section.id;
    if (activeTab === section.type) sectionEl.classList.add('active');
    
    // Placeholder content for now
    sectionEl.innerHTML = `
      <div class="placeholder-content">
        <p>This section will be implemented in the next iteration.</p>
      </div>
    `;
    
    taskSections.appendChild(sectionEl);
  });
  
  card.appendChild(taskSections);
  container.appendChild(card);

  // Active tasks polling removed; TaskBar handles active tasks UI.

  // Function to handle task cancellation
  const handleTaskCancel = async (taskId) => {
    try {
      const userId = await getOrSyncUserId();
      console.debug('[DEBUG] handleTaskCancel: Using userId', userId);
      const response = await fetch(`/api/tasks/${taskId}/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'User cancelled', userId })
      });

      if (!response.ok) throw new Error('Failed to cancel task');
      
      const data = await response.json();
      
      if (data.success) {
        // Update local state immediately
        tasksStore.cancelTask(taskId);
        eventBus.emit('notification', { 
          message: 'Task cancelled', 
          type: 'success',
          duration: 3000
        });
      } else {
        throw new Error(data.error || 'Failed to cancel task');
      }
    } catch (error) {
      console.error('Task cancellation failed:', error);
      eventBus.emit('notification', { 
        message: error.message || 'Failed to cancel task',
        type: 'error',
        duration: 5000
      });
    }
  };

  const handleIntermediateResult = (payload) => {
    console.group('[CLIENT] Handling intermediateResult');
    console.log('Raw event data:', payload);
    
    if (!payload?.taskId) {
      console.error('Invalid payload - missing taskId');
      return;
    }
    
    console.log('Current intermediateResults:', 
      tasksStore.getIntermediateResults(payload.taskId));
      
    tasksStore.addIntermediate(payload.taskId, {
      ...payload.result,
      _debugReceivedAt: new Date().toISOString()
    });

    console.log('[DEBUG] Store after update:', {
      intermediates: tasksStore.getIntermediateResults(payload.taskId),
      allTasks: tasksStore.getState().intermediateResults
    });
      
    renderIntermediateResults(payload.taskId);
    console.groupEnd();
  };

  const handleStepProgress = (payload) => {
    // Update task progress and result
    tasksStore.updateTask(payload.taskId, {
      status: 'processing',
      progress: payload.progress,
      result: payload.result,
      error: payload.error || null
    });
  };

  const handleTaskStart = (payload) => {
    console.log('eventBus received taskStart:', payload);
    // Add new task to tasksStore
    tasksStore.setState(state => ({
      active: [...state.active, {
        _id: payload.taskId,
        command: payload.command,
        status: 'pending',
        progress: 0,
        startTime: payload.startTime,
        result: null,
        error: null
      }]
    }));
  };

  const handleTaskComplete = (payload) => {
    console.log('eventBus received taskComplete:', payload);
    // Unwrap SSE or WebSocket payload
    const data = payload.payload || payload;
    const taskId = data.taskId;
    if (!taskId) return;
    
    // Safely extract result and error
    const finalResult = data.result || {};
    const error = data.error || null;
    
    // Mark task as completed
    tasksStore.updateTask(taskId, {
      status: 'completed',
      progress: 100,
      result: finalResult,
      error
    });
    
    // Append final summary as chat message with safe access
    const result = finalResult;
    const aiSummary = result.aiPrepared?.summary ?? result.extractedInfo ?? result.summary ?? '';
    
    // Extract report URLs - enhanced to support both report types
    // Using safe property access in case the server hasn't implemented these yet
    const midsceneReportUrl = result.midsceneReportUrl ?? result.reportUrl ?? '';
    const midsceneLandingUrl = result.midsceneLandingUrl ?? result.landingUrl ?? '';
    
    console.log('Task completion report URLs:', { midsceneReportUrl, midsceneLandingUrl });
    
    const planEntries = tasksStore.getState().stepLogs[taskId] || [];
    const lastPlan = planEntries.filter(l => l.type === 'planLog').slice(-1)[0];
    const planText = lastPlan ? lastPlan.message : '';
    
    // Find and reset any existing msg-thought elements for clean slate
    document.querySelectorAll('.msg-item.msg-assistant.msg-thought, .msg-thought-item')
      .forEach(el => {
        // Keep the existing ones for history but remove indicators
        el.classList.remove('msg-thought', 'msg-thought-item');
      });
    
    const timelineEl = document.querySelector('.message-timeline-container'); 
    if (timelineEl) {
      // Remove any existing task completion cards for this task to avoid duplicates
      document.querySelectorAll(`.task-complete-card[data-task-id="${taskId}"]`)
        .forEach(el => el.remove());
      
      // Create an integrated completion card
      const card = document.createElement('div');
      card.className = 'bubble-card task-complete-card';
      card.setAttribute('data-task-id', taskId);
      
      // Build HTML with both report links if available
      let reportsHtml = '';
      if (midsceneReportUrl) {
        reportsHtml += `<a href="${midsceneReportUrl}" class="report-link" target="_blank">Analysis Report</a>`;
      }
      if (midsceneLandingUrl) {
        reportsHtml += `${midsceneReportUrl ? ' | ' : ''}<a href="${midsceneLandingUrl}" class="report-link" target="_blank">Landing Report</a>`;
      }
      
      card.innerHTML = `
        <span class="status-badge ${result.success ? 'success' : 'failure'}">${result.success ? '\u2713' : '\u2715'}</span>
        <span class="completion-summary">${aiSummary}</span>
        ${planText ? `<span class="plan-log">(${planText})</span>` : ''}
        ${reportsHtml ? `<div class="report-links">${reportsHtml}</div>` : ''}
      `;
      
      timelineEl.appendChild(card);
      timelineEl.scrollTop = timelineEl.scrollHeight; // Auto-scroll to show new content
    }
  };
  
  // --- Helper: Render Intermediate Results ---
  function renderIntermediateResults(taskId) {
    let container = document.getElementById('intermediate-results-container');
    if (!container) {
      const timeline = document.querySelector('.message-timeline-container');
      if (!timeline) return;
      container = document.createElement('div');
      container.id = 'intermediate-results-container';
      container.className = 'intermediate-results-container';
      timeline.insertAdjacentElement('afterend', container);
    }
    container.innerHTML = '';
    const results = tasksStore.getIntermediateResults(taskId) || [];
    results.forEach((res, idx) => {
      const el = document.createElement('div');
      el.className = `intermediate-result-item ${res.__final ? 'final-result' : ''}`;
      el.innerHTML = `
        <div class="step-header">
          <span class="step-number">Step ${idx + 1}</span>
          ${res.__final ? '<span class="final-badge">✓ Final</span>' : ''}
        </div>
        <pre>${JSON.stringify(res, null, 2)}</pre>
      `;
      container.appendChild(el);
    });
    // Always scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  // --- Event Handlers ---

  /**
   * Handle task error events
   * @param {Object} payload - Task error payload
   */
  const handleTaskError = (payload) => {
    console.error('eventBus received taskError:', payload);
    // Unwrap SSE or WebSocket payload if needed
    const data = payload.payload || payload;
    const taskId = data.taskId;
    if (!taskId) return;
    
    // Update task status to error
    tasksStore.updateTask(taskId, {
      status: 'error',
      progress: 0,
      error: data.error || 'Unknown error occurred'
    });
    
    // Display error in UI
    const timelineEl = document.querySelector('.message-timeline-container');
    if (timelineEl) {
      const errorCard = document.createElement('div');
      errorCard.className = 'bubble-card task-error-card';
      errorCard.setAttribute('data-task-id', taskId);
      
      errorCard.innerHTML = `
        <span class="status-badge failure">⚠️</span>
        <span class="error-summary">Task failed: ${data.error || 'Unknown error'}</span>
      `;
      
      timelineEl.appendChild(errorCard);
      timelineEl.scrollTop = timelineEl.scrollHeight;
    }
  };

  // --- Register eventBus listeners (after DOM ready) ---
  eventBus.on('stepProgress', handleStepProgress);
  eventBus.on('taskStart', handleTaskStart);
  eventBus.on('taskComplete', handleTaskComplete);
  eventBus.on('taskError', handleTaskError);

  // WebSocket intermediate result handling with cleanup
  function setupIntermediateResultHandler() {
    const handleIntermediateResult = (data) => {
      console.group('[CLIENT] Handling intermediateResult');
      console.log('Raw event data:', data);
      
      if (!data?.taskId) {
        console.error('Invalid payload - missing taskId');
        return;
      }
      
      console.log('Current intermediateResults:', 
        tasksStore.getIntermediateResults(data.taskId));
        
      tasksStore.addIntermediate(data.taskId, {
        ...data.result,
        _debugReceivedAt: new Date().toISOString()
      });

      console.log('[DEBUG] Store after update:', {
        intermediates: tasksStore.getIntermediateResults(data.taskId),
        allTasks: tasksStore.getState().intermediateResults
      });
      
      renderIntermediateResults(data.taskId);
      console.groupEnd();
    };

    // Subscribe to events
    eventBus.on('intermediateResult', handleIntermediateResult);
    
    // Return cleanup function
    return () => {
      eventBus.off('intermediateResult', handleIntermediateResult);
    };
  }

  // Initialize during component setup
  const cleanupIntermediateHandler = setupIntermediateResultHandler();

  // Add to existing cleanup logic
  function destroy() {
    eventBus.off('taskStart', handleTaskStart);
    eventBus.off('taskComplete', handleTaskComplete);
    eventBus.off('taskError', handleTaskError);
    
    if (typeof cleanupIntermediateHandler === 'function') {
      cleanupIntermediateHandler();
    }
    
    // Existing cleanup code...
  }

  // Update render function
  function renderIntermediateResults(taskId) {
    let container = document.getElementById('intermediate-results-container');
    if (!container) {
      const timeline = document.querySelector('.message-timeline-container');
      if (!timeline) return;
      container = document.createElement('div');
      container.id = 'intermediate-results-container';
      container.className = 'intermediate-results-container';
      timeline.insertAdjacentElement('afterend', container);
    }
    container.innerHTML = '';
    const results = tasksStore.getIntermediateResults(taskId) || [];
    results.forEach((res, idx) => {
      const el = document.createElement('div');
      el.className = `intermediate-result-item ${res.__final ? 'final-result' : ''}`;
      el.innerHTML = `
        <div class="step-header">
          <span class="step-number">Step ${idx + 1}</span>
          ${res.__final ? '<span class="final-badge">✓ Final</span>' : ''}
        </div>
        <pre>${JSON.stringify(res, null, 2)}</pre>
      `;
      container.appendChild(el);
    });
    // Always scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  function renderStepLogs(taskId) {
    let container = document.getElementById('task-step-logs-container');
    if (!container) {
      const timeline = document.querySelector('.message-timeline-container');
      if (!timeline) return;
      container = document.createElement('div');
      container.id = 'task-step-logs-container';
      container.className = 'task-step-logs-container';
      timeline.insertAdjacentElement('afterend', container);
    }
    container.innerHTML = '';
    const results = tasksStore.getIntermediateResults(taskId) || [];
    results.forEach((res, idx) => {
      const el = document.createElement('div');
      el.className = `task-step-log-item ${res.__final ? 'final-result' : ''}`;
      el.innerHTML = `
        <div class="step-header">
          <span class="step-number">Step ${idx + 1}</span>
          ${res.__final ? '<span class="final-badge">✓ Final</span>' : ''}
        </div>
        <pre>${JSON.stringify(res, null, 2)}</pre>
      `;
      container.appendChild(el);
    });
    // Always scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  // Expose public methods
  container.setActiveTab = (tabType) => {
    if (tabs.some(tab => tab.id === tabType)) {
      activeTab = tabType;
      
      // Update UI
      tabButtons.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.taskType === activeTab));
      
      showActiveSection(activeTab);
      
      // Update store
      uiStore.setState({ activeTab });
    }
  };
  
  // Cleanup method
  container.destroy = destroy;

  // Update intermediateResult handler to dispatch custom events
  eventBus.on('intermediateResult', (data) => {
    // Update vanilla JS store first
    tasksStore.addIntermediate(data.taskId, data.result);
    
    // Get updated results
    const results = tasksStore.getIntermediateResults(data.taskId) || [];
    
    // Dispatch custom event for React components
    document.dispatchEvent(new CustomEvent('taskUpdate', {
      detail: {
        taskId: data.taskId,
        results: results,
        eventType: data.event,
        timestamp: new Date().toISOString()
      }
    }));
    
    // Maintain existing rendering
    renderIntermediateResults(data.taskId);
  });

  return container;
}

/**
 * Mount a command center to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - Command center properties
 * @returns {HTMLElement} The mounted command center
 */
CommandCenter.mount = (parent, props = {}) => {
  const commandCenter = CommandCenter(props);
  parent.appendChild(commandCenter);
  return commandCenter;
};

export default CommandCenter;
