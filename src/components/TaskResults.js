/**
 * Task Results Component
 * Displays task results in a collapsible sidebar panel
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.js';
import Card from './base/Card.js';

/**
 * Create a task results component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Task results container
 */
export function TaskResults(props = {}) {
  const {
    containerId = 'task-results',
    collapsed = false
  } = props;

  // State
  let isCollapsed = collapsed;
  
  // Create component container
  const container = document.createElement('div');
  container.className = 'task-results';
  if (containerId) container.id = containerId;
  
  // Create sidebar toggle
  const sidebarToggle = document.createElement('button');
  sidebarToggle.className = 'sidebar-toggle';
  sidebarToggle.innerHTML = isCollapsed ? 
    '<i class="fas fa-chevron-left"></i>' : 
    '<i class="fas fa-chevron-right"></i>';
  
  // Create header
  const header = document.createElement('div');
  header.className = 'task-results-header';
  
  const title = document.createElement('h3');
  title.className = 'card-title';
  title.innerHTML = '<i class="fas fa-terminal"></i> Task Results';
  
  // Add tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.innerHTML = `
    <span class="guide-dot">?</span>
    <span class="tooltip-text">Results from your tasks are displayed here.</span>
  `;
  title.appendChild(tooltip);
  
  header.appendChild(title);
  
  // Create content container
  const contentContainer = document.createElement('div');
  contentContainer.className = 'task-results-content';
  contentContainer.id = 'output-container';
  
  // Initial empty state
  const emptyState = document.createElement('p');
  emptyState.id = 'no-results';
  emptyState.className = 'text-muted';
  emptyState.textContent = 'No results yet. Run a task to see output here.';
  contentContainer.appendChild(emptyState);
  
  // Create footer with clear button
  const footer = document.createElement('div');
  footer.className = 'task-results-actions';
  
  const clearButton = Button({
    text: 'Clear',
    icon: 'fa-trash',
    variant: Button.VARIANTS.DANGER,
    size: Button.SIZES.SMALL,
    onClick: () => {
      // Clear results
      contentContainer.innerHTML = '';
      
      // Add empty state
      const emptyState = document.createElement('p');
      emptyState.id = 'no-results';
      emptyState.className = 'text-muted';
      emptyState.textContent = 'No results yet. Run a task to see output here.';
      contentContainer.appendChild(emptyState);
      
      // Emit event
      eventBus.emit('task-results-cleared');
    }
  });
  
  footer.appendChild(clearButton);
  
  // Assemble component
  container.appendChild(sidebarToggle);
  container.appendChild(header);
  container.appendChild(contentContainer);
  container.appendChild(footer);
  
  // Apply initial state
  updateCollapseState();
  
  // Toggle sidebar collapse state
  sidebarToggle.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    
    // Update UI
    updateCollapseState();
    
    // Update store
    stores.ui.setState({ taskResultsCollapsed: isCollapsed });
    
    // Emit event
    eventBus.emit('task-results-collapsed', { collapsed: isCollapsed });
  });
  
  // Update UI based on collapse state
  function updateCollapseState() {
    container.classList.toggle('collapsed', isCollapsed);
    sidebarToggle.innerHTML = isCollapsed ? 
      '<i class="fas fa-chevron-left"></i>' : 
      '<i class="fas fa-chevron-right"></i>';
      
    // Update document body class for responsive layout
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);
  }
  
  // Listen for task result events
  const unsubscribeTaskResult = eventBus.on('task-result', (result) => {
    // Remove empty state if present
    const emptyState = document.getElementById('no-results');
    if (emptyState) {
      emptyState.remove();
    }
    
    // Create result card
    const resultCard = Card({
      title: result.command || 'Task Result',
      titleIcon: 'fa-terminal',
      content: formatTaskResult(result),
      collapsible: true,
      collapsed: false,
      className: `task-result-card ${result.status || ''}`
    });
    
    // Add timestamp
    const timestamp = document.createElement('div');
    timestamp.className = 'task-timestamp';
    timestamp.textContent = new Date(result.timestamp || Date.now()).toLocaleTimeString();
    resultCard.querySelector('.card-title').appendChild(timestamp);
    
    // Add to container
    contentContainer.appendChild(resultCard);
    
    // Scroll to bottom
    contentContainer.scrollTop = contentContainer.scrollHeight;
    
    // Auto-expand sidebar if collapsed
    if (isCollapsed) {
      isCollapsed = false;
      updateCollapseState();
      stores.ui.setState({ taskResultsCollapsed: false });
    }
  });
  
  // Subscribe to store changes
  const unsubscribeStore = stores.ui.subscribe((state) => {
    if (state.taskResultsCollapsed !== undefined && state.taskResultsCollapsed !== isCollapsed) {
      isCollapsed = state.taskResultsCollapsed;
      updateCollapseState();
    }
  });
  
  // Format task result for display
  function formatTaskResult(result) {
    const content = document.createElement('div');
    
    // Add output
    if (result.output) {
      const output = document.createElement('pre');
      output.className = 'task-output';
      output.textContent = result.output;
      content.appendChild(output);
    }
    
    // Add error
    if (result.error) {
      const error = document.createElement('div');
      error.className = 'task-error';
      error.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${result.error}`;
      content.appendChild(error);
    }
    
    // Add metadata
    if (result.metadata) {
      const metadata = document.createElement('div');
      metadata.className = 'task-metadata';
      
      for (const [key, value] of Object.entries(result.metadata)) {
        const item = document.createElement('div');
        item.className = 'metadata-item';
        item.innerHTML = `<strong>${key}:</strong> ${value}`;
        metadata.appendChild(item);
      }
      
      content.appendChild(metadata);
    }
    
    return content;
  }
  
  // Expose public methods
  container.addResult = (result) => {
    eventBus.emit('task-result', result);
  };
  
  container.clear = () => {
    clearButton.click();
  };
  
  container.toggle = () => {
    sidebarToggle.click();
  };
  
  // Cleanup method
  container.destroy = () => {
    unsubscribeTaskResult();
    unsubscribeStore();
    sidebarToggle.removeEventListener('click', null);
  };

  return container;
}

/**
 * Mount a task results component to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - Task results properties
 * @returns {HTMLElement} The mounted task results
 */
TaskResults.mount = (parent, props = {}) => {
  const taskResults = TaskResults(props);
  parent.appendChild(taskResults);
  return taskResults;
};

export default TaskResults;
