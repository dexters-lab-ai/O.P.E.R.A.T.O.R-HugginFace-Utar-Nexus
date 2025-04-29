/**
 * OPERATOR - Modern Application Integration Module
 * This module initializes and integrates all modern UI components
 */

import { eventBus } from './utils/events.js';
import { stores } from './store/index.js';
import { api, get, post } from './utils/api.js';

// Main styles for modern interface
import './styles/main.css';

// Import base components
import Button from './components/base/Button.jsx';
import Modal from './components/base/Modal.jsx';
import Tooltip from './components/base/Tooltip.jsx';
import Dropdown from './components/base/Dropdown.jsx';
import Tabs from './components/base/Tabs.jsx';
import ProgressBar from './components/base/ProgressBar.jsx';
import Alert from './components/base/Alert.jsx';

// Import layout components
import NavigationBar from './components/NavigationBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import TaskBar from './components/TaskBar.jsx';
import MessageTimeline from './components/MessageTimeline.jsx';
import CommandCenter from './components/CommandCenter.jsx';
import BackButton from './components/BackButton.jsx';
import HistoryOverlay from './components/HistoryOverlay.jsx';
import Notifications from './components/Notifications.jsx';
import ThemeController from './components/ThemeController.jsx';
import LayoutManager from './components/LayoutManager.jsx';
import ContentWrapper from './components/ContentWrapper.jsx';

// Import 3D experience
import RoomEntryPoint from './3d/RoomEntryPoint.js';

// Main App logic (modern, robust, memory-safe)
let mountedApp = null;
const appRoot = document.getElementById('app-root') || (() => {
  const root = document.createElement('div');
  root.id = 'app-root';
  document.body.appendChild(root);
  return root;
})();

function createModernApp() {
  // Container
  const container = document.createElement('div');
  container.className = 'container fade-in';
  setTimeout(() => container.classList.remove('fade-in'), 400);

  // Back button
  const backButton = BackButton({
    onBack: () => {
      container.classList.add('fade-out');
      setTimeout(() => {
        if (typeof container.destroy === 'function') container.destroy();
        if (container.parentElement) container.parentElement.removeChild(container);
        eventBus.emit('exit-application');
      }, 350);
    }
  });
  container.appendChild(backButton);

  // Command Center
  const commandCenter = CommandCenter({ containerId: 'command-center' });
  // Message Timeline
  const messageTimeline = MessageTimeline({ containerId: 'message-timeline' });

  // Layout
  const commandCenterContainer = document.createElement('div');
  commandCenterContainer.className = 'fixed-command-center';
  const commandCenterLayout = document.createElement('div');
  commandCenterLayout.className = 'command-center-container';
  commandCenterLayout.appendChild(commandCenter);
  commandCenterContainer.appendChild(commandCenterLayout);
  commandCenterContainer.appendChild(messageTimeline);
  container.appendChild(commandCenterContainer);

  // Destroy/cleanup
  container.destroy = () => {
    container.classList.remove('fade-in','fade-out');
    if (typeof commandCenter.destroy === 'function') commandCenter.destroy();
    if (typeof messageTimeline.destroy === 'function') messageTimeline.destroy();
    if (backButton) {
      backButton.onclick = null;
      if (backButton.parentElement) backButton.parentElement.removeChild(backButton);
    }
  };
  return container;
}

// Listen for app initialization event (from RoomEntryPoint)
eventBus.on('initialize-application', () => {
  // Remove any previous app
  if (mountedApp && typeof mountedApp.destroy === 'function') {
    mountedApp.destroy();
    if (mountedApp.parentElement) mountedApp.parentElement.removeChild(mountedApp);
    mountedApp = null;
  }
  appRoot.innerHTML = '';
  mountedApp = createModernApp();
  appRoot.appendChild(mountedApp);
});

eventBus.on('exit-application', () => {
  if (mountedApp && typeof mountedApp.destroy === 'function') {
    mountedApp.destroy();
    if (mountedApp.parentElement) mountedApp.parentElement.removeChild(mountedApp);
    mountedApp = null;
  }
  appRoot.innerHTML = '';
});
import App from './components/App.jsx';

/**
 * Initialize the modern UI components and integrate them
 * @param {Object} options - Initialization options
 * @returns {Object} Component references and utilities
 */
