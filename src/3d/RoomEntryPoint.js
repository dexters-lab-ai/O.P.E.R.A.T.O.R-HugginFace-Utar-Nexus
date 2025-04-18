/**
 * Room Entry Point Component
 * Provides the entry experience with 3D room and computer navigation
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.module.js';
import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import { RoomExperience } from './RoomExperience.js';

/**
 * Create a room entry point component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Entry point container
 */
export function RoomEntryPoint(props = {}) {
  const {
    containerId = 'room-entry',
    modelPath = '/models/room.glb'
  } = props;

  // State
  let roomExperience = null;
  let isAppLaunched = false;
  
  // Create container element
  const container = document.createElement('div');
  container.className = 'room-entry-container';
  if (containerId) container.id = containerId;
  
  // Create loading overlay
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'room-loading-overlay';
  
  const loadingContent = document.createElement('div');
  loadingContent.className = 'room-loading-content';
  
  const loadingTitle = document.createElement('h2');
  loadingTitle.textContent = 'Loading OPERATOR Environment';
  
  const loadingProgress = document.createElement('div');
  loadingProgress.className = 'loading-progress-container';
  
  const progressBar = document.createElement('div');
  progressBar.className = 'loading-progress-bar';
  
  const progressText = document.createElement('div');
  progressText.className = 'loading-progress-text';
  progressText.textContent = '0%';
  
  loadingProgress.appendChild(progressBar);
  loadingProgress.appendChild(progressText);
  
  loadingContent.appendChild(loadingTitle);
  loadingContent.appendChild(loadingProgress);
  loadingOverlay.appendChild(loadingContent);
  
  container.appendChild(loadingOverlay);
  
  // Create skip button
  const skipButton = document.createElement('button');
  skipButton.className = 'skip-experience-button';
  skipButton.textContent = 'Skip';
  skipButton.addEventListener('click', launchApplicationDirect);
  loadingContent.appendChild(skipButton);
  
  // Create canvas container
  const canvasContainer = document.createElement('div');
  canvasContainer.className = 'room-canvas-container';
  canvasContainer.style.width = '100%';
  canvasContainer.style.height = '100%';
  canvasContainer.style.position = 'absolute';
  canvasContainer.style.top = '0';
  canvasContainer.style.left = '0';
  canvasContainer.style.zIndex = '1000';
  container.appendChild(canvasContainer);
  
  // Create application container
  const appContainer = document.createElement('div');
  appContainer.className = 'app-container';
  appContainer.style.display = 'none';
  container.appendChild(appContainer);
  
  // Create help tooltip
  const helpTooltip = document.createElement('div');
  helpTooltip.className = 'room-help-tooltip';
  helpTooltip.innerHTML = `
    <div class="tooltip-content">
      <p><strong>Click and drag</strong> to look around</p>
      <p><strong>Move mouse to computer</strong> to interact</p>
      <p>Press <strong>ESC</strong> to skip</p>
    </div>
  `;
  
  container.appendChild(helpTooltip);
  
  /**
   * Initialize the room experience
   */
  function initialize() {
    console.group('[RoomEntry] Initialization');
    
    if (!container || !container.appendChild) {
      console.error('Invalid container element:', container);
      console.groupEnd();
      return;
    }
    
    try {
      console.log('Creating canvas container');
      const canvasContainer = document.createElement('div');
      
      console.log('Appending to DOM');
      container.appendChild(canvasContainer);
      
      console.log('Creating RoomExperience');
      roomExperience = RoomExperience({
        container: canvasContainer,
        modelPath
      });
      
      console.log('Starting animation');
      roomExperience.init();
    } catch (error) {
      console.error('Initialization failed:', error);
    } finally {
      console.groupEnd();
    }
  }
  
  /**
   * Setup event listeners for room experience
   */
  function setupEventListeners() {
    // Loading progress
    eventBus.on('room-loading-progress', (data) => {
      progressBar.style.width = `${data.progress}%`;
      progressText.textContent = `${data.progress}%`;
    });
    
    // Loading complete
    eventBus.on('room-loading-complete', () => {
      loadingOverlay.classList.add('fade-out');
      setTimeout(() => {
        loadingOverlay.style.display = 'none';
      }, 1000);
    });
    
    // Launch application
    eventBus.on('launch-application', () => {
      launchApplication();
    });
    
    // Exit application
    eventBus.on('exit-application', () => {
      exitApplication();
    });
  }
  
  /**
   * Launch the OPERATOR application by transitioning from 3D room
   */
  function launchApplication() {
    if (isAppLaunched) return;
    
    isAppLaunched = true;
    
    // Show app container
    appContainer.style.display = 'block';
    
    // Trigger app initialization
    eventBus.emit('initialize-application');
    
    // Hide help tooltip if visible
    helpTooltip.classList.remove('visible');
    
    // Update state
    stores.ui.setState({ applicationLaunched: true });
  }
  
  /**
   * Launch application directly (skip 3D experience)
   */
  function launchApplicationDirect() {
    if (isAppLaunched) return;
    
    console.log('Launching application (direct fallback)');
    
    // Clean up any failed 3D elements
    if (canvasContainer) {
      canvasContainer.remove();
    }
    if (loadingOverlay) {
      loadingOverlay.remove();
    }
    
    // Show main app immediately
    showApplication();
  }
  
  /**
   * Exit the application and return to the 3D room
   */
  function exitApplication() {
    if (!isAppLaunched) return;
    
    isAppLaunched = false;
    
    // Hide app container
    appContainer.style.opacity = '0';
    
    setTimeout(() => {
      appContainer.style.display = 'none';
      appContainer.style.opacity = '1';
      
      // Show 3D container
      canvasContainer.style.display = 'block';
      
      // Re-initialize room if needed
      if (!roomExperience) {
        initialize();
      }
    }, 1000);
    
    // Update state
    stores.ui.setState({ applicationLaunched: false });
  }
  
  /**
   * Mount the application content
   * @param {HTMLElement} appContent - Application content to display
   */
  function mountApplication(appContent) {
    // Clear app container
    appContainer.innerHTML = '';
    
    // Add app content
    if (appContent instanceof HTMLElement) {
      appContainer.appendChild(appContent);
    } else if (typeof appContent === 'string') {
      appContainer.innerHTML = appContent;
    }
  }
  
  // Public methods
  container.initialize = initialize;
  container.launchApplication = launchApplication;
  container.exitApplication = exitApplication;
  container.mountApplication = mountApplication;
  
  // Cleanup method
  container.destroy = () => {
    // Dispose of three.js resources
    if (roomExperience) {
      roomExperience.dispose();
    }
    
    // Remove event listeners
    skipButton.removeEventListener('click', launchApplicationDirect);
    document.removeEventListener('keydown', null);
  };

  return container;
}

/**
 * Mount room entry point to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - Entry point properties
 * @returns {HTMLElement} The mounted entry point
 */
RoomEntryPoint.mount = (parent, props = {}) => {
  const entryPoint = RoomEntryPoint(props);
  
  if (parent) {
    // Clear parent contents
    parent.innerHTML = '';
    parent.appendChild(entryPoint);
  } else {
    // Mount to body if no parent specified
    document.body.appendChild(entryPoint);
  }
  
  // Initialize after mounting
  entryPoint.initialize();
  
  return entryPoint;
};

export default RoomEntryPoint;
