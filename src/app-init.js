/**
 * OPERATOR - Application Initialization
 * Entry point script for the modern interface
 */

// Import app module - must be at the top level
import app from './app-modern.js';

// Initialization function
function initApp() {
  try {
    // Log initialization
    console.log('Initializing modern OPERATOR app...');
    
    // Initialize the application
    app.init().catch(err => {
      console.error('Error initializing app:', err);
      document.querySelector('.loading-text').textContent = 'Error initializing application';
    });
    
    // Expose app to console for debugging
    window.OPERATOR = app;
  } catch (err) {
    console.error('Fatal error loading app:', err);
    document.querySelector('.loading-text').textContent = 'Error loading application';
  }
}

// Start initialization when document is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
