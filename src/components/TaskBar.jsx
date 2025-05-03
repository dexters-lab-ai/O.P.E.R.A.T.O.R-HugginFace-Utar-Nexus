/**
 * Task Bar Component
 * Displays active tasks and system status information
 */

// Add styles for step details
const styles = `
  @import url('/node_modules/@fortawesome/fontawesome-free/css/all.min.css');

  .task-step-details {
    margin-top: 10px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }

  .step-info {
    margin-bottom: 10px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  .step-url {
    font-size: 0.9em;
    color: #666;
    margin-bottom: 4px;
  }

  .step-extract {
    font-size: 0.9em;
    line-height: 1.4;
    white-space: pre-wrap;
    max-height: 100px;
    overflow-y: auto;
  }

  .step-logs {
    margin-top: 10px;
  }

  .log-entry {
    padding: 6px 8px;
    margin-bottom: 4px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
  }

  .log-entry:last-child {
    margin-bottom: 0;
  }

  .log-step {
    font-weight: 500;
    color: #4CAF50;
    margin-bottom: 2px;
  }

  .log-info {
    font-size: 0.9em;
    color: #fff;
    line-height: 1.4;
    white-space: pre-wrap;
  }

  .log-url {
    font-size: 0.8em;
    color: #666;
  }

  /* TaskBar tasks full-width expansion */
  .task-bar .task-bar-tasks {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    box-sizing: border-box;
  }

  /* Hide legacy logs container (using creative bubbles instead) */
  .task-step-logs-container {
    visibility: hidden;
  }

  /* Timeline chain for step logs */
  .task-step-logs {
    position: relative;
    padding-left: 1.2rem;
    margin-top: 0.5rem;
  }
  .task-step-logs::before {
    content: '';
    position: absolute;
    left: 0.6rem;
    top: 0;
    bottom: 0;
    width: 2px;
    background: rgba(255, 255, 255, 0.2);
  }
  .task-step-log-entry {
    position: relative;
    margin-bottom: 0.5rem;
    padding-left: 0.6rem;
  }
  .task-step-log-entry::before {
    content: '';
    position: absolute;
    left: -0.2rem;
    top: 0.4rem;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--primary);
    transition: transform 0.3s ease;
  }
  .task-step-log-entry.current::before {
    animation: pulse 1s infinite;
    background: var(--accent);
  }
  .task-step-log-entry.completed::before {
    background: var(--success);
  }
  @keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.4); }
    100% { transform: scale(1); }
  }

  /* Thumbnails for intermediate results */
  .task-thumbnails {
    margin-top: 10px;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .task-thumbnail {
    padding: 0.2rem 0.4rem;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: default;
  }

  /* Futuristic TaskBar item styling */
  .task-bar-task-item {
    display: block;
    position: relative;
    background: linear-gradient(180deg, rgba(20, 25, 40, 0.8) 0%, rgba(30, 35, 60, 0.9) 100%);
    border: 1px solid rgba(95, 110, 255, 0.2);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin: 0.5rem;
    color: #fff;
    font-size: 0.9rem;
    width: calc(100% - 1rem);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(4px);
    transition: all 0.2s ease;
  }
  
  .task-bar-task-item:hover {
    border-color: rgba(95, 110, 255, 0.4);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2), 0 0 8px rgba(95, 110, 255, 0.15);
    transform: translateY(-1px);
  }
  
  /* Compact task strips for minimized view */
  .minimized .task-bar-task-item {
    padding: 0.4rem 0.75rem;
    margin: 0.25rem 0.5rem;
    display: flex;
    align-items: center;
    max-height: 40px;
    overflow: hidden;
    transition: all 0.3s ease;
  }
  
  .minimized .task-bar-task-item strong {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 150px;
  }
  
  .minimized .task-progress-container {
    width: 40px;
    min-width: 40px;
    margin: 0 0.5rem 0 0;
  }
  
  .minimized .task-reports-container,
  .minimized .task-step-logs {
    display: none;
  }

  /* Futuristic progress bar */
  .task-progress-container {
    height: 6px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 0.75rem;
    position: relative;
  }
  
  .task-progress {
    height: 100%;
    background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
    box-shadow: 0 0 8px rgba(95, 47, 255, 0.4);
    transition: width 0.3s ease;
    position: relative;
  }
  
  .task-progress::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
    animation: shimmer 1.5s infinite;
  }
  
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }

  /* Task link style */
  .task-report-link {
    display: inline-block;
    color: var(--primary);
    text-decoration: underline;
    margin-top: 0.5rem;
    font-size: 0.85rem;
  }

  .task-report-link:hover {
    color: var(--accent);
  }

  /* TaskBar container positioning */
  .task-bar.position-bottom {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    background: var(--dark);
    border-radius: 7px;
    padding: 0 0.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.2);
    z-index: 1001;
  }

  .task-bar.position-top {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    background: var(--dark-light);
    padding: 0.5rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    z-index: 1001;
  }

  /* Task reports container */
  .task-reports-container {
    margin-top: 0.5rem;
  }

  .task-reports-title {
    font-size: 0.9rem;
    font-weight: 500;
    margin-bottom: 0.25rem;
  }

  .task-reports-links {
    display: flex;
    gap: 0.5rem;
  }

  .task-report-link.landing-report {
    background: var(--primary);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    color: #fff;
  }

  .task-report-link.detailed-report {
    background: var(--accent);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    color: #fff;
  }
`;

