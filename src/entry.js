// Entry script: orchestrates splash, 3D world, and loading of React app
import RoomEntryPoint from './3d/RoomEntryPoint.js';
import { eventBus } from './utils/events.js';

// DOM elements
const splash = document.getElementById('splash-screen');
const loadingProgress = document.getElementById('loading-progress');
const webglContainer = document.getElementById('webgl-container');
const reactRoot = document.getElementById('react-root');

// Mount 3D world
const worldEntry = RoomEntryPoint.mount(webglContainer, { containerId: 'room-entry' });

// Update splash progress
eventBus.on('room-loading-progress', ({ progress }) => {
  if (loadingProgress) {
    loadingProgress.style.width = `${progress}%`;
    loadingProgress.setAttribute('aria-valuenow', progress);
  }
  if (progress >= 100) {
    // Hide splash
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => { splash.style.display = 'none'; }, 500);
    }
    // Show 3D canvas
    webglContainer.style.zIndex = '1';
    // World’s built-in launch button will appear automatically
  }
});

// After world initialization, launch React app on event
eventBus.once('initialize-application', async () => {
  if (reactRoot) {
    reactRoot.style.display = 'block';
    const { initApp } = await import('./app-modern.js');
    initApp();
  }
});
