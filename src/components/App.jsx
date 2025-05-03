/**
 * Main App Component
 * Orchestrates the entire application
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import MessageTimeline from './MessageTimeline.jsx';
import BackButton from './BackButton.jsx';
import { CommandCenter } from './CommandCenter.jsx';
import TaskBar from './TaskBar.jsx';
import { getSettingsModal } from './Settings.jsx';

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

  const commandCenter = CommandCenter();
  commandCenterContainer.appendChild(commandCenter);

  // Create message timeline
  const messageTimeline = MessageTimeline({
    containerId: 'message-timeline'
  });

  // Assemble the layout
  commandCenterContainer.appendChild(messageTimeline);
  container.appendChild(commandCenterContainer);

  // Mount TaskBar at bottom
  const taskBar = TaskBar();
  container.appendChild(taskBar);

  // Animate fade-in on mount
  container.classList.add('fade-in');
  setTimeout(() => container.classList.remove('fade-in'), 400);

  // Initialize dark/light mode
  const theme = stores.ui.getState().theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);

  // --- User Menu Dropdown (Glassy, Futuristic) ---
  const userMenuContainer = document.createElement('div');
  userMenuContainer.className = 'user-menu-container';

  const userAvatar = document.createElement('div');
  userAvatar.className = 'user-avatar';
  userAvatar.innerHTML = '<i class="fas fa-user-circle"></i>';
  userMenuContainer.appendChild(userAvatar);

  // Dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'user-menu-dropdown glassy-dropdown';
  dropdown.style.display = 'none';
  dropdown.style.zIndex = '1002'; // Above sidebar

  // Dropdown items
  const preferencesItem = document.createElement('div');
  preferencesItem.className = 'user-menu-item';
  preferencesItem.innerHTML = '<i class="fas fa-user-cog"></i> Preferences';
  preferencesItem.onclick = () => {
    getSettingsModal().show();
    dropdown.style.display = 'none';
  };
  dropdown.appendChild(preferencesItem);

  // Add more items as needed (e.g., logout)
  const logoutItem = document.createElement('div');
  logoutItem.className = 'user-menu-item';
  logoutItem.innerHTML = '<i class="fas fa-sign-out-alt"></i> Logout';
  logoutItem.onclick = () => {
    eventBus.emit('logout');
    dropdown.style.display = 'none';
  };
  dropdown.appendChild(logoutItem);

  userMenuContainer.appendChild(dropdown);

  // Toggle dropdown visibility
  userAvatar.onclick = (e) => {
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    dropdown.classList.toggle('visible', dropdown.style.display === 'block');
  };
  // Hide dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!userMenuContainer.contains(e.target)) {
      dropdown.style.display = 'none';
      dropdown.classList.remove('visible');
    }
  });

  // Insert user menu at the top right
  userMenuContainer.style.position = 'absolute';
  userMenuContainer.style.top = '24px';
  userMenuContainer.style.right = '32px';
  userMenuContainer.style.zIndex = '2002'; // Ensure above sidebar
  container.appendChild(userMenuContainer);

  // Method to destroy the component and clean up
  container.destroy = () => {
    // Defensive: Remove fade classes
    container.classList.remove('fade-in','fade-out');
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
