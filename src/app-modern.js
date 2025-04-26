/**
 * OPERATOR - Modern Application Entry Point
 * Now with all CSS imports managed by Vite
 */

// Core Styles
import '@/styles/main.css';
import '@/styles/components/command-center.css';
import '@/styles/components/layouts.css';
import '@/styles/components/timeline.css';
import '@/styles/components/message-timeline.css';

// Vendor CSS (must remain in HTML)
// <link rel="stylesheet" href="/vendors/fontawesome/all.min.css">

// App Initialization
import { eventBus } from './utils/events.js';
import { stores } from './store/index.js';
import { initializeModernUI } from './app-modern-integration.js';
import ErrorBoundary from './components/base/ErrorBoundary.jsx';
import { getAllHistory } from './api/history.js';
import { getSettings } from './api/settings.js';

// Maintain references to all initialized components
let appComponents = null;

// Initialize app when DOM loads
document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
  try {
    console.log('Initializing modern OPERATOR application...');
    
    // Show splash screen during initialization
    const splashScreen = document.getElementById('splash-screen');
    const loadingProgress = document.getElementById('loading-progress');
    
    if (splashScreen && loadingProgress) {
      updateLoadingProgress(10, loadingProgress);
    }
    
    // Initialize stores with data from API
    await initializeStores();
    updateLoadingProgress(40, loadingProgress);
    
    // Load required assets and styles
    await loadAssets();
    updateLoadingProgress(60, loadingProgress);
    
    // Initialize modern UI components
    await initializeComponents();
    updateLoadingProgress(90, loadingProgress);
    
    // Complete initialization
    finalizeInitialization();
    updateLoadingProgress(100, loadingProgress);

    // Hide room container when PWA launches
    const roomContainer = document.getElementById('room-experience-container');
    if (roomContainer) roomContainer.style.display = 'none';

    // Hide splash screen when app is fully ready
    eventBus.once('application-ready', () => {
      if (splashScreen) {
        splashScreen.style.opacity = '0';
        setTimeout(() => {
          splashScreen.style.display = 'none';
        }, 500);
      }
    });
    
    console.log('Application initialization complete!');
  } catch (error) {
    console.error('Failed to initialize application:', error);
    showNotification('Failed to initialize application', 'error');
  }
}

// Initialize data stores
async function initializeStores() {
  try {
    console.log('Initializing data stores...');
    
    // Load user settings if available
    try {
      const settingsResponse = await getSettings();
      if (settingsResponse && settingsResponse.success) {
        // Update UI store with user settings
        stores.ui.setState({
          theme: settingsResponse.theme || 'dark',
          layoutPreset: settingsResponse.layoutPreset || 'default',
          sidebarCollapsed: settingsResponse.sidebarCollapsed || false
        });
      }
    } catch (error) {
      console.warn('Could not load settings, using defaults:', error);
      // Set defaults if settings can't be loaded
      stores.ui.setState({
        theme: 'dark',
        layoutPreset: 'default',
        sidebarCollapsed: false
      });
    }
    
    // Initialize history store
    try {
      const historyResponse = await getAllHistory(1, 20);
      if (historyResponse && historyResponse.success) {
        stores.history.setState({
          items: historyResponse.items || []
        });
      }
    } catch (historyError) {
      console.warn('Could not load history:', historyError);
      // Set empty history as default
      stores.history.setState({
        items: []
      });
    }
    
    return true;
  } catch (error) {
    console.error('Failed to initialize stores:', error);
    return false;
  }
}

// Load required assets (aggregate all sets for progress bar)
async function loadAssets() {
  console.log('Loading application assets...');
  
  // CSS with fallback
  const loadCSS = (path) => {
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = path;
      link.onerror = () => {
        console.warn(`Fallback: ${path} not found`);
        resolve(); // Don't block loading if CSS fails
      };
      link.onload = resolve;
      document.head.appendChild(link);
    });
  };

  // Simulate three asset sets for demonstration
  const assetSets = [
    Promise.all([
      loadCSS('/css/components.css'),
      loadCSS('/css/variables.css')
    ]),
    // Simulate other asset sets (e.g., images, fonts, 3D models)
    new Promise((resolve) => setTimeout(resolve, 800)),
    new Promise((resolve) => setTimeout(resolve, 800))
  ];

  // Progress bar update logic
  const splashScreen = document.getElementById('splash-screen');
  const loadingProgress = document.getElementById('loading-progress');
  let loaded = 0;
  const total = assetSets.length;
  assetSets.forEach(p => p.then(() => {
    loaded++;
    if (loadingProgress) {
      const percent = Math.round((loaded / total) * 100);
      loadingProgress.style.width = percent + '%';
      loadingProgress.setAttribute('aria-valuenow', percent);
    }
  }));

  await Promise.all(assetSets);
}

