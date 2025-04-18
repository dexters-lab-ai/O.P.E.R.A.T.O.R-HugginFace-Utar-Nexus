/**
 * Settings Component
 * Provides a modal interface for configuring application preferences
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.js';
import api from '../utils/api.js';

/**
 * Create a settings component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Settings modal container
 */
export function Settings(props = {}) {
  const {
    containerId = 'settings-modal'
  } = props;

  // State
  let isVisible = false;
  let currentTab = 'general';
  
  // Settings data
  let settings = {
    general: {
      theme: 'dark',
      language: 'en',
      autoSave: true,
      notifications: true
    },
    interface: {
      layoutPreset: 'default',
      fontSize: 'medium',
      reducedMotion: false,
      compactMode: false,
      showTimestamps: true
    },
    accessibility: {
      highContrast: false,
      largeText: false,
      screenReader: false,
      focusOutlines: true
    }
  };
  
  // Create component container
  const container = document.createElement('div');
  container.className = 'settings-modal';
  container.id = containerId;
  
  // Create modal dialog
  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  
  // Create modal header
  const header = document.createElement('div');
  header.className = 'modal-header';
  
  const title = document.createElement('h2');
  title.innerHTML = '<i class="fas fa-cog"></i> Settings';
  header.appendChild(title);
  
  // Add close button
  const closeButton = Button({
    icon: 'fa-times',
    variant: Button.VARIANTS.TEXT,
    onClick: () => hide()
  });
  
  header.appendChild(closeButton);
  dialog.appendChild(header);
  
  // Create content wrapper
  const content = document.createElement('div');
  content.className = 'modal-content';
  
  // Create tabs
  const tabs = document.createElement('div');
  tabs.className = 'settings-tabs';
  
  const tabButtons = [
    { id: 'general', label: 'General', icon: 'fa-sliders-h' },
    { id: 'interface', label: 'Interface', icon: 'fa-desktop' },
    { id: 'accessibility', label: 'Accessibility', icon: 'fa-universal-access' }
  ];
  
  tabButtons.forEach(tab => {
    const button = Button({
      text: tab.label,
      icon: tab.icon,
      variant: tab.id === currentTab ? Button.VARIANTS.PRIMARY : Button.VARIANTS.SECONDARY,
      className: tab.id === currentTab ? 'active' : '',
      onClick: () => {
        // Update active tab
        currentTab = tab.id;
        
        // Update button states
        tabs.querySelectorAll('button').forEach(btn => {
          btn.classList.toggle('active', btn.textContent.trim() === tab.label);
          
          // Update button variant
          btn.className = btn.className.replace(/btn-\w+/g, '');
          btn.classList.add(btn.textContent.trim() === tab.label ? 
            'btn-primary' : 'btn-secondary');
        });
        
        // Show active tab content
        updateTabContent();
      }
    });
    
    tabs.appendChild(button);
  });
  
  content.appendChild(tabs);
  
  // Create settings content
  const settingsContent = document.createElement('div');
  settingsContent.className = 'settings-content';
  content.appendChild(settingsContent);
  
  dialog.appendChild(content);
  
  // Create footer
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  
  const saveButton = Button({
    text: 'Save',
    icon: 'fa-save',
    variant: Button.VARIANTS.PRIMARY,
    onClick: () => saveSettings()
  });
  
  const resetButton = Button({
    text: 'Reset',
    icon: 'fa-undo',
    variant: Button.VARIANTS.SECONDARY,
    onClick: () => resetSettings()
  });
  
  footer.appendChild(resetButton);
  footer.appendChild(saveButton);
  dialog.appendChild(footer);
  
  container.appendChild(dialog);
  
  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', hide);
  container.appendChild(backdrop);
  
  /**
   * Update tab content based on current tab
   */
  function updateTabContent() {
    // Clear content
    settingsContent.innerHTML = '';
    
    // Render appropriate settings section
    switch (currentTab) {
      case 'general':
        renderGeneralSettings();
        break;
      case 'interface':
        renderInterfaceSettings();
        break;
      case 'accessibility':
        renderAccessibilitySettings();
        break;
    }
  }
  
  /**
   * Render general settings
   */
  function renderGeneralSettings() {
    const section = document.createElement('div');
    section.className = 'settings-section';
    
    // Theme selection
    const themeGroup = createSettingGroup('Theme', 'Choose the application theme');
    
    const themeSelect = createSelect('theme', [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
      { value: 'system', label: 'System preference' }
    ], settings.general.theme);
    
    themeSelect.addEventListener('change', (e) => {
      settings.general.theme = e.target.value;
    });
    
    themeGroup.appendChild(themeSelect);
    section.appendChild(themeGroup);
    
    // Language selection
    const languageGroup = createSettingGroup('Language', 'Select your preferred language');
    
    const languageSelect = createSelect('language', [
      { value: 'en', label: 'English' },
      { value: 'fr', label: 'Français' },
      { value: 'es', label: 'Español' },
      { value: 'de', label: 'Deutsch' },
      { value: 'zh', label: '中文' }
    ], settings.general.language);
    
    languageSelect.addEventListener('change', (e) => {
      settings.general.language = e.target.value;
    });
    
    languageGroup.appendChild(languageSelect);
    section.appendChild(languageGroup);
    
    // Auto-save toggle
    const autoSaveGroup = createSettingGroup('Auto-save', 'Automatically save changes');
    
    const autoSaveToggle = createToggle('autoSave', settings.general.autoSave);
    autoSaveToggle.addEventListener('change', (e) => {
      settings.general.autoSave = e.target.checked;
    });
    
    autoSaveGroup.appendChild(autoSaveToggle);
    section.appendChild(autoSaveGroup);
    
    // Notifications toggle
    const notificationsGroup = createSettingGroup('Notifications', 'Show system notifications');
    
    const notificationsToggle = createToggle('notifications', settings.general.notifications);
    notificationsToggle.addEventListener('change', (e) => {
      settings.general.notifications = e.target.checked;
    });
    
    notificationsGroup.appendChild(notificationsToggle);
    section.appendChild(notificationsGroup);
    
    settingsContent.appendChild(section);
  }
  
  /**
   * Render interface settings
   */
  function renderInterfaceSettings() {
    const section = document.createElement('div');
    section.className = 'settings-section';
    
    // Layout preset selection
    const layoutGroup = createSettingGroup('Layout Preset', 'Choose your preferred layout');
    
    const layoutSelect = createSelect('layoutPreset', [
      { value: 'default', label: 'Default' },
      { value: 'centered', label: 'Centered' },
      { value: 'focus', label: 'Focus Mode' },
      { value: 'expanded', label: 'Expanded' }
    ], settings.interface.layoutPreset);
    
    layoutSelect.addEventListener('change', (e) => {
      settings.interface.layoutPreset = e.target.value;
    });
    
    layoutGroup.appendChild(layoutSelect);
    section.appendChild(layoutGroup);
    
    // Font size selection
    const fontSizeGroup = createSettingGroup('Font Size', 'Adjust the text size');
    
    const fontSizeSelect = createSelect('fontSize', [
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
      { value: 'large', label: 'Large' }
    ], settings.interface.fontSize);
    
    fontSizeSelect.addEventListener('change', (e) => {
      settings.interface.fontSize = e.target.value;
    });
    
    fontSizeGroup.appendChild(fontSizeSelect);
    section.appendChild(fontSizeGroup);
    
    // Reduced motion toggle
    const reducedMotionGroup = createSettingGroup('Reduced Motion', 'Minimize animations and transitions');
    
    const reducedMotionToggle = createToggle('reducedMotion', settings.interface.reducedMotion);
    reducedMotionToggle.addEventListener('change', (e) => {
      settings.interface.reducedMotion = e.target.checked;
    });
    
    reducedMotionGroup.appendChild(reducedMotionToggle);
    section.appendChild(reducedMotionGroup);
    
    // Compact mode toggle
    const compactModeGroup = createSettingGroup('Compact Mode', 'Use compact UI elements');
    
    const compactModeToggle = createToggle('compactMode', settings.interface.compactMode);
    compactModeToggle.addEventListener('change', (e) => {
      settings.interface.compactMode = e.target.checked;
    });
    
    compactModeGroup.appendChild(compactModeToggle);
    section.appendChild(compactModeGroup);
    
    // Show timestamps toggle
    const timestampsGroup = createSettingGroup('Show Timestamps', 'Display timestamps in messages');
    
    const timestampsToggle = createToggle('showTimestamps', settings.interface.showTimestamps);
    timestampsToggle.addEventListener('change', (e) => {
      settings.interface.showTimestamps = e.target.checked;
    });
    
    timestampsGroup.appendChild(timestampsToggle);
    section.appendChild(timestampsGroup);
    
    settingsContent.appendChild(section);
  }
  
  /**
   * Render accessibility settings
   */
  function renderAccessibilitySettings() {
    const section = document.createElement('div');
    section.className = 'settings-section';
    
    // High contrast toggle
    const highContrastGroup = createSettingGroup('High Contrast', 'Enhance visibility with high contrast colors');
    
    const highContrastToggle = createToggle('highContrast', settings.accessibility.highContrast);
    highContrastToggle.addEventListener('change', (e) => {
      settings.accessibility.highContrast = e.target.checked;
    });
    
    highContrastGroup.appendChild(highContrastToggle);
    section.appendChild(highContrastGroup);
    
    // Large text toggle
    const largeTextGroup = createSettingGroup('Large Text', 'Increase text size for better readability');
    
    const largeTextToggle = createToggle('largeText', settings.accessibility.largeText);
    largeTextToggle.addEventListener('change', (e) => {
      settings.accessibility.largeText = e.target.checked;
    });
    
    largeTextGroup.appendChild(largeTextToggle);
    section.appendChild(largeTextGroup);
    
    // Screen reader toggle
    const screenReaderGroup = createSettingGroup('Screen Reader Support', 'Enhanced support for screen readers');
    
    const screenReaderToggle = createToggle('screenReader', settings.accessibility.screenReader);
    screenReaderToggle.addEventListener('change', (e) => {
      settings.accessibility.screenReader = e.target.checked;
    });
    
    screenReaderGroup.appendChild(screenReaderToggle);
    section.appendChild(screenReaderGroup);
    
    // Focus outlines toggle
    const focusOutlinesGroup = createSettingGroup('Focus Outlines', 'Show outlines around focused elements');
    
    const focusOutlinesToggle = createToggle('focusOutlines', settings.accessibility.focusOutlines);
    focusOutlinesToggle.addEventListener('change', (e) => {
      settings.accessibility.focusOutlines = e.target.checked;
    });
    
    focusOutlinesGroup.appendChild(focusOutlinesToggle);
    section.appendChild(focusOutlinesGroup);
    
    settingsContent.appendChild(section);
  }
  
  /**
   * Create a setting group with label and description
   * @param {string} label - Setting label
   * @param {string} description - Setting description
   * @returns {HTMLElement} Setting group element
   */
  function createSettingGroup(label, description) {
    const group = document.createElement('div');
    group.className = 'setting-group';
    
    const labelEl = document.createElement('div');
    labelEl.className = 'setting-label';
    
    const heading = document.createElement('h3');
    heading.textContent = label;
    labelEl.appendChild(heading);
    
    if (description) {
      const desc = document.createElement('p');
      desc.className = 'setting-description';
      desc.textContent = description;
      labelEl.appendChild(desc);
    }
    
    group.appendChild(labelEl);
    
    return group;
  }
  
  /**
   * Create a select dropdown
   * @param {string} id - Select element ID
   * @param {Array} options - Array of option objects with value and label
   * @param {string} value - Current value
   * @returns {HTMLElement} Select element
   */
  function createSelect(id, options, value) {
    const select = document.createElement('select');
    select.id = id;
    select.className = 'setting-control setting-select';
    
    options.forEach(option => {
      const optionEl = document.createElement('option');
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      
      if (option.value === value) {
        optionEl.selected = true;
      }
      
      select.appendChild(optionEl);
    });
    
    return select;
  }
  
  /**
   * Create a toggle switch
   * @param {string} id - Toggle element ID
   * @param {boolean} checked - Whether the toggle is checked
   * @returns {HTMLElement} Toggle element
   */
  function createToggle(id, checked) {
    const label = document.createElement('label');
    label.className = 'toggle-switch';
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    
    label.appendChild(input);
    label.appendChild(slider);
    
    return label;
  }
  
  /**
   * Save settings
   */
  async function saveSettings() {
    try {
      // Apply certain settings immediately
      if (settings.general.theme && settings.general.theme !== 'system') {
        document.documentElement.setAttribute('data-theme', settings.general.theme);
        stores.ui.setState({ theme: settings.general.theme });
      }
      
      // Apply layout preset
      if (settings.interface.layoutPreset) {
        stores.ui.setState({ layoutPreset: settings.interface.layoutPreset });
        eventBus.emit('layout-preset-requested', { preset: settings.interface.layoutPreset });
      }
      
      // Apply font size
      if (settings.interface.fontSize) {
        document.documentElement.setAttribute('data-font-size', settings.interface.fontSize);
      }
      
      // Apply reduced motion
      if (settings.interface.reducedMotion) {
        document.documentElement.setAttribute('data-reduced-motion', 'true');
      } else {
        document.documentElement.removeAttribute('data-reduced-motion');
      }
      
      // Apply high contrast
      if (settings.accessibility.highContrast) {
        document.documentElement.setAttribute('data-high-contrast', 'true');
      } else {
        document.documentElement.removeAttribute('data-high-contrast');
      }
      
      // Save to server
      await api.post('/settings', { 
        general: settings.general,
        interface: settings.interface,
        accessibility: settings.accessibility
      });
      
      // Show success notification
      eventBus.emit('notification', {
        message: 'Settings saved successfully',
        type: 'success'
      });
      
      // Hide modal
      hide();
    } catch (error) {
      console.error('Failed to save settings:', error);
      
      // Show error notification
      eventBus.emit('notification', {
        message: 'Failed to save settings',
        type: 'error'
      });
    }
  }
  
  /**
   * Reset settings to defaults
   */
  function resetSettings() {
    settings = {
      general: {
        theme: 'dark',
        language: 'en',
        autoSave: true,
        notifications: true
      },
      interface: {
        layoutPreset: 'default',
        fontSize: 'medium',
        reducedMotion: false,
        compactMode: false,
        showTimestamps: true
      },
      accessibility: {
        highContrast: false,
        largeText: false,
        screenReader: false,
        focusOutlines: true
      }
    };
    
    // Update UI
    updateTabContent();
    
    // Show notification
    eventBus.emit('notification', {
      message: 'Settings reset to defaults',
      type: 'info'
    });
  }
  
  /**
   * Load settings from server
   */
  async function loadSettings() {
    try {
      const response = await api.get('/settings');
      
      if (response && response.success) {
        // Merge server settings with defaults
        if (response.general) {
          settings.general = { ...settings.general, ...response.general };
        }
        
        if (response.interface) {
          settings.interface = { ...settings.interface, ...response.interface };
        }
        
        if (response.accessibility) {
          settings.accessibility = { ...settings.accessibility, ...response.accessibility };
        }
        
        // Update UI
        updateTabContent();
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }
  
  /**
   * Show the settings modal
   */
  function show() {
    if (!isVisible) {
      // Load latest settings
      loadSettings();
      
      // Show modal with animation
      container.style.display = 'flex';
      
      // Trigger reflow
      void container.offsetWidth;
      
      // Add visible class for animation
      container.classList.add('visible');
      
      // Update state
      isVisible = true;
      
      // Add body class to prevent scrolling
      document.body.classList.add('modal-open');
    }
  }
  
  /**
   * Hide the settings modal
   */
  function hide() {
    if (isVisible) {
      // Hide with animation
      container.classList.remove('visible');
      
      // Wait for animation to complete
      setTimeout(() => {
        container.style.display = 'none';
        
        // Update state
        isVisible = false;
        
        // Remove body class
        document.body.classList.remove('modal-open');
      }, 300); // Match animation duration
    }
  }
  
  /**
   * Toggle visibility
   */
  function toggle() {
    if (isVisible) {
      hide();
    } else {
      show();
    }
  }
  
  // Initialize component
  function initialize() {
    // Apply initial view
    updateTabContent();
    
    // Listen for settings toggle events
    const unsubscribeEvent = eventBus.on('toggle-settings', toggle);
    
    // Set up ESC key to close modal
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isVisible) {
        hide();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    // Clean up function
    return () => {
      unsubscribeEvent();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }
  
  // Initialize and get cleanup method
  const cleanup = initialize();
  
  // Expose public methods
  container.show = show;
  container.hide = hide;
  container.toggle = toggle;
  
  // Cleanup method
  container.destroy = () => {
    cleanup();
    
    // Remove event listeners
    backdrop.removeEventListener('click', hide);
  };

  return container;
}

/**
 * Mount settings modal to document body
 * @param {Object} props - Settings properties
 * @returns {HTMLElement} The mounted settings modal
 */
Settings.mount = (props = {}) => {
  const settings = Settings(props);
  document.body.appendChild(settings);
  return settings;
};

export default Settings;
