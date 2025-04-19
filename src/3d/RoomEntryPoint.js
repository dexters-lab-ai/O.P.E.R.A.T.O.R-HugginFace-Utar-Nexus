/**
 * Room Entry Point Component
 * Provides the entry experience with 3D room and computer navigation
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.132.2/build/three.module.js';
import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import RoomExperience from './RoomExperienceClass.js';

/**
 * Create a room entry point component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Entry point container
 */
export function RoomEntryPoint(props = {}) {
  console.log('[DEBUG-ROOM] [TRACE] Entered RoomEntryPoint', props);
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
  container.style.position = 'relative';
  container.style.width = '100vw';
  container.style.height = '100vh';
  if (containerId) container.id = containerId;
  
  // Official loading bar implementation (simple and reliable)
  const loadingBar = document.createElement('div');
  loadingBar.className = 'loading-bar';
  loadingBar.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 0;
    height: 4px;
    background: #0078ff;
    z-index: 1001;
    transition: width 0.1s linear;
  `;
  container.appendChild(loadingBar);

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
  // Hide launch tooltip until model is ready
  helpTooltip.style.display = 'none';
  
  /**
   * Initialize the room experience
   */
  async function initialize() {
    console.log('[DEBUG-ROOM] [TRACE] Entered RoomEntryPoint.initialize');
    console.group('[RoomEntry] Initialization');
    console.log('[RoomEntryPoint] Initializing 3D room experience');
    
    // Enhanced timeout with progress checks
    const LOADING_TIMEOUT = 45000; // 45 seconds
    let loadingProgress = 0;
    const loadingManager = new THREE.LoadingManager();
    loadingManager.onProgress = (url, loaded, total) => {
      loadingProgress = loaded/total;
      console.log(`[LOADING] Progress: ${(loadingProgress*100).toFixed(1)}%`);
    };
    
    const loadingTimeout = setTimeout(() => {
      console.warn('[ROOM] Loading timeout reached - forcing completion');
      eventBus.emit('room-loading-complete');
    }, LOADING_TIMEOUT);
    
    // Clear timeout when loading completes
    eventBus.once('room-loading-complete', () => {
      clearTimeout(loadingTimeout);
    });

    if (!container || !container.appendChild) {
      console.error('Invalid container element:', container);
      console.groupEnd();
      return;
    }
    
    try {
      const savedState = localStorage.getItem('operator_room_state');
      const initialState = savedState ? JSON.parse(savedState) : null;
      console.log('[RoomEntryPoint] Loaded saved state:', initialState);
      console.log('Creating RoomExperience');
      roomExperience = new RoomExperience({
        container: canvasContainer,
        modelPath,
        initialState,
        loadingManager
      });
      
      console.log('[RoomEntryPoint] RoomExperience instance created');
      
      console.log('[RoomEntryPoint] Starting RoomExperience.initialize');
      await roomExperience.initialize();
      // Finalize loading
      eventBus.emit('room-loading-progress', { progress: 100, step: 'COMPLETE' });
      eventBus.emit('room-loading-complete');
      
      console.log('[RoomEntryPoint] Room initialization complete');
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
    // Debug event bus
    console.log('[DEBUG] Setting up event listeners');
    eventBus.on('*', (event, data) => {
      console.log(`[EVENT] ${event}`, data);
    });
    
    // Loading progress (official pattern)
    eventBus.on('room-loading-progress', (data) => {
      loadingBar.style.width = `${data.progress}%`;
      if (data.progress === 100) {
        setTimeout(() => {
          loadingBar.style.opacity = '0';
          loadingBar.style.transition = 'opacity 0.5s ease';
          loadingBar.addEventListener('transitionend', () => {
            loadingBar.remove();
            // Show launch tooltip for user to click
            helpTooltip.style.display = 'block';
          }, { once: true });
        }, 300);
      }
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
    if (isAppLaunched) {
      console.log('[APP] Application already launched');
      return;
    }
    
    console.log('[APP] Launching main application');
    
    // Clean up room experience
    if (roomExperience) {
      console.log('[APP] Cleaning up room experience');
      roomExperience.dispose();
    }
    
    // Emit application launched event
    eventBus.emit('application-launched');
    isAppLaunched = true;
    
    console.log('[APP] Application launched successfully');
    
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
    document.removeEventListener('keydown', null);
  };

  setupEventListeners();
  
  // Launch on tooltip click or ESC key
  helpTooltip.addEventListener('click', () => {
    eventBus.emit('launch-application');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      eventBus.emit('launch-application');
    }
  });
  
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