// Initialize UI components using the integration module
async function initializeComponents() {
  try {
    console.log('Initializing modern UI components...');
    
    // Get options from storage if available
    const skipRoomExperience = localStorage.getItem('operator_skip_room') === 'true';
    const initialLayoutPreset = stores.ui.getState().layoutPreset || 'default';
    
    // Initialize the modern UI components
    const rootElement = document.getElementById('app-container') || document.body;
    appComponents = initializeModernUI({
      rootElement,
      skipRoomExperience,
      initialLayoutPreset
    });
    
    // Wrap root component with ErrorBoundary
    const errorBoundary = document.createElement('div');
    errorBoundary.innerHTML = `
      <ErrorBoundary>
        ${rootElement.innerHTML}
      </ErrorBoundary>
    `;
    rootElement.innerHTML = '';
    rootElement.appendChild(errorBoundary);
    
    // Wait for components to be ready
    return new Promise((resolve) => {
      // Listen for application-ready event
      eventBus.once('application-ready', () => {
        console.log('Modern UI components ready');
        resolve();
      });
      
      // Fallback in case event doesn't fire
      setTimeout(resolve, 2000);
    });
  } catch (error) {
    console.error('Failed to initialize components:', error);
  }
}

// Initialize components with safeguards
async function initComponents() {
  try {
    if (!this.components) {
      this.components = {
        notifications: new Notifications()
      };
    }
  } catch (error) {
    console.error('Component init failed:', error);
  }
}

// Complete initialization
function finalizeInitialization() {
  console.log('Finalizing application initialization...');
  
  // Check for first-time users
  const isFirstTime = localStorage.getItem('operator_first_visit') !== 'false';
  if (isFirstTime) {
    // Show welcome tips when application is ready
    eventBus.once('application-ready', () => {
      setTimeout(() => {
        if (appComponents && appComponents.notifications) {
          appComponents.notifications.addNotification({
            title: 'Welcome to OPERATOR',
            message: 'Take a moment to explore the new interface. Click the settings icon to customize your experience.',
            type: 'info',
            duration: 10000
          });
        }
        
        localStorage.setItem('operator_first_visit', 'false');
      }, 2000);
    });
  }
}

// Helper function to update loading progress
function updateLoadingProgress(percentage, progressElement) {
  if (!progressElement) return;
  
  progressElement.style.width = `${percentage}%`;
  progressElement.setAttribute('aria-valuenow', percentage);
}

// Show notification to user
function showNotification(message, type = 'info') {
  // Use the modern notification system if available
  if (appComponents && appComponents.notifications) {
    appComponents.notifications.addNotification({
      message,
      type
    });
    return;
  }
  
  // Fallback for when modern components aren't initialized
  console.log(`Notification (${type}): ${message}`);
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  
  // Add icon based on type
  let icon = 'fa-info-circle';
  
  switch (type) {
    case 'success':
      icon = 'fa-check-circle';
      break;
    case 'warning':
      icon = 'fa-exclamation-triangle';
      break;
    case 'error':
      icon = 'fa-times-circle';
      break;
  }
  
  notification.innerHTML = `
    <div class="notification-icon">
      <i class="fas ${icon}"></i>
    </div>
    <div class="notification-content">
      <div class="notification-message">${message}</div>
    </div>
    <button class="notification-close">
      <i class="fas fa-times"></i>
    </button>
  `;
  
  // Add to container or create one if it doesn't exist
  let container = document.querySelector('.notifications-container');
  
  if (!container) {
    container = document.createElement('div');
    container.className = 'notifications-container position-top-right';
    document.body.appendChild(container);
  }
  
  container.appendChild(notification);
  
  // Set up close button
  const closeButton = notification.querySelector('.notification-close');
  if (closeButton) {
    closeButton.addEventListener('click', () => {
      notification.classList.add('dismissing');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    });
  }
  
  // Auto dismiss after 5 seconds
  setTimeout(() => {
    notification.classList.add('dismissing');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 5000);
}

// Export public API
export async function initApp() {
  return initializeApp();
}
export default {
  init: initializeApp,
  stores,
  eventBus,

  getComponents: () => appComponents
};
