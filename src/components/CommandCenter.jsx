/**
 * Command Center Component
 * Centralized input area for chat messages and commands
 */

import { eventBus } from '../utils/events.js';
import { uiStore, messagesStore } from '../store/index.js';
import { submitNLI } from '../api/nli.js';
import { getActiveTasks, cancelTask } from '../api/tasks.js';
import Button from './base/Button.jsx';

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
  card.className = 'card';
  card.id = 'task-input-card';

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
      // Send message to API (modularized)
      const response = await submitNLI(inputText);
      
      if (response.success && response.assistantReply) {
        // Add assistant response to timeline
        const assistantMessage = {
          role: 'assistant',
          type: 'chat',
          content: response.assistantReply,
          timestamp: new Date()
        };
        
        // Update store with response
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
  
  // Create send button
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'btn btn-unified-send';
  sendBtn.id = 'unified-send-btn';
  sendBtn.title = 'Send';
  sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
  
  inputBar.appendChild(textarea);
  inputBar.appendChild(sendBtn);
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
  activeTasksContainer.innerHTML = `
    <p id="no-active-tasks" class="text-muted">
      No active tasks. Run a task to see it here.
    </p>
  `;
  
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

  // Function to show active section
  function showActiveSection(tabType) {
    taskSections.querySelectorAll('.task-section').forEach(section => {
      const isActive = (
        (tabType === TAB_TYPES.NLI && section.id === 'unified-input-section') ||
        (tabType === TAB_TYPES.ACTIVE_TASKS && section.id === 'active-tasks-section') ||
        (tabType === TAB_TYPES.MANUAL && section.id === 'manual-section') ||
        (tabType === TAB_TYPES.REPETITIVE && section.id === 'repetitive-section') ||
        (tabType === TAB_TYPES.SCHEDULED && section.id === 'scheduled-section')
      );
      
      section.classList.toggle('active', isActive);
    });
  }

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

  // Method to check for active tasks
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
              try {
                await cancelTask(task._id);
                taskEl.remove();
                
                // Check if empty
                if (activeTasksContainer.children.length === 0) {
                  activeTasksContainer.innerHTML = `
                    <p id="no-active-tasks" class="text-muted">
                      No active tasks. Run a task to see it here.
                    </p>
                  `;
                }
              } catch (error) {
                console.error('Failed to cancel task:', error);
              }
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
    unsubscribe();
    clearInterval(taskPollInterval);
    
    // Remove event listeners
    tabButtons.querySelectorAll('.tab-btn').forEach(btn => {
      btn.removeEventListener('click', null);
    });
    
    nliForm.removeEventListener('submit', null);
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