export function initializeModernUI(options = {}) {
  const {
    rootElement = document.body,
    skipRoomExperience = false,
    initialLayoutPreset = 'default'
  } = options;
  
  // Component instances
  const components = {};
  
  // Create root container if needed
  const appRoot = document.getElementById('app-root') || createAppRoot();

  // Track app instance for cleanup
  let mountedApp = null;

  // Listen for app initialization event (from RoomEntryPoint)
  eventBus.on('initialize-application', () => {
    // Defensive: Remove any previous app
    if (mountedApp && typeof mountedApp.destroy === 'function') {
      mountedApp.destroy();
      if (mountedApp.parentElement) mountedApp.parentElement.removeChild(mountedApp);
      mountedApp = null;
    }
    appRoot.innerHTML = '';
    mountedApp = App();
    appRoot.appendChild(mountedApp);
  });

  // Listen for exit event (from App back button)
  eventBus.on('exit-application', () => {
    if (mountedApp && typeof mountedApp.destroy === 'function') {
      mountedApp.destroy();
      if (mountedApp.parentElement) mountedApp.parentElement.removeChild(mountedApp);
      mountedApp = null;
    }
    appRoot.innerHTML = '';
  });

  /**
   * Create the application root element
   * @returns {HTMLElement} App root element
   */
  function createAppRoot() {
    const root = document.createElement('div');
    root.id = 'app-root';
    rootElement.appendChild(root);
    return root;
  }
  
  /**
   * Initialize theme controller
   */
  function initThemeController() {
    components.themeController = ThemeController({
      defaultTheme: 'dark',
      defaultFontSize: 'medium',
      api: { post } // Pass the post function directly to the component
    });
    
    // Apply saved theme if available
    const savedTheme = localStorage.getItem('operator_theme') || 'dark';
    try {
      components.themeController.setTheme(savedTheme);
    } catch (error) {
      console.error('Failed to set initial theme:', error);
      // Fallback to default theme without saving
      components.themeController.setTheme('dark', false);
    }
  }
  
  /**
   * Initialize notifications system
   */
  function initNotifications() {
    components.notifications = Notifications({
      position: 'top-right',
      duration: 5000
    });
    
    // Add to DOM
    appRoot.appendChild(components.notifications);
  }
  
  /**
   * Initialize layout manager
   */
  function initLayoutManager() {
    const layoutPreset = localStorage.getItem('layout_preset') || 'default';
    const savedCollapsed = localStorage.getItem('sidebar_collapsed');
    const startCollapsed = savedCollapsed !== null ? savedCollapsed === 'true' : true;

    // Create layout manager with initial collapse state
    components.layoutManager = LayoutManager({
      containerId: 'layout-manager',
      initialPreset: layoutPreset,
      startCollapsed
    });
    
    // Always append layout manager element (guaranteed to exist)
    if (components.layoutManager.element && components.layoutManager.element instanceof HTMLElement) {
      appRoot.appendChild(components.layoutManager.element);
    } else {
      throw new Error('LayoutManager did not return a valid DOM element.');
    }
  }
  
  /**
   * Initialize navigation components
   */
  function initNavigationComponents() {
    // Create sidebar items
    const sidebarItems = [
      {
        text: 'Dashboard',
        icon: 'fa-tachometer-alt',
        action: () => {
          // Handle dashboard action
          eventBus.emit('navigation-change', { page: 'dashboard' });
        }
      },
      {
        text: 'Commands',
        icon: 'fa-terminal',
        action: () => {
          // Handle commands action
          eventBus.emit('navigation-change', { page: 'commands' });
        }
      },
      {
        text: 'Recent History',
        icon: 'fa-history',
        action: () => {
          // Show history overlay
          eventBus.emit('toggle-history-overlay');
        }
      },
      { type: 'divider', label: 'Resources' },
      {
        text: 'Documentation',
        icon: 'fa-book',
        action: () => {
          // Handle documentation action
          eventBus.emit('navigation-change', { page: 'documentation' });
        }
      },
      {
        text: 'Extensions',
        icon: 'fa-puzzle-piece',
        action: () => {
          // Handle extensions action
          eventBus.emit('navigation-change', { page: 'extensions' });
        }
      }
    ];
    
    // Create sidebar
    components.sidebar = Sidebar({
      containerId: 'main-sidebar',
      position: 'left',
      collapsed: components.layoutManager.getCollapsibleStates().sidebar,
      items: sidebarItems
    });
    
    // Create navigation bar
    components.navigationBar = NavigationBar({
      containerId: 'main-navigation'
    });
    
    // Add to layout with runtime checks
    if (typeof components.layoutManager.setNavigation === 'function') {
      components.layoutManager.setNavigation(components.navigationBar);
    } else {
      console.error('LayoutManager is missing setNavigation method.');
    }
    if (typeof components.layoutManager.setSidebar === 'function') {
      components.layoutManager.setSidebar(components.sidebar);
    } else {
      console.error('LayoutManager is missing setSidebar method.');
    }
  }
  
  /**
   * Initialize main content components
   */
  function initContentComponents() {
    // Create message timeline
    components.messageTimeline = MessageTimeline({
      containerId: 'message-timeline',
      initialFilter: 'all'
    });
    
    // Create command center
    components.commandCenter = CommandCenter({
      containerId: 'command-center',
      initialTab: 'nli'
    });
    
    // Wrap timeline and command center
    const contentWrapper = ContentWrapper({
      containerId: 'content-wrapper',
      children: [components.messageTimeline, components.commandCenter]
    });
    
    // Add as single content container
    if (typeof components.layoutManager.setContent === 'function') {
      components.layoutManager.setContent({ contentWrapper });
    } else {
      console.error('LayoutManager is missing setContent method.');
    }
  }
  
  /**
   * Initialize overlay components
   */
  function initOverlayComponents() {
    // Create history overlay
    components.historyOverlay = HistoryOverlay({
      containerId: 'history-overlay'
    });
    
    // Add to DOM
    appRoot.appendChild(components.historyOverlay);
  }
  
  /**
   * Initialize task bar
   */
  function initTaskBar() {
    components.taskBar = TaskBar({
      containerId: 'task-bar'
    });
    
    // Add to layout
    components.layoutManager.setTaskBar(components.taskBar);
  }
  
  /**
   * Initialize 3D room experience
   */
  function initRoomExperience() {
    if (skipRoomExperience) {
      // Skip room experience and show app directly
      showApplication();
      return;
    }
    
    // Create room experience container
    const roomContainer = document.createElement('div');
    roomContainer.id = 'room-experience-container';
    roomContainer.style.position = 'fixed';
    roomContainer.style.top = '0';
    roomContainer.style.left = '0';
    roomContainer.style.width = '100%';
    roomContainer.style.height = '100%';
    roomContainer.style.zIndex = '2000';
    
    appRoot.appendChild(roomContainer);
    
    // Initialize room entry point
    components.roomExperience = RoomEntryPoint({
      container: roomContainer,
      onEnterApp: () => {
        // Transition from room to application
        transition3DToApp();
      }
    });
  }
  
  /**
   * Handle transition from 3D room to application
   */
  function transition3DToApp() {
    const roomContainer = document.getElementById('room-experience-container');
    if (!roomContainer) return;

    // Phase 1: Start transition
    roomContainer.style.opacity = '0';
    roomContainer.style.pointerEvents = 'none';
    
    // Phase 2: Post-transition cleanup
    const cleanup = () => {
      requestAnimationFrame(() => {
        // Parallel operations
        roomContainer.remove();
        components.layoutManager.show();
        
        // Atomic visibility enforcement
        document.querySelectorAll('.message-timeline, .command-center').forEach(el => {
          el.style.display = 'block';
          el.style.opacity = '1';
          el.style.zIndex = '2100';
          el.style.pointerEvents = 'auto';
        });
        
        showApplication();
      });
    };
    
    // Use both transitionend and timeout fallback
    roomContainer.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 1100); // Fallback if transitionend fails
    
    // Phase 3: Final verification
    setTimeout(() => {
      if (!document.getElementById('room-experience-container')) {
        eventBus.emit('ui-visibility-verified');
      }
    }, 2000);
  }
  
  /**
   * Show the main application
   */
  function showApplication() {
    // Make layout visible
    components.layoutManager.show();
    
    // Emit event
    eventBus.emit('application-ready');
    
    // Show welcome notification
    components.notifications.addNotification({
      title: 'Welcome to OPERATOR',
      message: 'The modern interface is now ready to use',
      type: 'success'
    });
  }
  
  /**
   * Set up global event handlers
   */
  function setupEventHandlers() {
    // Handle theme changes
    eventBus.on('theme-change', (data) => {
      components.themeController.setTheme(data.theme);
    });
    
    // Handle layout preset changes
    eventBus.on('layout-preset-requested', (data) => {
      components.layoutManager.setLayoutPreset(data.preset);
    });
    
    // Handle history overlay toggle
    eventBus.on('toggle-history-overlay', () => {
      components.historyOverlay.toggle();
    });
    
    // Handle settings toggle
    eventBus.on('toggle-settings', () => {
      // Show settings modal
      const settingsContent = document.createElement('div');
      settingsContent.innerHTML = `
        <div class="settings-tabs">
          <button class="settings-tab active">General</button>
          <button class="settings-tab">Appearance</button>
          <button class="settings-tab">Notifications</button>
          <button class="settings-tab">Advanced</button>
        </div>
        <div class="settings-content">
          <div class="setting-group">
            <div class="setting-label">
              <h3>Theme</h3>
              <p class="setting-description">Choose your preferred interface theme</p>
            </div>
            <div class="setting-control">
              <select class="setting-select" id="theme-select">
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
          </div>
          <div class="setting-group">
            <div class="setting-label">
              <h3>Font Size</h3>
              <p class="setting-description">Adjust the text size throughout the application</p>
            </div>
            <div class="setting-control">
              <select class="setting-select" id="font-size-select">
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
          </div>
          <div class="setting-group">
            <div class="setting-label">
              <h3>Animation Effects</h3>
              <p class="setting-description">Enable or disable interface animations</p>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="animations-toggle" checked>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      `;
      
      // Create modal
      const settingsModal = Modal({
        title: 'Settings',
        content: settingsContent,
        size: 'large',
        className: 'settings-modal',
        footer: Button({
          text: 'Save Changes',
          variant: Button.VARIANTS.PRIMARY,
          onClick: () => {
            // Save settings
            const themeSelect = document.getElementById('theme-select');
            const fontSizeSelect = document.getElementById('font-size-select');
            const animationsToggle = document.getElementById('animations-toggle');
            
            if (themeSelect) {
              components.themeController.setTheme(themeSelect.value);
            }
            
            if (fontSizeSelect) {
              components.themeController.setFontSize(fontSizeSelect.value);
            }
            
            // Close modal
            settingsModal.hide();
            
            // Show confirmation
            components.notifications.addNotification({
              title: 'Settings Saved',
              message: 'Your preferences have been updated',
              type: 'success'
            });
          }
        })
      });
      
      // Show the modal
      settingsModal.show();
      
      // Set current values
      const themeSelect = document.getElementById('theme-select');
      const fontSizeSelect = document.getElementById('font-size-select');
      
      if (themeSelect) {
        themeSelect.value = components.themeController.getCurrentTheme();
      }
      
      if (fontSizeSelect) {
        fontSizeSelect.value = components.themeController.getCurrentFontSize();
      }
    });
  }
  
  /**
   * Initialize all components
   */
  function initializeAll() {
    // First initialize theme and notifications
    initThemeController();
    initNotifications();
    
    // Then initialize layout
    initLayoutManager();
    
    // Initialize main components
    initNavigationComponents();
    initContentComponents();
    initOverlayComponents();
    initTaskBar();
    
    // Set up event handlers
    setupEventHandlers();
    
    // Finally, initialize room experience or show app directly
    initRoomExperience();
    
    // Timeline hover effects
    const timelineItems = document.querySelectorAll('.message');
    timelineItems.forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.transform = 'perspective(500px) rotateY(5deg)';
        item.style.boxShadow = '0 0 15px var(--cyberpunk-neon)';
      });
      
      item.addEventListener('mouseleave', () => {
        item.style.transform = '';
        item.style.boxShadow = '';
      });
    });
    
    // Return component references
    return components;
  }
  
  // Animation helpers
  const animateIn = (el) => {
    if (!el) return;
    el.style.transform = 'translateY(8px)';
    el.style.opacity = '0';
    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.3s ease-out, opacity 0.3s';
      el.style.transform = '';
      el.style.opacity = '1';
    });
  };

  // Apply to components
  if (components.layoutManager) {
    const originalShow = components.layoutManager.show;
    components.layoutManager.show = function() {
      originalShow?.call(this);
      animateIn(document.querySelector('.message-timeline'));
      animateIn(document.querySelector('.command-center'));
    };
  }
  
  // Initialize everything and return component references
  return initializeAll();
}

export default {
  initialize: initializeModernUI
};

// Ensure command center mounts AI thoughts
eventBus.on('application-ready', () => {
  // Mount CommandCenter if not already
  const appArea = document.getElementById('app-root');
  if (appArea && !document.getElementById('command-center')) {
    CommandCenter.mount(appArea);
  }
});
