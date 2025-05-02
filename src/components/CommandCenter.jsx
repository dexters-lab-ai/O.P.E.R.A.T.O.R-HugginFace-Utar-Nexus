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

// Tab types
export const TAB_TYPES = {
  NLI: 'nli',
  ACTIVE_TASKS: 'active-tasks',
  MANUAL: 'manual',
  REPETITIVE: 'repetitive',
  SCHEDULED: 'scheduled'
};

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

  // Create component container
  const container = document.createElement('div');
  container.className = 'command-center';
  if (containerId) container.id = containerId;

  // Create card container
  const card = document.createElement('div');
  card.className = 'command-center-card';
  card.id = 'task-input-card';

  // Initialize messages store with empty timeline
  messagesStore.setState({ timeline: [] });

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
              timeline.appendChild(thoughtContainer);
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
    
    // Add icon if available
    if (tab.icon) {
      button.innerHTML = `<i class="fas ${tab.icon}"></i> ${tab.label}`;
    } else {
      button.textContent = tab.label;
    }
    
    button.addEventListener('click', () => {
      // Update active tab
      activeTab = tab.id;
      
      // Update UI
      tabButtons.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.taskType === activeTab);
      });
      
      showActiveSection(activeTab);
      
      // Update store
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

  // SSE subscription helper with auto-reconnect, error reporting, throttle, and polling fallback
  function subscribeToTaskStream(taskId) {
    // Polling fallback if SSE unsupported
    function subscribeToTaskPolling(id) {
      const interval = setInterval(async () => {
        try {
          const resp = await getActiveTasks();
          const t = resp.tasks?.find(r => r._id === id);
          if (!t) return clearInterval(interval);
          tasksStore.updateTask(id, {
            status: t.status,
            progress: t.progress,
            result: t.result,
            error: t.error
          });
          if (['completed','error'].includes(t.status)) clearInterval(interval);
        } catch (err) {
          console.error('Polling error for task', id, err);
        }
      }, 5000);
      tasksStore.addStream(id, interval);
      eventBus.emit('notification', { message: 'Real-time unavailable; using polling for task updates.', type: 'warning' });
    }
    if (typeof window.EventSource === 'undefined') {
      return subscribeToTaskPolling(taskId);
    }
    const url = `/api/tasks/${taskId}/stream`;
    const es = new EventSource(url);
    tasksStore.addStream(taskId, es);
    let lastEventTs = 0;
    let errorCount = 0;
    const maxErrors = 3;
    es.onopen = () => console.info(`SSE connected for task ${taskId}`);
    es.onmessage = e => {
      const raw = e.data;
      console.debug('[DEBUG] SSE raw event data:', raw);
      try {
        const data = JSON.parse(raw);
        console.debug('[DEBUG] Parsed SSE event:', data);
        switch (data.event) {
          case 'thoughtUpdate':
            console.debug('[DEBUG] Appending thoughtUpdate chunk');
            {
              const { timeline: current } = messagesStore.getState();
              messagesStore.setState({ timeline: current.map(msg => msg.id === thoughtId ? { ...msg, content: msg.content + data.text } : msg) });
            }
            break;
          case 'functionCallPartial':
            console.debug('[DEBUG] functionCallPartial:', data.functionName, data.partialArgs);
            {
              const { timeline: current } = messagesStore.getState();
              const callMsg = current.find(msg => msg.id === thoughtId);
              if (callMsg) {
                messagesStore.setState({ timeline: current.map(msg => msg.id === thoughtId ? { ...msg, content: msg.content + data.partialArgs } : msg) });
              }
            }
            break;
          case 'planLog':
            console.debug('[DEBUG] planLog event received:', data.message);
            {
              const { timeline: current } = messagesStore.getState();
              messagesStore.setState({ timeline: current.map(msg =>
                msg.id === thoughtId
                  ? { ...msg, content: msg.content + '\n[LOG] ' + data.message }
                  : msg
              ) });
            }
            break;
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
          case 'intermediateResult':
            console.debug('[DEBUG] SSE intermediateResult received');
            handleIntermediateResult(data);
            break;
          default:
            console.debug('[DEBUG] SSE event:', data.event, data.text || '');
            // Handle other message types
            if (data.event) {
              eventBus.emit(data.event, data);
            }
        }
      } catch (error) {
        console.error('SSE message handling error:', error);
      }
    };

    es.onerror = (error) => {
      console.error('[DEBUG] CommandCenter: SSE ONERROR event:', error);
      connecting = false;
      // The 'close' event handler will manage reconnection logic.
    };

    es.onclose = (event) => {
      console.log(`[DEBUG] CommandCenter: SSE ONCLOSE event. Code: ${event.code}, Reason: '${event.reason}'. Clean close: ${event.wasClean}`);
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
  
  // Engine dropdown
  const engineDropdownContainer = document.createElement('div');
  engineDropdownContainer.className = 'engine-dropdown-container';
  const engineTrigger = document.createElement('button');
  engineTrigger.type = 'button';
  engineTrigger.className = 'engine-dropdown-trigger';
  engineTrigger.innerHTML = '<i class="fas fa-brain"></i> <span class="engine-label">Nexus</span> <i class="fas fa-chevron-down dropdown-chevron"></i>';
  engineDropdownContainer.appendChild(engineTrigger);
  let selectedEngine = 'Nexus';
  const engineIcons = { Nexus: 'fa-brain', UITars: 'fa-clipboard-list', browserless: 'fa-globe', YAML: 'fa-file-code' };
  const engineDropdown = Dropdown({
    trigger: engineTrigger,
    items: Object.keys(engineIcons).map(engine => ({
      text: engine,
      icon: engineIcons[engine],
      onClick: () => {
        selectedEngine = engine;
        const iconEl = engineTrigger.querySelector('i');
        const labelEl = engineTrigger.querySelector('.engine-label');
        iconEl.className = `fas ${engineIcons[engine]}`;
        labelEl.textContent = engine;
      }
    })),
    className: 'engine-dropdown',
    id: 'engine-dropdown',
    position: 'bottom-left',
    width: 150
  });
  engineDropdownContainer.appendChild(engineDropdown);
  
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
            {
              const { timeline: current } = messagesStore.getState();
              const callMsg = current.find(msg => msg.id === thoughtId);
              if (callMsg) {
                messagesStore.setState({ timeline: current.map(msg => msg.id === thoughtId ? { ...msg, content: msg.content + data.partialArgs } : msg) });
              }
            }
            break;
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

  // Event listeners for WebSocket messages routed through eventBus
  const handleChatResponse = (payload) => {
    console.log('CommandCenter eventBus received chat_response_stream:', payload);
    const { timeline } = messagesStore.getState();
    const assistantReply = payload.payload?.assistantReply ?? payload.content;
    messagesStore.setState({ timeline: [...timeline, { role: 'assistant', content: assistantReply, type: 'chat' }] });
  };

  const handleAiThought = (payload) => {
    console.debug('[DEBUG] handleAiThought called with', payload);
    const text = payload.text || payload.thought || payload.payload?.text || payload.payload?.thought || '';
    container.setActiveTab(TAB_TYPES.NLI);
    const { timeline } = messagesStore.getState();
    messagesStore.setState({ timeline: [...timeline, { role: 'assistant', content: text, type: 'thought' }] });
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

  const handleFunctionCallPartial = (payload) => {
    // Deduplicate if only URL is changing
    if (lastPartialArgs && payload.partialArgs && typeof payload.partialArgs === 'string' && lastPartialArgs === payload.partialArgs) return;
    lastPartialArgs = payload.partialArgs;
    thoughts.push({ content: payload.partialArgs || payload.thought || '', partialArgs: payload.partialArgs, ts: Date.now() });
    renderThoughtBubbles();
  };

  // Merge both handleThoughtUpdate logics: update timeline in store AND update thoughts array/renderThoughtBubbles
  const handleThoughtUpdate = (payload) => {
    // Store in timeline for chat context
    const text = payload.thought || payload.text || payload.payload?.text || '';
    if (typeof container.setActiveTab === 'function') container.setActiveTab(TAB_TYPES.NLI);
    if (messagesStore && typeof messagesStore.getState === 'function') {
      const { timeline } = messagesStore.getState();
      messagesStore.setState({ timeline: [...timeline, { role: 'assistant', content: text, type: 'thought' }] });
    }
    // Also add to thoughts array for bubbles
    thoughts.push({ content: text, partialArgs: payload.partialArgs, ts: Date.now() });
    renderThoughtBubbles();
  };

  // Update handleThoughtComplete to also update thoughts and render bubbles
  const handleThoughtComplete = (payload) => {
    const text = payload.thought || payload.text || '';
    if (typeof container.setActiveTab === 'function') container.setActiveTab(TAB_TYPES.NLI);
    if (messagesStore && typeof messagesStore.getState === 'function') {
      const { timeline } = messagesStore.getState();
      messagesStore.setState({ timeline: [...timeline, { role: 'assistant', content: text, type: 'thought' }] });
    }
    thoughts.push({ content: text, partialArgs: payload.partialArgs, ts: Date.now() });
    renderThoughtBubbles();
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
    // Mark task as completed
    tasksStore.updateTask(payload.taskId, {
      status: 'completed',
      progress: 100,
      result: payload.result,
      error: payload.error || null
    });
    if (!payload.taskId) return;
    // Add final result to intermediateResults
    let finalRes = payload.result;
    if (typeof finalRes === 'object') finalRes = { ...finalRes, __final: true };
    else finalRes = { value: finalRes, __final: true };
    tasksStore.addIntermediate(payload.taskId, finalRes);
    renderIntermediateResults(payload.taskId);
  };

  const handleTaskError = (payload) => {
    console.error('eventBus received taskError:', payload);
    // Update task status to error
    tasksStore.updateTask(payload.taskId, {
      status: 'error',
      progress: 0,
      error: payload.error
    });
  };

  // --- State for thoughts and intermediate results (per taskId) ---
  let thoughts = [];
  let intermediateResults = {};
  let latestTypingThought = null;
  let lastPartialArgs = '';

  function parsePartialArgs(args) {
    try {
      return typeof args === 'string' ? JSON.parse(args) : args;
    } catch {
      return args;
    }
  }

  // --- Helper: Render Thought Bubbles in Message Timeline ---
  function renderThoughtBubbles() {
    const timelineContainer = document.querySelector('.message-timeline-container');
    if (!timelineContainer) return;
    // Remove old bubbles
    timelineContainer.querySelectorAll('.thought-bubble').forEach(el => el.remove());

    // --- CREATIVE SINGLE BUBBLE LOGIC ---
    // Only show one creative thought bubble at a time, updating its content as thoughts stream in.
    if (thoughts.length > 0) {
      // Combine all thought segments for this session
      let combinedContent = '';
      let lastParsed = null;
      let isTyping = false;
      thoughts.forEach((t, idx) => {
        // If it's the last, treat as typing if not a completion
        isTyping = (idx === thoughts.length - 1);
        // Try to parse partialArgs for creativity
        let parsed = parsePartialArgs(t.partialArgs);
        if (parsed && typeof parsed === 'object') {
          if (parsed.query) {
            combinedContent += `<div><b>Command:</b> <span class='thought-cmd'>${parsed.query}</span></div>`;
          }
          if (parsed.url) {
            combinedContent += `<div><b>URL:</b> <a href='${parsed.url}' target='_blank' class='thought-url'>${parsed.url}</a></div>`;
          }
          Object.keys(parsed).forEach(k => {
            if (k !== 'query' && k !== 'url') {
              combinedContent += `<div><b>${k}:</b> <span class='thought-field'>${JSON.stringify(parsed[k])}</span></div>`;
            }
          });
          lastParsed = parsed;
        } else {
          combinedContent += `<div>${t.content}</div>`;
        }
      });
      // Tooltip for raw JSON
      let tooltip = thoughts.length ? `<span class='thought-tooltip' title='${thoughts.map(t => t.partialArgs ? (typeof t.partialArgs === 'string' ? t.partialArgs.replace(/'/g, '&apos;') : JSON.stringify(t.partialArgs)) : '').join('\n')}'>🛈</span>` : '';
      let bubble = document.createElement('div');
      bubble.className = 'thought-bubble creative-bubble' + (isTyping ? ' typing' : '');
      bubble.innerHTML = `<div class="thought-title"><i class="fas fa-brain"></i>AI Thought</div><div class="thought-text">${combinedContent}${tooltip}${isTyping ? '<span class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>' : ''}</div>`;
      timelineContainer.appendChild(bubble);
      // Auto-scroll to bottom for smoothness
      timelineContainer.scrollTop = timelineContainer.scrollHeight;
    }
  }

  // --- Helper: Render Intermediate Results ---
  function renderIntermediateResults(taskId) {
    const container = document.getElementById('intermediate-results-container');
    if (!container) return;
    container.innerHTML = '';
    const results = tasksStore.getIntermediateResults(taskId) || [];
    results.forEach((res, idx) => {
      const el = document.createElement('div');
      el.className = 'intermediate-result-item';
      let isFinal = res && res.__final;
      let pretty = '';
      if (typeof res === 'object') {
        pretty = `<pre>${JSON.stringify(res, null, 2)}</pre>`;
      } else {
        pretty = `<span>${res}</span>`;
      }
      el.innerHTML = `<span class='step-icon'>${isFinal ? '✅' : '⏳'}</span> <span class='step-label'>${isFinal ? 'Final Result' : 'Step ' + (idx + 1)}</span>${pretty}<span class='result-tooltip' title='${typeof res === 'object' ? JSON.stringify(res).replace(/'/g, '&apos;') : res}'>🛈</span>`;
      if (isFinal) el.classList.add('final-result');
      container.appendChild(el);
    });
    // Always scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  // --- Event Handlers ---

  // --- Register eventBus listeners (after DOM ready) ---
  document.addEventListener('DOMContentLoaded', () => {
    eventBus.on('functionCallPartial', handleFunctionCallPartial);
    eventBus.on('thoughtUpdate', handleThoughtUpdate);
    eventBus.on('thoughtComplete', handleThoughtComplete);
    eventBus.on('intermediateResult', handleIntermediateResult);
    eventBus.on('taskComplete', handleTaskComplete);
  });

  // --- Also call renderers on mount, in case of hot reload ---
  setTimeout(() => {
    renderThoughtBubbles();
    // If you want to auto-render for last active task:
    const lastTaskId = Object.keys(intermediateResults).slice(-1)[0];
    if (lastTaskId) renderIntermediateResults(lastTaskId);
  }, 200);

  // Subscribe
  console.debug('[DEBUG] CommandCenter: registering eventBus listeners for chat and AI events');
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
    const container = document.getElementById('intermediate-results-container');
    if (!container) return;

    const results = tasksStore.getIntermediateResults(taskId) || [];
    container.innerHTML = '';

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

  // Expose public methods
  container.setActiveTab = (tabType) => {
    if (tabs.some(tab => tab.id === tabType)) {
      activeTab = tabType;
      
      // Update UI
      tabButtons.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.taskType === activeTab);
      });
      
      showActiveSection(activeTab);
      
      // Update store
      uiStore.setState({ activeTab });
    }
  };
  
  // Cleanup method
  container.destroy = destroy;

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
