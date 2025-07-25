/**
 * OPERATOR - Modern Application Entry Point
 * This is the modernized version of the app.js that uses the component system
 */

import { eventBus } from '../src/utils/events.js';
import { initializeModernUI } from './app-modern-integration.js';

import * as App from '../src/api/index.js';
import { stores } from '../src/store/index.js';
import { getAllHistory } from '../src/api/history.js';
import { getMessageHistory } from '../src/api/messages.js';
import { submitNLI } from '../src/api/nli.js';
import { getActiveTasks, cancelTask } from '../src/api/tasks.js';

// Maintain references to all initialized components
let appComponents = null;

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

// Initialize the application
async function initializeApp() {
  console.log('Initializing modern OPERATOR application...');
  
  try {
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
    
    // Hide splash screen with animated transition
    if (splashScreen) {
      setTimeout(() => {
        splashScreen.style.opacity = '0';
        setTimeout(() => {
          splashScreen.style.display = 'none';
        }, 500);
      }, 500);
    }
    
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
      const settingsResponse = await get('/settings');
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
      const historyResponse = await get('/history', { limit: 20 });
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

// Load required assets
async function loadAssets() {
  console.log('Loading application assets...');
  
  // Create preload link for critical CSS
  const preloadLink = document.createElement('link');
  preloadLink.rel = 'preload';
  preloadLink.href = '/styles/components.css';
  preloadLink.as = 'style';
  document.head.appendChild(preloadLink);
  
  // Load CSS with fallback
  return new Promise((resolve) => {
    const componentStyles = document.createElement('link');
    componentStyles.rel = 'stylesheet';
    componentStyles.href = '/styles/components.css';
    componentStyles.onload = resolve;
    componentStyles.onerror = resolve; // Continue even if CSS fails
    document.head.appendChild(componentStyles);
    
    // Fallback timeout
    setTimeout(resolve, 300);
  });
}

// Initialize UI components using the integration module
async function initializeComponents() {
  console.log('Initializing modern UI components...');
  
  // Get options from storage if available
  const skipRoomExperience = localStorage.getItem('operator_skip_room') === 'true';
  const initialLayoutPreset = stores.ui.getState().layoutPreset || 'default';
  
  // Initialize the modern UI components
  appComponents = initializeModernUI({
    rootElement: document.getElementById('app-container') || document.body,
    skipRoomExperience,
    initialLayoutPreset
  });
  
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
export default {
  init: initializeApp,
  stores,
  eventBus,
  api,
  getComponents: () => appComponents
};
