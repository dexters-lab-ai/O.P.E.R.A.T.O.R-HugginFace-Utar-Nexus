/**
 * Main App Component
 * Orchestrates the entire application
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import MessageTimeline from './MessageTimeline.jsx';
import BackButton from './BackButton.jsx';
import { mountUnifiedCommandSection } from './UnifiedCommandSection.mount.jsx';

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

  // Create back button
  const backButton = BackButton({
    onBack: () => {
      // Animate fade out, then destroy app and show 3D
      container.classList.add('fade-out');
      setTimeout(() => {
        if (typeof container.destroy === 'function') {
          container.destroy();
        }
        if (container.parentElement) {
          container.parentElement.removeChild(container);
        }
        // Emit event for RoomEntryPoint to restore 3D
        eventBus.emit('exit-application');
      }, 350);
    }
  });
  container.appendChild(backButton);

  // Create command center container
  const commandCenterContainer = document.createElement('div');
  commandCenterContainer.className = 'fixed-command-center';

  // Mount the new React UnifiedCommandSection
  let destroyUnifiedSection = null;
  destroyUnifiedSection = mountUnifiedCommandSection(commandCenterContainer);

  // Create message timeline
  const messageTimeline = MessageTimeline({
    containerId: 'message-timeline'
  });

  // Assemble the layout
  commandCenterContainer.appendChild(messageTimeline);
  container.appendChild(commandCenterContainer);

  // Animate fade-in on mount
  container.classList.add('fade-in');
  setTimeout(() => container.classList.remove('fade-in'), 400);

  // Initialize dark/light mode
  const theme = stores.ui.getState().theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);

  // Method to destroy the component and clean up
  container.destroy = () => {
    // Defensive: Remove fade classes
    container.classList.remove('fade-in','fade-out');
    if (typeof destroyUnifiedSection === 'function') {
      destroyUnifiedSection();
    }
    if (typeof messageTimeline.destroy === 'function') {
      messageTimeline.destroy();
    }
    if (backButton) {
      backButton.onclick = null;
      if (backButton.parentElement) backButton.parentElement.removeChild(backButton);
    }
    // Clean up any subscriptions, listeners, and UI state
    // (add more here as needed for memory safety)
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