// Add styles to head if not already present
if (!document.getElementById('task-bar-styles')) {
  const style = document.createElement('style');
  style.id = 'task-bar-styles';
  style.textContent = styles;
  document.head.appendChild(style);
}

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.jsx';
import { getActiveTasks, cancelTask as cancelTaskApi } from '../api/tasks.js';
const tasksStore = stores.tasks;

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
  
  // Task count indicator - only show when tasks exist
  const taskCount = document.createElement('div');
  taskCount.className = 'task-count';
  taskCount.style.display = 'none'; // Hide by default
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
   * @param {string} renderSource - Source component that triggered the update
   */
  function updateTasks(renderSource = 'TaskBar') {
    console.debug(`[DEBUG] TaskBar: updateTasks called from ${renderSource}`);
    const tasksSection = container.querySelector('.task-bar-tasks');
    if (!tasksSection) return;
    
    // Get or create containers for running and completed tasks
    let runningTasksContainer = container.querySelector('.running-tasks-container');
    let completedTasksContainer = container.querySelector('.completed-tasks-container');
    
    if (!runningTasksContainer) {
      runningTasksContainer = document.createElement('div');
      runningTasksContainer.className = 'running-tasks-container';
      tasksSection.appendChild(runningTasksContainer);
    }
    
    if (!completedTasksContainer) {
      completedTasksContainer = document.createElement('div');
      completedTasksContainer.className = 'completed-tasks-container';
      completedTasksContainer.innerHTML = '<h4 class="tasks-header">Completed Tasks</h4>';
      tasksSection.appendChild(completedTasksContainer);
    }
    
    // Empty state - just leave the container empty without any message
    if (!activeTasks || activeTasks.length === 0) {
      runningTasksContainer.innerHTML = '';
      // Update task count display - hide it when no tasks
      const taskCount = container.querySelector('.task-count');
      if (taskCount) taskCount.style.display = 'none';
      return;
    }
    
    // Show task count since we have tasks
    const taskCount = container.querySelector('.task-count');
    if (taskCount) {
      taskCount.style.display = 'flex';
      const countElement = taskCount.querySelector('.count');
      if (countElement) countElement.textContent = activeTasks.length;
    }
    
    // Identify stale task items that need to be removed (tasks no longer active)
    const currentTaskIds = activeTasks.map(task => task._id);
    document.querySelectorAll('.task-bar-task-item').forEach(item => {
      const itemTaskId = item.getAttribute('data-task-id');
      if (!currentTaskIds.includes(itemTaskId)) {
        item.remove();
      }
    });
    
    // Render or update task items
    activeTasks.forEach(task => {
      // Check if a task item already exists for this task - prevent duplicates
      let taskItem = document.querySelector(`.task-bar-task-item[data-task-id="${task._id}"]`);
      
      // Only create a new item if one doesn't already exist
      if (!taskItem) {
        taskItem = document.createElement('div');
        taskItem.className = 'task-bar-task-item';
        taskItem.setAttribute('data-task-id', task._id);
        if (task.status === 'completed') {
          completedTasksContainer.appendChild(taskItem);
        } else {
          runningTasksContainer.appendChild(taskItem);
        }
      }
      
      // Get latest logs dynamically
      const logsForTask = tasksStore.getState().stepLogs[task._id] || [];
      const overallProgress = Math.min(Math.max(task.progress || 0, 0), 100);
      
      // Better step count calculation - check for stepNumber in planLog entries
      let currentStep = 0;
      let matchedStepNumbers = logsForTask
        .filter(log => log.type === 'planLog' && log.stepNumber)
        .map(log => log.stepNumber);
      
      if (matchedStepNumbers.length > 0) {
        // Use the highest step number that has been recorded
        currentStep = Math.max(...matchedStepNumbers);
      } else {
        // Fallback to counting stepProgress logs
        const latestStep = logsForTask.filter(l => l.type === 'stepProgress').slice(-1)[0] || {};
        currentStep = latestStep.stepIndex || 0;
      }
      
      // Get total steps from task if available, otherwise default to 10
      const totalSteps = task.totalSteps || 10;
      
      // Get latest function call and plan log
      const latestFunctionCall = logsForTask
        .filter(l => l.type === 'functionCallPartial')
        .slice(-1)[0] || {};
      
      const latestPlanLog = logsForTask
        .filter(l => l.type === 'planLog')
        .slice(-1)[0] || {};
      
      // Format progress text
      const progressText = `${currentStep}/${totalSteps} steps | ${overallProgress}% complete`;
      
      // Format current action
      const currentAction = latestFunctionCall.message || latestPlanLog.message || 'Waiting...';
      
      // Check for task completion and report URLs
      const isCompleted = task.status === 'completed';
      const hasLandingReport = task.result?.landingReportUrl;
      const hasDetailedReport = task.result?.detailedReportUrl;
      
      // Build report links section for completed tasks
      let reportLinksHTML = '';
      if (isCompleted && (hasLandingReport || hasDetailedReport)) {
        reportLinksHTML = `
          <div class="task-reports-container">
            <div class="task-reports-title">
              <i class="fas fa-file-alt"></i> Task Reports
            </div>
            <div class="task-reports-links">
              ${hasLandingReport ? 
                `<a href="${task.result.landingReportUrl}" class="task-report-link landing-report" target="_blank">
                  <i class="fas fa-chart-pie"></i> Landing Report
                </a>` : ''}
              ${hasDetailedReport ? 
                `<a href="${task.result.detailedReportUrl}" class="task-report-link detailed-report" target="_blank">
                  <i class="fas fa-file-code"></i> Detailed Report
                </a>` : ''}
            </div>
          </div>
        `;
      }
      
      // Original card design with command as title
      taskItem.innerHTML = `
        <div>
          <div class="task-progress-container">
            <div class="task-progress" style="width: ${overallProgress}%"></div>
          </div>
          <strong>${task.command || ''}</strong>
          <div>${progressText}</div>
          <div>${currentAction}</div>
          ${reportLinksHTML}
        </div>
      `;
      
      // Render step logs
      if (logsForTask.length) {
        const logContainer = document.createElement('div');
        logContainer.className = 'task-step-logs';
        
        // Process logs in reverse chronological order (newest first)
        const sortedLogs = [...logsForTask].sort((a, b) => {
          // Use timestamp if available, otherwise use array position (newer logs are at the end)
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeB - timeA; // Descending order (newest first)
        });
        
        sortedLogs.forEach(entry => {
          const entryEl = document.createElement('div');
          entryEl.className = 'task-step-log-entry';
          if (entry.stepIndex < currentStep) entryEl.classList.add('completed');
          else if (entry.stepIndex === currentStep) entryEl.classList.add('current');
          
          let text = '';
          if (entry.stepIndex !== undefined) text = `Step ${entry.stepIndex}: ${entry.message}`;
          else if (entry.type === 'functionCallPartial') text = `Function ${entry.functionName} called with ${JSON.stringify(entry.args)}`;
          else if (entry.type === 'planLog') text = entry.message;
          else if (entry.type === 'taskComplete') text = `Complete: ${entry.result.summary || JSON.stringify(entry.result)}`;
          else if (entry.type === 'taskError') text = `Error: ${entry.error}`;
          
          entryEl.textContent = text;
          
          // Add to the beginning (top) of the log container
          logContainer.prepend(entryEl);
        });
        
        taskItem.appendChild(logContainer);
      }
      
      // Thumbnails for intermediate results
      const items = intermediateResults[task._id] || [];
      if (items.length) {
        const thumbContainer = document.createElement('div');
        thumbContainer.className = 'task-thumbnails';
        items.forEach((item, idx) => {
          const thumb = document.createElement('div');
          thumb.className = 'task-thumbnail';
          thumb.textContent = `Step ${idx + 1}`;
          thumb.title = item.extractedInfo || '';
          thumbContainer.appendChild(thumb);
        });
        taskItem.appendChild(thumbContainer);
      }

      // Add cancel handler - with null check to prevent errors
      const cancelButton = taskItem.querySelector('.cancel-task');
      if (cancelButton) {
        cancelButton.addEventListener('click', () => {
          cancelTask(task._id);
        });
      } else {
        console.warn(`[DEBUG] Cancel button not found for task ${task._id}`);
      }
      
      // Add step info click handler
      taskItem.addEventListener('click', () => {
        const stepDetails = taskItem.querySelector('.task-step-details');
        if (stepDetails) {
          stepDetails.classList.toggle('expanded');
        }
      });

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
  
  // This function makes sure we display reports in both the task cards and task completion stores
  function processCompletedTask(task) {
    if (task.status === 'completed') {
      // Store completed task in local cache for persistence
      const cachedTasks = JSON.parse(localStorage.getItem('completedTasks') || '[]');
      const existingIndex = cachedTasks.findIndex(t => t._id === task._id);
      
      if (existingIndex >= 0) {
        cachedTasks[existingIndex] = task;
      } else {
        cachedTasks.push(task);
      }
      
      // Limit cache to recent 20 completed tasks
      if (cachedTasks.length > 20) {
        cachedTasks.splice(0, cachedTasks.length - 20);
      }
      
      localStorage.setItem('completedTasks', JSON.stringify(cachedTasks));
    }
    
    return task;
  }
  
  // Subscribe to task status updates to handle completion events
  eventBus.on('taskComplete', (taskId, result) => {
    // Find the task and update its status and result
    const taskIndex = activeTasks.findIndex(t => t._id === taskId);
    if (taskIndex >= 0) {
      activeTasks[taskIndex].status = 'completed';
      activeTasks[taskIndex].result = result || {};
      
      // Process the completed task
      processCompletedTask(activeTasks[taskIndex]);
      
      // Update task display
      updateTasks('taskComplete event');
    }
  });
  
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
