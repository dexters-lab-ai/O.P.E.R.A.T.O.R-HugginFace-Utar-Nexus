/**
 * Task Bar Component
 * Displays active tasks and system status information
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.js';
import api from '../utils/api.js';

/**
 * Create a task bar component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Task bar container
 */
export function TaskBar(props = {}) {
  const {
    containerId = 'task-bar',
    position = 'bottom'
  } = props;

  // State
  let isMinimized = false;
  let activeTasks = [];
  
  // Create component container
  const container = document.createElement('div');
  container.className = `task-bar position-${position}`;
  if (containerId) container.id = containerId;
  
  // Create status section
  const statusSection = document.createElement('div');
  statusSection.className = 'task-bar-status';
  
  // System status indicator
  const systemStatus = document.createElement('div');
  systemStatus.className = 'status-item system-status';
  systemStatus.innerHTML = `
    <i class="fas fa-server"></i>
    <span class="status-label">System</span>
    <span class="status-value">Online</span>
    <span class="status-indicator online"></span>
  `;
  
  // Connection status indicator
  const connectionStatus = document.createElement('div');
  connectionStatus.className = 'status-item connection-status';
  connectionStatus.innerHTML = `
    <i class="fas fa-wifi"></i>
    <span class="status-label">Connection</span>
    <span class="status-value">Stable</span>
    <span class="status-indicator online"></span>
  `;
  
  // Add status items
  statusSection.appendChild(systemStatus);
  statusSection.appendChild(connectionStatus);
  
  // Create tasks section
  const tasksSection = document.createElement('div');
  tasksSection.className = 'task-bar-tasks';
  
  // Create controls section
  const controlsSection = document.createElement('div');
  controlsSection.className = 'task-bar-controls';
  
  // Minimize button
  const minimizeButton = Button({
    icon: 'fa-chevron-down',
    variant: Button.VARIANTS.TEXT,
    className: 'task-bar-control',
    title: 'Minimize Task Bar',
    onClick: () => {
      toggleMinimized();
    }
  });
  
  // Task count indicator
  const taskCount = document.createElement('div');
  taskCount.className = 'task-count';
  taskCount.innerHTML = `
    <i class="fas fa-tasks"></i>
    <span class="count">0</span>
  `;
  
  controlsSection.appendChild(taskCount);
  controlsSection.appendChild(minimizeButton);
  
  // Assemble task bar
  container.appendChild(statusSection);
  container.appendChild(tasksSection);
  container.appendChild(controlsSection);
  
  /**
   * Toggle minimized state
   */
  function toggleMinimized() {
    isMinimized = !isMinimized;
    
    // Update UI
    container.classList.toggle('minimized', isMinimized);
    
    // Update icon
    const icon = minimizeButton.querySelector('i');
    if (icon) {
      icon.className = `fas ${isMinimized ? 'fa-chevron-up' : 'fa-chevron-down'}`;
    }
    
    // Update button title
    minimizeButton.title = isMinimized ? 'Expand Task Bar' : 'Minimize Task Bar';
    
    // Update store
    stores.ui.setState({ taskBarMinimized: isMinimized });
  }
  
  /**
   * Update active tasks display
   */
  function updateTasks() {
    // Clear tasks section
    tasksSection.innerHTML = '';
    
    // Update task count
    const countElement = taskCount.querySelector('.count');
    if (countElement) {
      countElement.textContent = activeTasks.length;
    }
    
    // Show empty state if no tasks
    if (activeTasks.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-tasks';
      emptyState.textContent = 'No active tasks';
      tasksSection.appendChild(emptyState);
      return;
    }
    
    // Add task items
    activeTasks.forEach(task => {
      const taskItem = document.createElement('div');
      taskItem.className = `task-item ${task.status || 'running'}`;
      taskItem.dataset.taskId = task._id;
      
      // Calculate progress percentage
      const progress = Math.min(Math.max(task.progress || 0, 0), 100);
      
      // Task content
      taskItem.innerHTML = `
        <div class="task-icon">
          <i class="fas ${getTaskIcon(task.type)}"></i>
        </div>
        <div class="task-content">
          <div class="task-title">${getTaskTitle(task)}</div>
          <div class="task-progress-container">
            <div class="task-progress" style="width: ${progress}%"></div>
          </div>
        </div>
        <div class="task-actions">
          <button class="task-action cancel-task" title="Cancel Task">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
      
      // Add cancel handler
      const cancelButton = taskItem.querySelector('.cancel-task');
      cancelButton.addEventListener('click', () => {
        cancelTask(task._id);
      });
      
      tasksSection.appendChild(taskItem);
    });
  }
  
  /**
   * Get icon for task type
   * @param {string} taskType - Type of task
   * @returns {string} Icon class
   */
  function getTaskIcon(taskType) {
    switch (taskType) {
      case 'command':
        return 'fa-terminal';
      case 'background':
        return 'fa-layer-group';
      case 'scheduled':
        return 'fa-calendar';
      case 'repetitive':
        return 'fa-sync';
      default:
        return 'fa-tasks';
    }
  }
  
  /**
   * Get display title for task
   * @param {Object} task - Task object
   * @returns {string} Display title
   */
  function getTaskTitle(task) {
    // Use command or description if available
    if (task.command) {
      // Truncate long commands
      return task.command.length > 30 
        ? task.command.substring(0, 30) + '...' 
        : task.command;
    }
    
    if (task.description) {
      return task.description;
    }
    
    // Fallback to task type
    switch (task.type) {
      case 'command':
        return 'Command Task';
      case 'background':
        return 'Background Task';
      case 'scheduled':
        return 'Scheduled Task';
      case 'repetitive':
        return 'Repetitive Task';
      default:
        return 'Task';
    }
  }
  
  /**
   * Cancel a task
   * @param {string} taskId - ID of task to cancel
   */
  async function cancelTask(taskId) {
    try {
      // Send cancel request
      await api.tasks.cancel(taskId);
      
      // Remove from active tasks
      activeTasks = activeTasks.filter(task => task._id !== taskId);
      
      // Update UI
      updateTasks();
      
      // Notify success
      eventBus.emit('notification', {
        message: 'Task cancelled successfully',
        type: 'success'
      });
    } catch (error) {
      console.error('Failed to cancel task:', error);
      
      // Notify error
      eventBus.emit('notification', {
        message: 'Failed to cancel task',
        type: 'error'
      });
    }
  }
  
  /**
   * Update system status
   * @param {Object} status - System status object
   */
  function updateSystemStatus(status) {
    const statusValue = systemStatus.querySelector('.status-value');
    const statusIndicator = systemStatus.querySelector('.status-indicator');
    
    if (statusValue && statusIndicator) {
      const isOnline = status.status === 'online' || status.status === 'operational';
      
      statusValue.textContent = capitalizeFirstLetter(status.status || 'Unknown');
      statusIndicator.className = `status-indicator ${isOnline ? 'online' : 'offline'}`;
    }
  }
  
  /**
   * Update connection status
   * @param {Object} status - Connection status object
   */
  function updateConnectionStatus(status) {
    const statusValue = connectionStatus.querySelector('.status-value');
    const statusIndicator = connectionStatus.querySelector('.status-indicator');
    
    if (statusValue && statusIndicator) {
      const isStable = status.status === 'stable' || status.status === 'connected';
      
      statusValue.textContent = capitalizeFirstLetter(status.status || 'Unknown');
      statusIndicator.className = `status-indicator ${isStable ? 'online' : 'warning'}`;
    }
  }
  
  /**
   * Capitalize first letter of string
   * @param {string} string - String to capitalize
   * @returns {string} Capitalized string
   */
  function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
  
  /**
   * Fetch active tasks from API
   */
  async function fetchActiveTasks() {
    try {
      const response = await api.tasks.getActive();
      
      if (response && Array.isArray(response.tasks)) {
        activeTasks = response.tasks;
        updateTasks();
      }
    } catch (error) {
      console.error('Failed to fetch active tasks:', error);
    }
  }
  
  /**
   * Initialize the component
   */
  function initialize() {
    // Initial tasks update
    updateTasks();
    
    // Fetch active tasks
    fetchActiveTasks();
    
    // Set up task polling
    const taskPollInterval = setInterval(fetchActiveTasks, 5000);
    
    // Set up event listeners
    const unsubscribeTaskAdded = eventBus.on('task-added', (task) => {
      activeTasks.push(task);
      updateTasks();
    });
    
    const unsubscribeTaskUpdated = eventBus.on('task-updated', ({ taskId, status, progress }) => {
      // Update task in array
      activeTasks = activeTasks.map(task => {
        if (task._id === taskId) {
          return { 
            ...task, 
            status: status || task.status, 
            progress: progress !== undefined ? progress : task.progress 
          };
        }
        return task;
      });
      
      // Remove completed tasks
      if (status === 'completed' || status === 'failed') {
        // Keep task visible for a few seconds before removing
        setTimeout(() => {
          activeTasks = activeTasks.filter(task => task._id !== taskId);
          updateTasks();
        }, 3000);
      }
      
      updateTasks();
    });
    
    const unsubscribeTaskRemoved = eventBus.on('task-removed', (taskId) => {
      activeTasks = activeTasks.filter(task => task._id !== taskId);
      updateTasks();
    });
    
    // Subscribe to store changes
    const unsubscribeStore = stores.ui.subscribe((state) => {
      if (state.taskBarMinimized !== undefined && state.taskBarMinimized !== isMinimized) {
        isMinimized = state.taskBarMinimized;
        container.classList.toggle('minimized', isMinimized);
        
        // Update icon
        const icon = minimizeButton.querySelector('i');
        if (icon) {
          icon.className = `fas ${isMinimized ? 'fa-chevron-up' : 'fa-chevron-down'}`;
        }
      }
    });
    
    // Listen for system status updates
    const unsubscribeSystemStatus = eventBus.on('system-status-update', (status) => {
      updateSystemStatus(status);
    });
    
    // Listen for connection status updates
    const unsubscribeConnectionStatus = eventBus.on('connection-status-update', (status) => {
      updateConnectionStatus(status);
    });
    
    // Return cleanup function
    return () => {
      clearInterval(taskPollInterval);
      unsubscribeTaskAdded();
      unsubscribeTaskUpdated();
      unsubscribeTaskRemoved();
      unsubscribeStore();
      unsubscribeSystemStatus();
      unsubscribeConnectionStatus();
    };
  }
  
  // Initialize component
  const cleanup = initialize();
  
  // Expose public methods
  container.minimize = () => {
    if (!isMinimized) {
      toggleMinimized();
    }
  };
  
  container.expand = () => {
    if (isMinimized) {
      toggleMinimized();
    }
  };
  
  container.getActiveTasks = () => [...activeTasks];
  
  container.refreshTasks = fetchActiveTasks;
  
  // Cleanup method
  container.destroy = () => {
    cleanup();
  };

  return container;
}

/**
 * Mount a task bar to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - Task bar properties
 * @returns {HTMLElement} The mounted task bar
 */
TaskBar.mount = (parent, props = {}) => {
  const taskBar = TaskBar(props);
  parent.appendChild(taskBar);
  return taskBar;
};

export default TaskBar;
