/**
 * Task Bar Component
 * Displays active tasks and system status information
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.jsx';
import { getActiveTasks, cancelTask as cancelTaskApi } from '../api/tasks.js';
const tasksStore = stores.tasks;
const stepLogs = tasksStore.getState().stepLogs;

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
  let intermediateResults = {};
  let expanded = false;
  
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
  
  // Create tasks section (summary/count)
  const tasksSection = document.createElement('div');
  tasksSection.className = 'task-bar-tasks';
  
  // Create controls section
  const controlsSection = document.createElement('div');
  controlsSection.className = 'task-bar-controls';
  
  // Minimize button
  const minimizeButton = Button({
    icon: 'fa-chevron-up',
    variant: Button.VARIANTS.TEXT,
    className: 'task-bar-control',
    title: 'Expand Tasks',
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
  
  // Assemble layout
  container.appendChild(statusSection);
  container.appendChild(tasksSection);
  container.appendChild(controlsSection);

  // Expose public methods
  container.getActiveTasks = () => [...activeTasks];
  
  /**
   * Toggle minimized state
   */
  function toggleMinimized() {
    expanded = !expanded;
    tasksSection.classList.toggle('expanded', expanded);
    if (expanded) {
      // align popup flush with TaskBar edge
      tasksSection.style.left = '0px';
      tasksSection.style.minWidth = '';
    } else {
      // reset inline styles
      tasksSection.style.left = '';
      tasksSection.style.minWidth = '';
    }
    // Update icon
    const icon = minimizeButton.querySelector('i');
    if (icon) {
      icon.className = `fas ${expanded ? 'fa-chevron-down' : 'fa-chevron-up'}`;
    }
    minimizeButton.title = expanded ? 'Collapse Tasks' : 'Expand Tasks';
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
      taskItem.className = 'task-bar-task-item';
      
      // Compute progress bars
      const overallProgress = Math.min(Math.max(task.progress || 0, 0), 100);
      const logsForTask = stepLogs[task._id] || [];
      const latestStep = logsForTask.filter(l => l.progress !== undefined).slice(-1)[0] || {};
      const stepProgress = latestStep.progress || 0;
      
      taskItem.innerHTML = `
        <div class="task-icon"><i class="fas ${getTaskIcon(task.type)}"></i></div>
        <div class="task-content">
          <div class="task-title">${getTaskTitle(task)}</div>
          <div class="task-progress-container dual">
            <div class="task-progress-overall" style="width: ${overallProgress}%"></div>
            <div class="task-progress-step" style="width: ${stepProgress}%"></div>
          </div>
        </div>
        <div class="task-actions">
          <button class="task-action cancel-task" title="Cancel Task">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
      
      // Render step logs
      if (logsForTask.length) {
        const logContainer = document.createElement('div');
        logContainer.className = 'task-step-logs';
        logsForTask.forEach(entry => {
          const entryEl = document.createElement('div');
          entryEl.className = 'task-step-log-entry';
          let text = '';
          if (entry.stepIndex !== undefined) text = `Step ${entry.stepIndex}: ${entry.message}`;
          else if (entry.type === 'functionCallPartial') text = `Function ${entry.functionName} called with ${JSON.stringify(entry.args)}`;
          else if (entry.type === 'planLog') text = entry.message;
          else if (entry.type === 'taskComplete') text = `Complete: ${entry.result.summary || JSON.stringify(entry.result)}`;
          else if (entry.type === 'taskError') text = `Error: ${entry.error}`;
          entryEl.textContent = text;
          logContainer.appendChild(entryEl);
        });
        taskItem.appendChild(logContainer);
      }
      
      // Render intermediate screenshots
      const items = intermediateResults[task._id] || [];
      if (items.length) {
        const interContainer = document.createElement('div');
        interContainer.className = 'intermediate-results';
        items.forEach((item, idx) => {
          const img = document.createElement('img');
          img.src = item.screenshotUrl;
          img.alt = `Step ${idx+1}`;
          img.title = `Step ${idx+1}`;
          interContainer.appendChild(img);
        });
        taskItem.appendChild(interContainer);
      }
      
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
      await cancelTaskApi(taskId);
      
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
   * Initialize the component
   */
  function initialize() {
    // Subscribe to tasksStore for active tasks & intermediate results
    activeTasks = tasksStore.getState().active;
    intermediateResults = tasksStore.getState().intermediateResults;
    updateTasks();
    const unsubscribe = tasksStore.subscribe(state => {
      activeTasks = state.active;
      intermediateResults = state.intermediateResults;
      updateTasks();
    });
    return () => unsubscribe();
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
  
  container.refreshTasks = () => updateTasks();
  
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
