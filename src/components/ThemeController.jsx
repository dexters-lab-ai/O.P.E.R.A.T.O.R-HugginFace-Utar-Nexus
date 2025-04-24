/**
 * Theme Controller Component
 * Manages application themes and visual appearance
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';

// Available themes
export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
};

// Available font sizes
export const FONT_SIZES = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large'
};

/**
 * Create a theme controller
 * @param {Object} props - Component properties
 * @returns {Object} Theme controller instance
 */
export function ThemeController(props = {}) {
  const {
    defaultTheme = 'dark',
    defaultFontSize = 'medium',
    storeState = true,
    api = null
  } = props;

  // Current state
  let currentTheme = defaultTheme;
  let currentFontSize = defaultFontSize;
  let reducedMotion = false;
  let highContrast = false;
  
  /**
   * Initialize the theme controller
   */
  function initialize() {
    // Load preferences from localStorage or system preference
    loadPreferences();
    
    // Apply initial theme and font size
    applyTheme(currentTheme);
    applyFontSize(currentFontSize);
    applyReducedMotion(reducedMotion);
    applyHighContrast(highContrast);
    
    // Set up event listeners
    setupEventListeners();
    
    // Update store with initial values
    if (storeState) {
      stores.ui.setState({
        theme: currentTheme,
        fontSize: currentFontSize,
        reducedMotion,
        highContrast
      });
    }
  }
  
  /**
   * Load user preferences
   */
  function loadPreferences() {
    // Try to load from localStorage first
    if (typeof localStorage !== 'undefined') {
      const storedTheme = localStorage.getItem('operator_theme');
      const storedFontSize = localStorage.getItem('operator_fontSize');
      const storedReducedMotion = localStorage.getItem('operator_reducedMotion');
      const storedHighContrast = localStorage.getItem('operator_highContrast');
      
      if (storedTheme) {
        currentTheme = storedTheme;
      } else if (currentTheme === THEMES.SYSTEM) {
        // Use system preference if theme is set to system
        currentTheme = getSystemTheme();
      }
      
      if (storedFontSize) {
        currentFontSize = storedFontSize;
      }
      
      if (storedReducedMotion) {
        reducedMotion = storedReducedMotion === 'true';
      } else {
        // Check system preference for reduced motion
        reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
      
      if (storedHighContrast) {
        highContrast = storedHighContrast === 'true';
      } else {
        // Check system preference for high contrast
        highContrast = window.matchMedia('(prefers-contrast: more)').matches;
      }
    } else if (currentTheme === THEMES.SYSTEM) {
      // Use system preference if localStorage not available
      currentTheme = getSystemTheme();
    }
  }
  
  /**
   * Set up event listeners
   */
  function setupEventListeners() {
    // Listen for theme change events
    const unsubscribeTheme = eventBus.on('theme-change', (data) => {
      if (data && data.theme) {
        setTheme(data.theme, data.save !== false);
      }
    });
    
    // Listen for font size change events
    const unsubscribeFontSize = eventBus.on('font-size-change', (data) => {
      if (data && data.fontSize) {
        setFontSize(data.fontSize, data.save !== false);
      }
    });
    
    // Listen for reduced motion change events
    const unsubscribeReducedMotion = eventBus.on('reduced-motion-change', (data) => {
      if (data !== undefined && data.enabled !== undefined) {
        setReducedMotion(data.enabled, data.save !== false);
      }
    });
    
    // Listen for high contrast change events
    const unsubscribeHighContrast = eventBus.on('high-contrast-change', (data) => {
      if (data !== undefined && data.enabled !== undefined) {
        setHighContrast(data.enabled, data.save !== false);
      }
    });
    
    // Listen for system theme changes if using system theme
    const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      if (currentTheme === THEMES.SYSTEM) {
        applyTheme(getSystemTheme());
      }
    };
    
    systemThemeMedia.addEventListener('change', handleSystemThemeChange);
    
    // Listen for reduced motion preference changes
    const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleReducedMotionChange = () => {
      if (!localStorage.getItem('operator_reducedMotion')) {
        setReducedMotion(reducedMotionMedia.matches, false);
      }
    };
    
    reducedMotionMedia.addEventListener('change', handleReducedMotionChange);
    
    // Listen for contrast preference changes
    const contrastMedia = window.matchMedia('(prefers-contrast: more)');
    const handleContrastChange = () => {
      if (!localStorage.getItem('operator_highContrast')) {
        setHighContrast(contrastMedia.matches, false);
      }
    };
    
    contrastMedia.addEventListener('change', handleContrastChange);
    
    // Subscribe to store changes if using store state
    let unsubscribeStore = null;
    if (storeState) {
      unsubscribeStore = stores.ui.subscribe((state) => {
        if (state.theme && state.theme !== currentTheme) {
          setTheme(state.theme, false);
        }
        
        if (state.fontSize && state.fontSize !== currentFontSize) {
          setFontSize(state.fontSize, false);
        }
        
        if (state.reducedMotion !== undefined && state.reducedMotion !== reducedMotion) {
          setReducedMotion(state.reducedMotion, false);
        }
        
        if (state.highContrast !== undefined && state.highContrast !== highContrast) {
          setHighContrast(state.highContrast, false);
        }
      });
    }
    
    // Return cleanup function
    return () => {
      unsubscribeTheme();
      unsubscribeFontSize();
      unsubscribeReducedMotion();
      unsubscribeHighContrast();
      
      systemThemeMedia.removeEventListener('change', handleSystemThemeChange);
      reducedMotionMedia.removeEventListener('change', handleReducedMotionChange);
      contrastMedia.removeEventListener('change', handleContrastChange);
      
      if (unsubscribeStore) {
        unsubscribeStore();
      }
    };
  }
  
  /**
   * Get the system theme preference
   * @returns {string} The system theme preference (light or dark)
   */
  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 
      THEMES.DARK : THEMES.LIGHT;
  }
  
  /**
   * Set the current theme
   * @param {string} theme - Theme to set
   * @param {boolean} save - Whether to save the theme
   */
  function setTheme(theme, save = true) {
    if (!Object.values(THEMES).includes(theme)) {
      console.error(`Invalid theme: ${theme}`);
      return;
    }
    
    // Update current theme
    currentTheme = theme;
    
    // Apply the theme
    applyTheme(theme);
    
    // Save preference if requested
    if (save) {
      localStorage.setItem('operator_theme', theme);
      
      // Update server settings if API is available
      if (api && typeof api.post === 'function') {
        api.post('/settings', { theme })
          .catch(error => {
            console.error('Failed to save theme preference:', error);
          });
      } else {
        console.log('Theme preference saved locally only (API not available for remote storage)');
      }
    }
    
    // Update store if using store state
    if (storeState) {
      stores.ui.setState({ theme });
    }
    
    // Emit theme changed event
    eventBus.emit('theme-changed', { theme });
  }
  
  /**
   * Apply a theme to the document
   * @param {string} theme - Theme to apply
   */
  function applyTheme(theme) {
    // If theme is system, use system preference
    const effectiveTheme = theme === THEMES.SYSTEM ? 
      getSystemTheme() : theme;
    
    // Apply theme to document
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    
    // Set meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content', 
        effectiveTheme === THEMES.DARK ? '#1A1A2E' : '#FFFFFF'
      );
    }
  }
  
  /**
   * Set the current font size
   * @param {string} fontSize - Font size to set
   * @param {boolean} save - Whether to save the font size
   */
  function setFontSize(fontSize, save = true) {
    if (!Object.values(FONT_SIZES).includes(fontSize)) {
      console.error(`Invalid font size: ${fontSize}`);
      return;
    }
    
    // Update current font size
    currentFontSize = fontSize;
    
    // Apply the font size
    applyFontSize(fontSize);
    
    // Save preference if requested
    if (save) {
      localStorage.setItem('operator_fontSize', fontSize);
      
      // Update server settings
      api.post('/settings', { fontSize })
        .catch(error => {
          console.error('Failed to save font size preference:', error);
        });
    }
    
    // Update store if using store state
    if (storeState) {
      stores.ui.setState({ fontSize });
    }
    
    // Emit font size changed event
    eventBus.emit('font-size-changed', { fontSize });
  }
  
  /**
   * Apply a font size to the document
   * @param {string} fontSize - Font size to apply
   */
  function applyFontSize(fontSize) {
    document.documentElement.setAttribute('data-font-size', fontSize);
  }
  
  /**
   * Set reduced motion preference
   * @param {boolean} enabled - Whether reduced motion is enabled
   * @param {boolean} save - Whether to save the preference
   */
  function setReducedMotion(enabled, save = true) {
    // Update current preference
    reducedMotion = enabled;
    
    // Apply the preference
    applyReducedMotion(enabled);
    
    // Save preference if requested
    if (save) {
      localStorage.setItem('operator_reducedMotion', String(enabled));
      
      // Update server settings
      api.post('/settings', { reducedMotion: enabled })
        .catch(error => {
          console.error('Failed to save reduced motion preference:', error);
        });
    }
    
    // Update store if using store state
    if (storeState) {
      stores.ui.setState({ reducedMotion: enabled });
    }
    
    // Emit reduced motion changed event
    eventBus.emit('reduced-motion-changed', { enabled });
  }
  
  /**
   * Apply reduced motion preference to the document
   * @param {boolean} enabled - Whether reduced motion is enabled
   */
  function applyReducedMotion(enabled) {
    if (enabled) {
      document.documentElement.setAttribute('data-reduced-motion', 'true');
    } else {
      document.documentElement.removeAttribute('data-reduced-motion');
    }
  }
  
  /**
   * Set high contrast preference
   * @param {boolean} enabled - Whether high contrast is enabled
   * @param {boolean} save - Whether to save the preference
   */
  function setHighContrast(enabled, save = true) {
    // Update current preference
    highContrast = enabled;
    
    // Apply the preference
    applyHighContrast(enabled);
    
    // Save preference if requested
    if (save) {
      localStorage.setItem('operator_highContrast', String(enabled));
      
      // Update server settings
      api.post('/settings', { highContrast: enabled })
        .catch(error => {
          console.error('Failed to save high contrast preference:', error);
        });
    }
    
    // Update store if using store state
    if (storeState) {
      stores.ui.setState({ highContrast: enabled });
    }
    
    // Emit high contrast changed event
    eventBus.emit('high-contrast-changed', { enabled });
  }
  
  /**
   * Apply high contrast preference to the document
   * @param {boolean} enabled - Whether high contrast is enabled
   */
  function applyHighContrast(enabled) {
    if (enabled) {
      document.documentElement.setAttribute('data-high-contrast', 'true');
    } else {
      document.documentElement.removeAttribute('data-high-contrast');
    }
  }
  
  /**
   * Toggle between light and dark themes
   * @param {boolean} save - Whether to save the theme
   */
  function toggleTheme(save = true) {
    const newTheme = currentTheme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
    setTheme(newTheme, save);
  }
  
  // Initialize the controller
  const cleanup = initialize();
  
  // Return public API
  return {
    getCurrentTheme: () => currentTheme,
    getCurrentFontSize: () => currentFontSize,
    isReducedMotion: () => reducedMotion,
    isHighContrast: () => highContrast,
    setTheme,
    setFontSize,
    setReducedMotion,
    setHighContrast,
    toggleTheme,
    destroy: cleanup
  };
}

/**
 * Create and initialize a theme controller
 * @param {Object} props - Theme controller properties
 * @returns {Object} Theme controller instance
 */
ThemeController.create = (props = {}) => {
  return ThemeController(props);
};

export default ThemeController;
