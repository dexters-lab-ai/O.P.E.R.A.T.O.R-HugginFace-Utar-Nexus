/**
 * Main App Component
 * Orchestrates the entire application
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import CommandCenter from './CommandCenter.js';
import MessageTimeline from './MessageTimeline.js';

/**
 * Create the main application component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} App container
 */
export function App(props = {}) {
  const {
    containerId = 'app-root'
  } = props;

  // Create app container
  const container = document.createElement('div');
  container.className = 'container';
  if (containerId) container.id = containerId;

  // Create command center container
  const commandCenterContainer = document.createElement('div');
  commandCenterContainer.className = 'fixed-command-center';

  // Create layout structure
  const commandCenterLayout = document.createElement('div');
  commandCenterLayout.className = 'command-center-container';

  // Create command center
  const commandCenter = CommandCenter({
    containerId: 'command-center'
  });

  // Create message timeline
  const messageTimeline = MessageTimeline({
    containerId: 'message-timeline'
  });

  // Create task results section
  const taskResults = document.createElement('div');
  taskResults.className = 'task-results';
  taskResults.id = 'output-card';
  taskResults.innerHTML = `
    <div class="task-results-content">
      <h3 class="card-title">
        <i class="fas fa-terminal"></i> Task Results
        <div class="tooltip">
          <span class="guide-dot">?</span>
          <span class="tooltip-text">Results from your tasks are displayed here.</span>
        </div>
      </h3>
      <div id="output-container">
        <p id="no-results" class="text-muted">No results yet. Run a task to see output here.</p>
      </div>
      <button class="btn btn-danger btn-sm btn-icon" id="clear-results"><i class="fas fa-trash"></i> Clear</button>
    </div>
  `;

  // Add clear results handler
  const clearButton = taskResults.querySelector('#clear-results');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      const outputContainer = document.getElementById('output-container');
      if (outputContainer) {
        outputContainer.innerHTML = '<p id="no-results" class="text-muted">No results yet. Run a task to see output here.</p>';
      }
    });
  }

  // Assemble the layout
  commandCenterLayout.appendChild(commandCenter);
  commandCenterLayout.appendChild(taskResults);
  commandCenterContainer.appendChild(commandCenterLayout);
  commandCenterContainer.appendChild(messageTimeline);
  container.appendChild(commandCenterContainer);

  // Initialize dark/light mode
  const theme = stores.ui.getState().theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);

  // Method to destroy the component and clean up
  container.destroy = () => {
    if (typeof commandCenter.destroy === 'function') {
      commandCenter.destroy();
    }
    
    if (typeof messageTimeline.destroy === 'function') {
      messageTimeline.destroy();
    }
    
    if (clearButton) {
      clearButton.removeEventListener('click', null);
    }
  };

  return container;
}

/**
 * Mount the app to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - App properties
 * @returns {HTMLElement} The mounted app
 */
App.mount = (parent, props = {}) => {
  const app = App(props);
  parent.appendChild(app);
  return app;
};

export default App;
