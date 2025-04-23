/**
 * Room Entry Point Component
 * Provides the entry experience with 3D room and computer navigation
 */

import * as THREE from 'three';
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
  
  class RoomEntryPointClass {
    constructor() {
      this.container = container;
      this.eventBus = eventBus;
      this.initialize = this.initialize.bind(this);
    }
    
    async initialize() {
      console.log('[DEBUG-ROOM] [TRACE] Entered RoomEntryPoint.initialize');
      console.group('[RoomEntry] Initialization');
      console.log('[RoomEntryPoint] Initializing 3D room experience');
      
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
        // Prevent re-initialization if app already launched
        if (isAppLaunched) {
          console.log('[RoomEntryPoint] App already launched, initialization aborted.');
          return;
        }
        roomExperience = new RoomExperience({
          container: canvasContainer,
          modelPath,
          initialState,
        });
        
        console.log('[RoomEntryPoint] RoomExperience instance created');
        
        // Track asset load progress
        const manager = roomExperience.loadingManager;
        manager.onProgress = (url, itemsLoaded, itemsTotal) => {
          const p = Math.floor((itemsLoaded / itemsTotal) * 100);
          eventBus.emit('room-loading-progress', { progress: p, step: url });
        };
        // All assets loaded: push splash to 100% and complete
        manager.onLoad = () => {
          eventBus.emit('room-loading-progress', { progress: 100, step: 'Complete' });
          eventBus.emit('room-loading-complete');
        };
        manager.onError = (url) => {
          eventBus.emit('room-error', new Error(`Failed to load: ${url}`));
        };
        
        console.log('[RoomEntryPoint] Starting RoomExperience.initialize');
        await roomExperience.initialize();
        console.log('[RoomEntryPoint] Room initialization complete');
      } catch (error) {
        console.error('Initialization failed:', error);
        eventBus.emit('room-error', error);
        throw error;
      } finally {
        console.groupEnd();
      }
    }
  }
  
  const roomEntryPoint = new RoomEntryPointClass();
  
  /**
   * Setup event listeners for room experience
   */
  function setupEventListeners() {
    // Launch application
    eventBus.on('launch-application', () => {
      launchApplication();
    });
    
    // Exit application (from App back button)
    eventBus.on('exit-application', () => {
      // Defensive: ensure app container is cleaned up
      if (appContainer) {
        appContainer.style.opacity = '0';
        setTimeout(() => {
          appContainer.style.display = 'none';
          appContainer.style.opacity = '1';
          // Show 3D container
          canvasContainer.style.display = 'block';
          // Re-initialize room if needed
          if (!roomExperience) {
            roomEntryPoint.initialize();
          }
          // Clean up any stray app-root
          const strayAppRoot = document.getElementById('app-root');
          if (strayAppRoot && strayAppRoot.parentElement) {
            strayAppRoot.parentElement.removeChild(strayAppRoot);
          }
        }, 400);
      }
      isAppLaunched = false;
      stores.ui.setState({ applicationLaunched: false });
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
    
    // Hide 3D canvas container when launching app
    canvasContainer.style.display = 'none';
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
        roomEntryPoint.initialize();
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
  container.initialize = roomEntryPoint.initialize;
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
  
  // Launch on ESC key
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
