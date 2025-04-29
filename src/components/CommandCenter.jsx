/**
 * Command Center Component
 * Centralized input area for chat messages and commands
 */

import { eventBus } from '../utils/events.js';
import { uiStore, messagesStore, tasksStore } from '../store/index.js';
import { submitNLI } from '../api/nli.js';
import { getActiveTasks, cancelTask, createTask } from '../api/tasks.js';
import Button from './base/Button.jsx';
import Dropdown from './base/Dropdown.jsx';

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

  // Load messages once we have a valid userId
  function setupMessageLoading() {
    // Remove any existing watcher
    clearInterval(window.commandCenterMessageWatcher);

    // Create new watcher
    window.commandCenterMessageWatcher = setInterval(async () => {
      try {
        // First check if we have a valid session
        const sessionResponse = await fetch('/api/whoami', {
          credentials: 'include'
        });
        
        if (!sessionResponse.ok) {
          console.error('Session check failed:', sessionResponse.status);
          return;
        }

        const sessionData = await sessionResponse.json();
        const userId = sessionData.userId;
        
        if (userId) {
          clearInterval(window.commandCenterMessageWatcher);
          
          // Now we have a userId, load messages with cache busting
          try {
            const cacheBust = Date.now();
            const messagesResponse = await fetch(`/messages?limit=100&cache=${cacheBust}`, {
              credentials: 'include',
              headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Accept': 'application/json'
              }
            });
            
            if (!messagesResponse.ok) {
              const errorText = await messagesResponse.text();
              console.error('Messages request failed:', messagesResponse.status, errorText);
              return;
            }
            
            const contentType = messagesResponse.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              const text = await messagesResponse.text();
              console.error('Response is not JSON:', contentType, text);
              return;
            }
            
            const data = await messagesResponse.json();
            if (data.success && data.messages) {
              // Update messagesStore with complete state
              messagesStore.setState({ 
                timeline: data.messages,
                loading: false,
                error: null
              });
              // Also update localStorage with latest messages
              localStorage.setItem('messages_timeline', JSON.stringify(data.messages));
            } else {
              console.error('Invalid response format:', data);
              return;
            }
          } catch (error) {
            console.error('Error loading messages:', error);
            // Fallback to localStorage if available
            const savedMessages = localStorage.getItem('messages_timeline');
            if (savedMessages) {
              try {
                const messages = JSON.parse(savedMessages);
                messagesStore.setState({ 
                  timeline: messages,
                  loading: false,
                  error: null
                });
              } catch (e) {
                console.error('Error using localStorage fallback:', e);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error checking user info:', error);
      }
    }, 1000);
  }

  // Start watching for userId
  setupMessageLoading();

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
    { id: TAB_TYPES.ACTIVE_TASKS, label: 'Active Tasks', icon: 'fa-spinner fa-spin' },
    { id: TAB_TYPES.MANUAL, label: 'General Task', icon: 'fa-tasks' },
    { id: TAB_TYPES.REPETITIVE, label: 'Repetitive', icon: 'fa-sync' },
    { id: TAB_TYPES.SCHEDULED, label: 'Scheduled', icon: 'fa-calendar' }
  ];

  // Current active tab
  let activeTab = initialTab;

  // WebSocket State
  let ws = null;
  let wsConnected = false;
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
        const oldUserId = localStorage.getItem('userId');
        localStorage.setItem('userId', data.userId);
        sessionStorage.setItem('userId', data.userId);
        console.debug('[DEBUG] syncUserIdWithBackend: Synced userId from /api/whoami:', data.userId);
        if (oldUserId !== data.userId) {
          console.debug('[DEBUG] syncUserIdWithBackend: userId changed, will re-init WebSocket');
          if (window._ws && typeof window._ws.close === 'function') {
            window._ws.close();
          }
          initWebSocket(data.userId);
        }
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
        console.error('[DEBUG] CommandCenter: Error creating WebSocket object:', e);
        return; // Stop if creation fails
    }

    ws.onopen = () => {
      console.log(`[DEBUG] CommandCenter: WebSocket ONOPEN event for userId=${userId}`);
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

          // Update content
          thoughtContainer.textContent = content;

          // Handle completion
          if (message.completed) {
            thoughtContainer.classList.remove('loading');
            
            // Add completion animation
            thoughtContainer.style.animation = 'pulse 1.5s infinite';
            
            // Emit completion event
            eventBus.emit('thought_completed', {
              taskId: message.task_id,
              content: content,
              url: message.url
            });
          }
        }

        // Handle other message types
        if (message.event) {
          eventBus.emit(message.event, message);
        }

        // Handle legacy types
        if (message.type && message.payload) {
          console.log(`CommandCenter: Emitting legacy type '${message.type}' event via eventBus`);
          eventBus.emit(message.type, message.payload);
        }
      } catch (error) {
        console.error('WebSocket message handling error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[DEBUG] CommandCenter: WebSocket ONERROR event:', error);
      // The 'close' event handler will manage reconnection logic.
    };

    ws.onclose = (event) => {
      console.log(`[DEBUG] CommandCenter: WebSocket ONCLOSE event. Code: ${event.code}, Reason: '${event.reason}'. Clean close: ${event.wasClean}`);
      wsConnected = false;
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
      
      // Show active section
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
      const now = Date.now();
      if (now - lastEventTs < 200) return; // throttle updates to 200ms
      lastEventTs = now;
      try {
        const update = JSON.parse(e.data);
        tasksStore.updateTask(taskId, update);
        if (update.done) {
          es.close(); // stop this source
          tasksStore.closeStream(taskId);
        }
      } catch (err) {
        console.error('Failed parsing SSE data for task', taskId, err);
      }
    };
    es.onerror = (err) => {
      errorCount++;
      console.warn(`SSE error on task ${taskId}:`, err);
      if (errorCount < maxErrors) {
        eventBus.emit('notification', { message: `Connection lost for task ${taskId}, retrying... (${errorCount}/${maxErrors})`, type: 'warning' });
      } else {
        eventBus.emit('notification', { message: `Real-time failures detected; switching to polling for task ${taskId}.`, type: 'error' });
        es.close();
        tasksStore.closeStream(taskId);
        subscribeToTaskPolling(taskId);
      }
    };
  }

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
  
  nliSection.appendChild(nliForm);
  taskSections.appendChild(nliSection);
  
  // 2. Active Tasks Section
  const activeTasksSection = document.createElement('div');
  activeTasksSection.className = 'task-section';
  activeTasksSection.id = 'active-tasks-section';
  if (activeTab === TAB_TYPES.ACTIVE_TASKS) activeTasksSection.classList.add('active');
  
  // Add subtabs
  const subtabs = document.createElement('div');
  subtabs.className = 'active-tasks-subtabs';
  
  ['Active', 'Scheduled', 'Repetitive'].forEach((tabName, index) => {
    const subtabBtn = document.createElement('button');
    subtabBtn.className = `tab-btn ${index === 0 ? 'active' : ''}`;
    subtabBtn.dataset.subtab = tabName.toLowerCase();
    subtabBtn.textContent = tabName;
    
    subtabBtn.addEventListener('click', () => {
      // Update active subtab
      subtabs.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subtab === subtabBtn.dataset.subtab);
      });
      
      // Show active content
      activeTasksSection.querySelectorAll('.subtab-content').forEach(content => {
        content.classList.toggle('active', content.id === `${subtabBtn.dataset.subtab}-tasks-content`);
      });
      
      // Update store
      uiStore.setState({ activeSubtab: subtabBtn.dataset.subtab });
    });
    
    subtabs.appendChild(subtabBtn);
  });
  
  activeTasksSection.appendChild(subtabs);
  
  // Active tasks content
  const activeTasksContent = document.createElement('div');
  activeTasksContent.id = 'active-tasks-content';
  activeTasksContent.className = 'subtab-content active';
  
  const activeTasksContainer = document.createElement('div');
  activeTasksContainer.id = 'active-tasks-container';
  
  activeTasksContent.appendChild(activeTasksContainer);
  activeTasksSection.appendChild(activeTasksContent);
  
  // Scheduled tasks content
  const scheduledTasksContent = document.createElement('div');
  scheduledTasksContent.id = 'scheduled-tasks-content';
  scheduledTasksContent.className = 'subtab-content';
  scheduledTasksContent.innerHTML = `
    <div id="scheduled-tasks-container">
      <p id="no-scheduled-tasks" class="text-muted">
        No scheduled tasks. Use the Scheduled Task tab to create one.
      </p>
    </div>
  `;
  
  activeTasksSection.appendChild(scheduledTasksContent);
  
  // Repetitive tasks content
  const repetitiveTasksContent = document.createElement('div');
  repetitiveTasksContent.id = 'repetitive-tasks-content';
  repetitiveTasksContent.className = 'subtab-content';
  repetitiveTasksContent.innerHTML = `
    <div id="repetitive-tasks-container">
      <p id="no-repetitive-tasks" class="text-muted">
        No repetitive tasks. Use the Repetitive Task tab to create one.
      </p>
    </div>
  `;
  
  activeTasksSection.appendChild(repetitiveTasksContent);
  taskSections.appendChild(activeTasksSection);
  
  // Render active tasks into container
  function renderActiveTasksList({ active }) {
    // Clear container
    activeTasksContainer.innerHTML = '';
    if (!active || active.length === 0) {
      activeTasksContainer.innerHTML = '<p id="no-active-tasks" class="text-muted">No active tasks. Run a task to see it here.</p>';
      return;
    }
    active.forEach(task => {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.id = `task-${task._id}`;

      // Header with command and cancel
      const header = document.createElement('div');
      header.className = 'task-card-header';
      const cmd = document.createElement('span');
      cmd.className = 'task-command';
      cmd.textContent = task.command;
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'task-cancel-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', async () => {
        await handleTaskCancel(task._id);
      });
      header.append(cmd, cancelBtn);

      // Progress bar
      const progressContainer = document.createElement('div');
      progressContainer.className = 'task-progress-container';
      const progressBar = document.createElement('progress');
      progressBar.value = task.progress || 0;
      progressBar.max = 100;
      const progressText = document.createElement('span');
      progressText.textContent = `${task.progress || 0}%`;
      progressContainer.append(progressBar, progressText);

      // Status
      const status = document.createElement('div');
      status.className = 'task-status';
      status.textContent = task.status;

      // Detail (result or error)
      let detail;
      if (task.status === 'completed' || task.status === 'error') {
        detail = document.createElement('pre');
        detail.className = task.status === 'error' ? 'task-error' : 'task-result';
        detail.textContent = task.status === 'error' ? task.error : JSON.stringify(task.result, null, 2);
      }

      // Assemble card
      card.append(header, progressContainer, status);
      if (detail) card.appendChild(detail);
      activeTasksContainer.appendChild(card);
    });
  }

  // Subscribe to store updates and initial render
  tasksStore.subscribe(renderActiveTasksList);
  renderActiveTasksList(tasksStore.getState());

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

  // Function to check for active tasks
  async function checkActiveTasks() {
    try {
      const response = await getActiveTasks();
      
      if (response && Array.isArray(response.tasks)) {
        const activeTasks = response.tasks;
        
        // Update no-tasks message visibility
        const noTasksEl = document.getElementById('no-active-tasks');
        if (noTasksEl) {
          noTasksEl.style.display = activeTasks.length > 0 ? 'none' : 'block';
        }
        
        // Clear container
        if (activeTasks.length > 0) {
          activeTasksContainer.innerHTML = '';
          
          // Add each task
          activeTasks.forEach(task => {
            const taskEl = document.createElement('div');
            taskEl.className = 'active-task';
            taskEl.dataset.taskId = task._id;
            
            // Calculate progress percentage
            const progress = Math.min(Math.max(task.progress || 0, 0), 100);
            
            taskEl.innerHTML = `
              <div class="task-header">
                <h4><i class="fas fa-spinner fa-spin"></i> ${task.command}</h4>
                <span class="task-status ${task.status}">${task.status}</span>
              </div>
              <div class="task-url">
                <i class="fas fa-globe"></i> ${task.url || 'No URL'}
              </div>
              <div class="task-progress-container">
                <div class="task-progress" style="width: ${progress}%"></div>
              </div>
              <div class="task-actions">
                <button class="cancel-task-btn" data-task-id="${task._id}">
                  <i class="fas fa-times"></i> Cancel
                </button>
              </div>
            `;
            
            // Add cancel handler
            const cancelBtn = taskEl.querySelector('.cancel-task-btn');
            cancelBtn.addEventListener('click', async () => {
              await handleTaskCancel(task._id);
            });
            
            activeTasksContainer.appendChild(taskEl);
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch active tasks:', error);
    }
  }

  // Poll for active tasks every 5 seconds
  const taskPollInterval = setInterval(checkActiveTasks, 5000);
  
  // Initial check
  checkActiveTasks();

  // Subscribe to store changes
  const unsubscribe = uiStore.subscribe((state) => {
    if (state.activeTab !== activeTab) {
      activeTab = state.activeTab;
      
      // Update UI
      tabButtons.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.taskType === activeTab);
      });
      
      showActiveSection(activeTab);
    }
  });

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
  container.destroy = () => {
    console.log('Destroying CommandCenter...');
    // Close WebSocket connection if open
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('CommandCenter: Closing WebSocket connection cleanly.');
        ws.close(1000, 'Component destroying'); // Use code 1000 for clean closure
    }
    // Close all SSE streams
    const streams = tasksStore.getState().streams;
    Object.keys(streams).forEach(taskId => tasksStore.closeStream(taskId));
    // Remove event listeners
    tabButtons.querySelectorAll('.tab-btn').forEach(btn => btn.replaceWith(btn.cloneNode(true)));
    nliForm.replaceWith(nliForm.cloneNode(true));
    clearInterval(taskPollInterval);
    unsubscribe();
  };

  // Handle form submission
  nliForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const inputText = textarea.value.trim();
    if (!inputText) return;
    
    // Clear input
    textarea.value = '';
    
    // Add user message to timeline
    const userMessage = {
      role: 'user',
      type: 'chat',
      content: inputText,
      timestamp: new Date()
    };
    
    // Add to store
    const { timeline } = messagesStore.getState();
    messagesStore.setState({ timeline: [...timeline, userMessage] });
    
    try {
      eventBus.emit('notification', { message: 'Task started – please wait...', type: 'success' });
      const response = await submitNLIWithUserId(inputText);
      if (response.success && response.taskId) {
        // TASK branch: switch UI, load tasks, subscribe to SSE
        const taskId = response.taskId;
        activeTab = TAB_TYPES.ACTIVE_TASKS;
        tabButtons.querySelectorAll('.tab-btn')
          .forEach(btn => btn.classList.toggle('active', btn.dataset.taskType === activeTab));
        showActiveSection(activeTab);
        uiStore.setState({ activeTab });
        const tasksResp = await getActiveTasks();
        if (tasksResp.tasks) {
          tasksStore.setActiveTasks(tasksResp.tasks);
          tasksResp.tasks.forEach(t => subscribeToTaskStream(t._id));
        }
      } else if (response.success && response.assistantReply) {
        // CHAT branch: original response handling
        const assistantMessage = { role: 'assistant', type: 'chat', content: response.assistantReply, timestamp: new Date() };
        const { timeline } = messagesStore.getState();
        messagesStore.setState({ timeline: [...timeline, assistantMessage] });
      } else {
        throw new Error(response.error || 'Failed to get response');
      }
    } catch (error) {
      console.error('Chat error:', error);
      
      // Add error message
      const errorMessage = {
        role: 'system',
        type: 'error',
        content: 'Failed to send message',
        error: error.message,
        timestamp: new Date()
      };
      
      // Update store with error
      const { timeline } = messagesStore.getState();
      messagesStore.setState({ timeline: [...timeline, errorMessage] });
    }
  });

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

  // --- Initialize WebSocket after component and eventBus setup ---
  (async () => {
    const currentUserId = await syncUserIdWithBackend();
    console.debug('[DEBUG] Initializing WebSocket with userId:', currentUserId);
    if (currentUserId) {
      initWebSocket(currentUserId);
    } else {
      console.warn('CommandCenter: userId not found or created. WebSocket not initialized.');
    }
  })();

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
    // Update the specific task in the store with URL and screenshot
    tasksStore.updateTask(payload.taskId, {
      currentUrl: payload.result?.currentUrl,
      screenshotUrl: payload.result?.screenshotUrl
    });
    if (!payload.taskId) return;
    if (!intermediateResults[payload.taskId]) intermediateResults[payload.taskId] = [];
    intermediateResults[payload.taskId].push(payload.result);
    renderIntermediateResults(payload.taskId);
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
    // Update the specific task in the store with new progress and message
    tasksStore.updateTask(payload.taskId, { 
      progress: payload.progress, 
      lastStepMessage: payload.message || 'Processing...', // Store the latest step message
      status: 'processing' // Ensure status reflects activity
     });
  };

  const handleTaskStart = (payload) => {
    console.log('eventBus received taskStart:', payload);
    // Logic to handle task start
  };

  const handleTaskComplete = (payload) => {
    console.log('eventBus received taskComplete:', payload);
    // Update task status to completed in the store
    tasksStore.updateTask(payload.taskId, { 
      status: 'completed', 
      progress: 100, 
      result: payload.result,
      lastStepMessage: 'Completed'
    });
    if (!payload.taskId) return;
    if (!intermediateResults[payload.taskId]) intermediateResults[payload.taskId] = [];
    let finalRes = payload.result;
    if (typeof finalRes === 'object') finalRes = { ...finalRes, __final: true };
    else finalRes = { value: finalRes, __final: true };
    intermediateResults[payload.taskId].push(finalRes);
    renderIntermediateResults(payload.taskId);
  };

  const handleTaskError = (payload) => {
    console.error('eventBus received taskError:', payload);
    // Update task status to error in the store
    tasksStore.updateTask(payload.taskId, { 
      status: 'error', 
      progress: 0, // Or keep last known progress?
      error: payload.error,
      lastStepMessage: `Error: ${payload.error}`.substring(0, 100) + '...'
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
    const results = intermediateResults[taskId] || [];
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
  eventBus.on('chat_response_stream', handleChatResponse);
  eventBus.on('ai_thought_stream', handleAiThought); 
  eventBus.on('intermediateResult', handleIntermediateResult);
  eventBus.on('functionCallPartial', handleFunctionCallPartial);
  eventBus.on('thoughtUpdate', handleThoughtUpdate); 
  eventBus.on('thoughtComplete', handleThoughtComplete); 
  eventBus.on('stepProgress', handleStepProgress);
  eventBus.on('taskStart', handleTaskStart);
  eventBus.on('taskComplete', handleTaskComplete);
  eventBus.on('taskError', handleTaskError);

  // Example for submitNLI:
  const submitNLIWithUserId = async (inputText) => {
    const userId = await getOrSyncUserId();
    console.debug('[DEBUG] submitNLIWithUserId: Using userId', userId, 'with inputText', inputText);
    // Only send string inputText and userId
    return submitNLI(inputText);
  };

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
