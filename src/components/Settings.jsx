/**
 * Settings Modal Component
 * Provides a modern, world-class modal interface for configuring application preferences
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.jsx';
import { getSettings, saveApiKey, deleteApiKey, saveLlmPreferences } from '../api/settings.js';

// Helper: Save to localStorage and store
function persistSettings(settings) {
  localStorage.setItem('userPreferences', JSON.stringify(settings));
  stores.ui.setState({ preferences: settings });
}

function loadPersistedSettings() {
  let fromStorage = localStorage.getItem('userPreferences');
  if (fromStorage) return JSON.parse(fromStorage);
  let fromStore = stores.ui.getState().preferences;
  if (fromStore) return fromStore;
  return null;
}

// Available LLM engines
const engines = [
  { id: 'gpt-4o-mini', name: 'GPT‑4o Mini' },
  { id: 'gpt-4o', name: 'GPT‑4o' },
  { id: 'UITars', name: 'UI‑Tars' },
  { id: 'qwen-vl-max-latest', name: 'Qwen‑VL‑Max‑Latest' },
];

/**
 * Create a settings modal component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Settings modal element
 */
function SettingsModal(props = {}) {
  const containerId = props.containerId || 'settings-modal';
  let isVisible = false;
  let currentTab = 'api-keys';
  let settings = loadPersistedSettings() || {
    profile: { username: '', email: '' },
    apiKeys: {},
    preferredEngine: 'gpt-4o',
    privacyMode: false,
    notifications: { enabled: true },
    interface: {
      theme: document.documentElement.getAttribute('data-theme') || 'dark',
      fontSize: 'medium',
      compactMode: false,
      showTimestamps: true
    },
    accessibility: {
      highContrast: false,
      largeText: false,
      focusOutlines: true
    },
    llmPreferences: {
      default: 'gpt-4',
      code: 'gpt-4',
      content: 'gpt-4',
      research: 'gpt-4'
    }
  };

  // Create modal container element
  const container = document.createElement('div');
  container.id = containerId + '-container';

  // Create overlay container
  const overlay = document.createElement('div');
  overlay.className = 'settings-modal-overlay';
  overlay.id = containerId;

  // Create modal container
  const modalContainer = document.createElement('div');
  modalContainer.className = 'settings-modal';
  modalContainer.id = containerId;

  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'settings-notification';
  notification.innerHTML = `
    <div class="notification-title"></div>
    <div class="notification-message"></div>
  `;

  // Create modal header
  const header = document.createElement('div');
  header.className = 'settings-modal-header';
  
  const title = document.createElement('h2');
  title.innerHTML = '<i class="fas fa-cog"></i> Settings';
  header.appendChild(title);
  
  const closeButton = Button({ 
    icon: 'fa-times', 
    variant: Button.VARIANTS.TEXT, 
    title: 'Close',
    onClick: () => hide() 
  });
  header.appendChild(closeButton);

  // Create tabs
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'settings-tabs';
  
  const tabs = [
    { id: 'api-keys', label: 'API Keys', icon: 'fa-key' },
    { id: 'llm-engine', label: 'LLM Engine', icon: 'fa-robot' },
    { id: 'interface', label: 'Interface', icon: 'fa-desktop' },
    { id: 'accessibility', label: 'Accessibility', icon: 'fa-universal-access' },
    { id: 'privacy', label: 'Privacy', icon: 'fa-shield-alt' },
    { id: 'password', label: 'Password', icon: 'fa-lock' }
  ];
  
  tabs.forEach(tab => {
    const tabBtn = document.createElement('div');
    tabBtn.className = 'settings-tab';
    tabBtn.classList.toggle('active', tab.id === currentTab);
    tabBtn.dataset.tab = tab.id;
    
    tabBtn.innerHTML = `
      <i class="fas ${tab.icon}"></i>
      <span>${tab.label}</span>
    `;
    
    tabBtn.addEventListener('click', () => {
      selectTab(tab.id);
    });
    tabsContainer.appendChild(tabBtn);
  });

  // Create content area
  const content = document.createElement('div');
  content.className = 'settings-modal-content';
  
  // API Keys tab content
  const apiKeysTab = document.createElement('div');
  apiKeysTab.className = 'tab-content';
  apiKeysTab.id = 'api-keys-tab';
  apiKeysTab.style.display = currentTab === 'api-keys' ? 'block' : 'none';
  
  // API Key form
  const apiKeyForm = document.createElement('form');
  apiKeyForm.className = 'api-key-form';
  apiKeyForm.innerHTML = `
    <div class="form-group">
      <label for="openai-key">OpenAI API Key</label>
      <div class="input-with-action">
        <input type="password" id="openai-key" placeholder="sk-..." autocomplete="off" class="text-input">
        <button type="button" class="toggle-visibility-btn" data-for="openai-key">
          <i class="fas fa-eye"></i>
        </button>
        <button type="button" class="save-key-btn" data-provider="openai">
          <i class="fas fa-save"></i> Save
        </button>
        <button type="button" class="delete-key-btn" data-provider="openai">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <small class="input-help">Your OpenAI API key starting with 'sk-'</small>
      <div class="key-status" id="openai-key-status"></div>
    </div>
    
    <div class="form-group">
      <label for="midscene-key">Midscene API Key</label>
      <div class="input-with-action">
        <input type="password" id="midscene-key" placeholder="ms-..." autocomplete="off" class="text-input">
        <button type="button" class="toggle-visibility-btn" data-for="midscene-key">
          <i class="fas fa-eye"></i>
        </button>
        <button type="button" class="save-key-btn" data-provider="midscene">
          <i class="fas fa-save"></i> Save
        </button>
        <button type="button" class="delete-key-btn" data-provider="midscene">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <small class="input-help">Your Midscene API key starting with 'ms-'</small>
      <div class="key-status" id="midscene-key-status"></div>
    </div>
    
    <div class="form-group">
      <label for="google-key">Google AI API Key</label>
      <div class="input-with-action">
        <input type="password" id="google-key" placeholder="Enter Google AI API key" autocomplete="off" class="text-input">
        <button type="button" class="toggle-visibility-btn" data-for="google-key">
          <i class="fas fa-eye"></i>
        </button>
        <button type="button" class="save-key-btn" data-provider="google">
          <i class="fas fa-save"></i> Save
        </button>
        <button type="button" class="delete-key-btn" data-provider="google">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <small class="input-help">Your Google AI API key</small>
      <div class="key-status" id="google-key-status"></div>
    </div>
    
    <div class="form-group">
      <label for="anthropic-key">Anthropic API Key</label>
      <div class="input-with-action">
        <input type="password" id="anthropic-key" placeholder="sk-ant-..." autocomplete="off" class="text-input">
        <button type="button" class="toggle-visibility-btn" data-for="anthropic-key">
          <i class="fas fa-eye"></i>
        </button>
        <button type="button" class="save-key-btn" data-provider="anthropic">
          <i class="fas fa-save"></i> Save
        </button>
        <button type="button" class="delete-key-btn" data-provider="anthropic">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <small class="input-help">Your Anthropic API key starting with 'sk-ant-'</small>
      <div class="key-status" id="anthropic-key-status"></div>
    </div>
  `;
  
  // Add validation for API keys
  const validateApiKey = (provider, value) => {
    if (!value || value.trim() === '') {
      return { valid: false, message: 'API key cannot be empty' };
    }
    
    switch (provider) {
      case 'openai':
        return { 
          valid: value.startsWith('sk-'), 
          message: value.startsWith('sk-') ? 'Valid format' : 'OpenAI keys should start with sk-' 
        };
      case 'midscene':
        return { 
          valid: true, // We'll accept any format for now
          message: 'Valid format' 
        };
      case 'google':
        return { 
          valid: true, // We'll accept any format for now
          message: 'Valid format' 
        };
      case 'anthropic':
        return { 
          valid: value.startsWith('sk-ant-'), 
          message: value.startsWith('sk-ant-') ? 'Valid format' : 'Anthropic keys should start with sk-ant-' 
        };
      default:
        return { valid: true, message: 'Valid format' };
    }
  };
  
  apiKeysTab.appendChild(apiKeyForm);
  content.appendChild(apiKeysTab);
  
  // LLM Engine Tab
  const llmEngineTab = document.createElement('div');
  llmEngineTab.className = 'tab-content';
  llmEngineTab.id = 'llm-engine-tab';
  llmEngineTab.style.display = currentTab === 'llm-engine' ? 'block' : 'none';
  
  const llmEngineSection = document.createElement('div');
  llmEngineSection.className = 'settings-section';
  llmEngineSection.innerHTML = `
    <h3><i class="fas fa-robot"></i> Default LLM Engine</h3>
    <div class="radio-group" id="engine-options"></div>
  `;
  llmEngineTab.appendChild(llmEngineSection);
  content.appendChild(llmEngineTab);
  
  // LLM Selection section
  const llmSelectionSection = document.createElement('div');
  llmSelectionSection.className = 'settings-section';
  llmSelectionSection.innerHTML = `
    <h3 class="settings-section-title">Language Model Selection</h3>
    <p class="settings-section-description">Choose which language models to use for different types of tasks.</p>
    
    <div class="form-group">
      <label>Default Model</label>
      <select id="default-llm-model" class="text-input">
        <option value="gpt-4">GPT-4 (OpenAI)</option>
        <option value="gpt-3.5-turbo">GPT-3.5 Turbo (OpenAI)</option>
        <option value="claude-3-opus">Claude 3 Opus (Anthropic)</option>
        <option value="claude-3-sonnet">Claude 3 Sonnet (Anthropic)</option>
      </select>
      <span class="input-help">This model will be used as the default for all tasks.</span>
    </div>
    
    <div class="form-group">
      <label>Code Generation</label>
      <select id="code-llm-model" class="text-input">
        <option value="default">Use Default Model</option>
        <option value="gpt-4">GPT-4 (OpenAI)</option>
        <option value="gpt-3.5-turbo">GPT-3.5 Turbo (OpenAI)</option>
        <option value="claude-3-opus">Claude 3 Opus (Anthropic)</option>
        <option value="claude-3-sonnet">Claude 3 Sonnet (Anthropic)</option>
      </select>
      <span class="input-help">Model used for generating and analyzing code.</span>
    </div>
    
    <div class="form-group">
      <label>Content Creation</label>
      <select id="content-llm-model" class="text-input">
        <option value="default">Use Default Model</option>
        <option value="gpt-4">GPT-4 (OpenAI)</option>
        <option value="gpt-3.5-turbo">GPT-3.5 Turbo (OpenAI)</option>
        <option value="claude-3-opus">Claude 3 Opus (Anthropic)</option>
        <option value="claude-3-sonnet">Claude 3 Sonnet (Anthropic)</option>
      </select>
      <span class="input-help">Model used for creating written content and summaries.</span>
    </div>
    
    <div class="form-group">
      <label>Research & Analysis</label>
      <select id="research-llm-model" class="text-input">
        <option value="default">Use Default Model</option>
        <option value="gpt-4">GPT-4 (OpenAI)</option>
        <option value="gpt-3.5-turbo">GPT-3.5 Turbo (OpenAI)</option>
        <option value="claude-3-opus">Claude 3 Opus (Anthropic)</option>
        <option value="claude-3-sonnet">Claude 3 Sonnet (Anthropic)</option>
      </select>
      <span class="input-help">Model used for research, analysis, and complex reasoning tasks.</span>
    </div>
  `;
  llmEngineTab.appendChild(llmSelectionSection);
  content.appendChild(llmEngineTab);
  
  // Privacy Tab
  const privacyTab = document.createElement('div');
  privacyTab.className = 'tab-content';
  privacyTab.id = 'privacy-tab';
  privacyTab.style.display = currentTab === 'privacy' ? 'block' : 'none';
  
  const privacySection = document.createElement('div');
  privacySection.className = 'settings-section';
  privacySection.innerHTML = `
    <h3><i class="fas fa-shield-alt"></i> Privacy Options</h3>
    <div class="toggle-container">
      <label class="toggle-switch">
        <input type="checkbox" id="privacy-toggle" />
        <span class="toggle-slider"></span>
      </label>
      <span class="toggle-label">Safe Puppeteer Mode</span>
    </div>
    <p class="setting-description">
      When enabled, puppeteer browser instances will launch with increased security settings.
    </p>
  `;
  privacyTab.appendChild(privacySection);
  content.appendChild(privacyTab);
  
  // Password Tab
  const passwordTab = document.createElement('div');
  passwordTab.className = 'tab-content';
  passwordTab.id = 'password-tab';
  passwordTab.style.display = currentTab === 'password' ? 'block' : 'none';
  
  const passwordSection = document.createElement('div');
  passwordSection.className = 'settings-section';
  passwordSection.innerHTML = `
    <h3><i class="fas fa-lock"></i> Change Password</h3>
    <div class="form-group">
      <label>Current Password</label>
      <input type="password" id="current-password" />
    </div>
    <div class="form-group">
      <label>New Password</label>
      <input type="password" id="new-password" />
    </div>
    <div class="form-group">
      <label>Confirm New Password</label>
      <input type="password" id="confirm-password" />
    </div>
    <button class="btn btn-primary" id="update-password-btn">
      <i class="fas fa-key"></i> Update Password
    </button>
  `;
  
  // Password update button handler
  passwordSection.querySelector('#update-password-btn').addEventListener('click', updatePassword);
  passwordTab.appendChild(passwordSection);
  content.appendChild(passwordTab);
  
  // Interface Tab
  const interfaceTab = document.createElement('div');
  interfaceTab.className = 'tab-content';
  interfaceTab.id = 'interface-tab';
  interfaceTab.style.display = currentTab === 'interface' ? 'block' : 'none';
  
  const interfaceSection = document.createElement('div');
  interfaceSection.className = 'settings-section';
  interfaceSection.innerHTML = `
    <h3><i class="fas fa-palette"></i> Theme Settings</h3>
    <div class="toggle-container">
      <label class="toggle-switch">
        <input type="checkbox" id="dark-mode-toggle" ${document.documentElement.getAttribute('data-theme') === 'dark' ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
      <span class="toggle-label">Dark Mode</span>
    </div>
    
    <h3 style="margin-top: 24px;"><i class="fas fa-text-height"></i> Text Settings</h3>
    <div class="toggle-container">
      <label class="toggle-switch">
        <input type="checkbox" id="compact-mode-toggle" ${settings.interface.compactMode ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
      <span class="toggle-label">Compact Mode</span>
    </div>
    
    <div class="toggle-container" style="margin-top: 12px;">
      <label class="toggle-switch">
        <input type="checkbox" id="timestamps-toggle" ${settings.interface.showTimestamps ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
      <span class="toggle-label">Show Timestamps</span>
    </div>
  `;
  
  // Theme toggle handler
  interfaceSection.querySelector('#dark-mode-toggle').addEventListener('change', (e) => {
    const theme = e.target.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    settings.interface.theme = theme;
    saveSettings();
    showNotification('Theme updated', true);
  });
  
  // Compact mode toggle handler
  interfaceSection.querySelector('#compact-mode-toggle').addEventListener('change', (e) => {
    settings.interface.compactMode = e.target.checked;
    document.body.classList.toggle('compact-mode', e.target.checked);
    saveSettings();
    showNotification('Display mode updated', true);
  });
  
  // Timestamps toggle handler
  interfaceSection.querySelector('#timestamps-toggle').addEventListener('change', (e) => {
    settings.interface.showTimestamps = e.target.checked;
    saveSettings();
    showNotification('Timestamp setting updated', true);
  });
  
  interfaceTab.appendChild(interfaceSection);
  content.appendChild(interfaceTab);
  
  // Accessibility Tab
  const accessibilityTab = document.createElement('div');
  accessibilityTab.className = 'tab-content';
  accessibilityTab.id = 'accessibility-tab';
  accessibilityTab.style.display = currentTab === 'accessibility' ? 'block' : 'none';
  
  const accessibilitySection = document.createElement('div');
  accessibilitySection.className = 'settings-section';
  accessibilitySection.innerHTML = `
    <h3><i class="fas fa-universal-access"></i> Accessibility Options</h3>
    <div class="toggle-container">
      <label class="toggle-switch">
        <input type="checkbox" id="high-contrast-toggle" ${settings.accessibility.highContrast ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
      <span class="toggle-label">High Contrast Mode</span>
    </div>
    
    <div class="toggle-container" style="margin-top: 12px;">
      <label class="toggle-switch">
        <input type="checkbox" id="large-text-toggle" ${settings.accessibility.largeText ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
      <span class="toggle-label">Large Text</span>
    </div>
    
    <div class="toggle-container" style="margin-top: 12px;">
      <label class="toggle-switch">
        <input type="checkbox" id="focus-outlines-toggle" ${settings.accessibility.focusOutlines ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
      <span class="toggle-label">Focus Outlines</span>
    </div>
  `;
  
  // Accessibility toggle handlers
  accessibilitySection.querySelector('#high-contrast-toggle').addEventListener('change', (e) => {
    settings.accessibility.highContrast = e.target.checked;
    document.body.classList.toggle('high-contrast', e.target.checked);
    saveSettings();
    showNotification('Contrast setting updated', true);
  });
  
  accessibilitySection.querySelector('#large-text-toggle').addEventListener('change', (e) => {
    settings.accessibility.largeText = e.target.checked;
    document.body.classList.toggle('large-text', e.target.checked);
    saveSettings();
    showNotification('Text size setting updated', true);
  });
  
  accessibilitySection.querySelector('#focus-outlines-toggle').addEventListener('change', (e) => {
    settings.accessibility.focusOutlines = e.target.checked;
    document.body.classList.toggle('focus-outlines', e.target.checked);
    saveSettings();
    showNotification('Focus outline setting updated', true);
  });
  
  accessibilityTab.appendChild(accessibilitySection);
  content.appendChild(accessibilityTab);
  
  modalContainer.appendChild(header);
  modalContainer.appendChild(tabsContainer);
  modalContainer.appendChild(content);

  // Create footer
  const footer = document.createElement('div');
  footer.className = 'settings-modal-footer';
  
  const saveBtn = Button({ 
    text: 'Save All Changes', 
    icon: 'fa-save', 
    variant: Button.VARIANTS.PRIMARY, 
    onClick: saveAllSettings 
  });
  
  const closeBtn = Button({ 
    text: 'Close', 
    icon: 'fa-times', 
    variant: Button.VARIANTS.SECONDARY, 
    onClick: hide 
  });
  
  footer.appendChild(closeBtn);
  footer.appendChild(saveBtn);
  modalContainer.appendChild(footer);

  // Assemble the modal components
  overlay.appendChild(modalContainer);
  overlay.appendChild(notification);
  container.appendChild(overlay);
  
  // Add to DOM
  document.body.appendChild(container);
  
  // Set initial display style
  overlay.style.display = 'none';
  
  // Initialize
  function initialize() {
    try {
      console.log("Initializing settings modal");
      
      // Select the first tab by default
      selectTab('api-keys');
      
      // Set up event listeners for tab switching
      const tabButtons = tabsContainer.querySelectorAll('.settings-tab');
      if (tabButtons && tabButtons.length > 0) {
        Array.from(tabButtons).forEach(tab => {
          tab.addEventListener('click', () => {
            selectTab(tab.dataset.tab);
          });
        });
        console.log(`Set up ${tabButtons.length} tab button listeners`);
      } else {
        console.warn("No tab buttons found to set up listeners");
      }
      
      // We'll defer the setup of other listeners until the modal is shown
      // to ensure elements are properly rendered in the DOM
      
      // Load settings from the server
      loadSettings();
      console.log("Settings modal initialized successfully");
    } catch (err) {
      console.error("Error initializing settings modal:", err);
    }
  }
  
  initialize();
  
  // ===== FUNCTIONALITY =====
  
  // Function to select a tab
  function selectTab(tabId) {
    currentTab = tabId;
    
    // Update tab buttons
    const allTabButtons = tabsContainer.children;
    Array.from(allTabButtons).forEach(button => {
      if (button.dataset.tab === tabId) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
    
    // Update content visibility
    const allTabContents = content.children;
    Array.from(allTabContents).forEach(tabContent => {
      if (tabContent.id === `${tabId}-tab`) {
        tabContent.style.display = 'block';
      } else {
        tabContent.style.display = 'none';
      }
    });
  }
  
  // Function to show notification
  function showNotification(message, success = true) {
    notification.className = success ? 
      'settings-notification success show' : 
      'settings-notification error show';
    
    document.querySelector('.notification-message').textContent = message;
    
    setTimeout(() => {
      notification.classList.remove('show');
    }, 3000);
  }
  
  // Function to add API key
  async function addApiKey(provider) {
    const input = document.getElementById(`${provider}-key`);
    const key = input.value.trim();
    
    if (!key) {
      showNotification('Please enter an API key', false);
      return;
    }
    
    try {
      const response = await fetch('/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider, key })
      });
      
      if (response.ok) {
        input.value = '';
        await loadSettingsFromServer();
        showNotification('API key added successfully', true);
      } else {
        showNotification('Failed to add API key', false);
      }
    } catch (error) {
      console.error('Error adding API key:', error);
      showNotification('Error adding API key', false);
    }
  }
  
  // Function to delete API key
  async function deleteApiKey(provider) {
    try {
      const response = await fetch(`/settings/api-keys/${provider}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      
      if (response.ok) {
        await loadSettingsFromServer();
        showNotification('API key deleted successfully', true);
      } else {
        showNotification('Failed to delete API key', false);
      }
    } catch (error) {
      console.error('Error deleting API key:', error);
      showNotification('Error deleting API key', false);
    }
  }
  
  // Function to update password
  async function updatePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    
    if (!currentPassword || !newPassword) {
      showNotification('Please fill in all password fields', false);
      return;
    }
    
    if (newPassword !== confirmPassword) {
      showNotification('New passwords do not match', false);
      return;
    }
    
    try {
      const response = await fetch('/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });
      
      if (response.ok) {
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
        showNotification('Password updated successfully', true);
      } else {
        showNotification('Failed to update password', false);
      }
    } catch (error) {
      console.error('Error updating password:', error);
      showNotification('Error updating password', false);
    }
  }
  
  // Function to set default engine
  async function setDefaultEngine(engineId) {
    try {
      const response = await fetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preferredEngine: engineId
        })
      });
      
      if (response.ok) {
        settings.preferredEngine = engineId;
        showNotification('Default LLM updated', true);
      } else {
        showNotification('Failed to update default LLM', false);
      }
    } catch (error) {
      console.error('Error setting default engine:', error);
      showNotification('Error updating default LLM', false);
    }
  }
  
  // Function to toggle privacy mode
  async function togglePrivacyMode(enabled) {
    try {
      const response = await fetch('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          privacyMode: enabled
        })
      });
      
      if (response.ok) {
        settings.privacyMode = enabled;
        showNotification(`Privacy mode ${enabled ? 'enabled' : 'disabled'}`, true);
      } else {
        showNotification('Failed to update privacy mode', false);
      }
    } catch (error) {
      console.error('Error toggling privacy mode:', error);
      showNotification('Error updating privacy mode', false);
    }
  }
  
  // Function to load settings from server
  async function loadSettingsFromServer() {
    try {
      const response = await getSettings();
      
      if (response && response.success) {
        const { settings } = response;
        
        // Set API key indicators
        if (settings.apiKeys) {
          Object.keys(settings.apiKeys).forEach(provider => {
            const hasKey = settings.apiKeys[provider];
            if (hasKey) {
              const statusElem = document.getElementById(`${provider}-key-status`);
              if (statusElem) {
                statusElem.textContent = 'API key is set';
                statusElem.className = 'key-status success';
              }
              
              // Update placeholder to indicate key is set
              const input = document.getElementById(`${provider}-key`);
              if (input) {
                input.placeholder = '••••••••••••••••••••••••••';
              }
            }
          });
        }
        
        // Set engine preference
        if (settings.preferences && settings.preferences.defaultEngine) {
          const engineSelect = document.getElementById('engine-select');
          if (engineSelect) {
            engineSelect.value = settings.preferences.defaultEngine;
          }
        }
        
        // Set theme preference
        if (settings.preferences && settings.preferences.theme) {
          const themeSelect = document.getElementById('theme-select');
          if (themeSelect) {
            themeSelect.value = settings.preferences.theme;
          }
        }
        
        // Set accessibility preferences
        if (settings.preferences && settings.preferences.accessibility) {
          const { accessibility } = settings.preferences;
          
          if (accessibility.reduceMotion !== undefined) {
            const reduceMotionToggle = document.getElementById('reduce-motion-toggle');
            if (reduceMotionToggle) {
              reduceMotionToggle.checked = accessibility.reduceMotion;
            }
          }
          
          if (accessibility.highContrast !== undefined) {
            const highContrastToggle = document.getElementById('high-contrast-toggle');
            if (highContrastToggle) {
              highContrastToggle.checked = accessibility.highContrast;
            }
          }
          
          if (accessibility.largeText !== undefined) {
            const largeTextToggle = document.getElementById('large-text-toggle');
            if (largeTextToggle) {
              largeTextToggle.checked = accessibility.largeText;
            }
          }
        }
        
        // Set privacy preferences
        if (settings.preferences && settings.preferences.privacy) {
          const { privacy } = settings.preferences;
          
          if (privacy.saveHistory !== undefined) {
            const saveHistoryToggle = document.getElementById('save-history-toggle');
            if (saveHistoryToggle) {
              saveHistoryToggle.checked = privacy.saveHistory;
            }
          }
          
          if (privacy.analytics !== undefined) {
            const analyticsToggle = document.getElementById('analytics-toggle');
            if (analyticsToggle) {
              analyticsToggle.checked = privacy.analytics;
            }
          }
        }
        
        // Set interface preferences
        if (settings.preferences && settings.preferences.interface) {
          const { interface: ui } = settings.preferences;
          
          if (ui.compactMode !== undefined) {
            const compactModeToggle = document.getElementById('compact-mode-toggle');
            if (compactModeToggle) {
              compactModeToggle.checked = ui.compactMode;
            }
          }
          
          if (ui.showHelp !== undefined) {
            const showHelpToggle = document.getElementById('show-help-toggle');
            if (showHelpToggle) {
              showHelpToggle.checked = ui.showHelp;
            }
          }
        }
        
        // Set LLM preferences
        if (settings.preferences && settings.preferences.llmPreferences) {
          const { llmPreferences } = settings.preferences;
          
          if (llmPreferences.default !== undefined) {
            const defaultModelSelect = document.getElementById('default-llm-model');
            if (defaultModelSelect) {
              defaultModelSelect.value = llmPreferences.default;
            }
          }
          
          if (llmPreferences.code !== undefined) {
            const codeModelSelect = document.getElementById('code-llm-model');
            if (codeModelSelect) {
              codeModelSelect.value = llmPreferences.code;
            }
          }
          
          if (llmPreferences.content !== undefined) {
            const contentModelSelect = document.getElementById('content-llm-model');
            if (contentModelSelect) {
              contentModelSelect.value = llmPreferences.content;
            }
          }
          
          if (llmPreferences.research !== undefined) {
            const researchModelSelect = document.getElementById('research-llm-model');
            if (researchModelSelect) {
              researchModelSelect.value = llmPreferences.research;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showNotification('Error', 'Failed to load settings. Please try again.', 'error');
    }
  }
  
  // Function to render API keys
  function renderApiKeys(keys) {
    Object.keys(keys).forEach(provider => {
      const hasKey = keys[provider];
      if (hasKey) {
        const statusElem = document.getElementById(`${provider}-key-status`);
        if (statusElem) {
          statusElem.textContent = 'API key is set';
          statusElem.className = 'key-status success';
        }
        
        // Update placeholder to indicate key is set
        const input = document.getElementById(`${provider}-key`);
        if (input) {
          input.placeholder = '••••••••••••••••••••••••••';
        }
      }
    });
  }
  
  // Function to render engine options
  function renderEngineOptions(selectedEngine) {
    const container = document.getElementById('engine-options');
    container.innerHTML = '';
    
    engines.forEach(engine => {
      const option = document.createElement('div');
      option.className = 'radio-option';
      
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'default-engine';
      radio.id = `engine-${engine.id}`;
      radio.value = engine.id;
      radio.checked = engine.id === selectedEngine;
      radio.addEventListener('change', () => {
        if (radio.checked) {
          setDefaultEngine(engine.id);
        }
      });
      
      const label = document.createElement('label');
      label.htmlFor = `engine-${engine.id}`;
      label.textContent = engine.name;
      
      option.appendChild(radio);
      option.appendChild(label);
      container.appendChild(option);
    });
  }
  
  // Function to save all settings
  function saveAllSettings() {
    // Any settings not directly tied to API calls
    const interfaceSettings = {
      theme: document.documentElement.getAttribute('data-theme') || 'dark',
      compactMode: document.getElementById('compact-mode-toggle').checked,
      showTimestamps: document.getElementById('timestamps-toggle').checked
    };
    
    const accessibilitySettings = {
      highContrast: document.getElementById('high-contrast-toggle').checked,
      largeText: document.getElementById('large-text-toggle').checked,
      focusOutlines: document.getElementById('focus-outlines-toggle').checked
    };
    
    const llmPreferences = {
      default: document.getElementById('default-llm-model').value,
      code: document.getElementById('code-llm-model').value,
      content: document.getElementById('content-llm-model').value,
      research: document.getElementById('research-llm-model').value
    };
    
    settings.interface = interfaceSettings;
    settings.accessibility = accessibilitySettings;
    settings.llmPreferences = llmPreferences;
    
    // Save to localStorage
    persistSettings(settings);
    
    showNotification('All settings saved', true);
  }
  
  // Function to load settings from the server
  async function loadSettings() {
    try {
      const response = await getSettings();
      
      if (response && response.success) {
        const { settings } = response;
        
        // Set API key indicators
        if (settings.apiKeys) {
          Object.keys(settings.apiKeys).forEach(provider => {
            const hasKey = settings.apiKeys[provider];
            if (hasKey) {
              const statusElem = document.getElementById(`${provider}-key-status`);
              if (statusElem) {
                statusElem.textContent = 'API key is set';
                statusElem.className = 'key-status success';
              }
              
              // Update placeholder to indicate key is set
              const input = document.getElementById(`${provider}-key`);
              if (input) {
                input.placeholder = '••••••••••••••••••••••••••';
              }
            }
          });
        }
        
        // Set engine preference
        if (settings.preferences && settings.preferences.defaultEngine) {
          const engineSelect = document.getElementById('engine-select');
          if (engineSelect) {
            engineSelect.value = settings.preferences.defaultEngine;
          }
        }
        
        // Set theme preference
        if (settings.preferences && settings.preferences.theme) {
          const themeSelect = document.getElementById('theme-select');
          if (themeSelect) {
            themeSelect.value = settings.preferences.theme;
          }
        }
        
        // Set accessibility preferences
        if (settings.preferences && settings.preferences.accessibility) {
          const { accessibility } = settings.preferences;
          
          if (accessibility.reduceMotion !== undefined) {
            const reduceMotionToggle = document.getElementById('reduce-motion-toggle');
            if (reduceMotionToggle) {
              reduceMotionToggle.checked = accessibility.reduceMotion;
            }
          }
          
          if (accessibility.highContrast !== undefined) {
            const highContrastToggle = document.getElementById('high-contrast-toggle');
            if (highContrastToggle) {
              highContrastToggle.checked = accessibility.highContrast;
            }
          }
          
          if (accessibility.largeText !== undefined) {
            const largeTextToggle = document.getElementById('large-text-toggle');
            if (largeTextToggle) {
              largeTextToggle.checked = accessibility.largeText;
            }
          }
        }
        
        // Set privacy preferences
        if (settings.preferences && settings.preferences.privacy) {
          const { privacy } = settings.preferences;
          
          if (privacy.saveHistory !== undefined) {
            const saveHistoryToggle = document.getElementById('save-history-toggle');
            if (saveHistoryToggle) {
              saveHistoryToggle.checked = privacy.saveHistory;
            }
          }
          
          if (privacy.analytics !== undefined) {
            const analyticsToggle = document.getElementById('analytics-toggle');
            if (analyticsToggle) {
              analyticsToggle.checked = privacy.analytics;
            }
          }
        }
        
        // Set interface preferences
        if (settings.preferences && settings.preferences.interface) {
          const { interface: ui } = settings.preferences;
          
          if (ui.compactMode !== undefined) {
            const compactModeToggle = document.getElementById('compact-mode-toggle');
            if (compactModeToggle) {
              compactModeToggle.checked = ui.compactMode;
            }
          }
          
          if (ui.showHelp !== undefined) {
            const showHelpToggle = document.getElementById('show-help-toggle');
            if (showHelpToggle) {
              showHelpToggle.checked = ui.showHelp;
            }
          }
        }
        
        // Set LLM preferences
        if (settings.preferences && settings.preferences.llmPreferences) {
          const { llmPreferences } = settings.preferences;
          
          if (llmPreferences.default !== undefined) {
            const defaultModelSelect = document.getElementById('default-llm-model');
            if (defaultModelSelect) {
              defaultModelSelect.value = llmPreferences.default;
            }
          }
          
          if (llmPreferences.code !== undefined) {
            const codeModelSelect = document.getElementById('code-llm-model');
            if (codeModelSelect) {
              codeModelSelect.value = llmPreferences.code;
            }
          }
          
          if (llmPreferences.content !== undefined) {
            const contentModelSelect = document.getElementById('content-llm-model');
            if (contentModelSelect) {
              contentModelSelect.value = llmPreferences.content;
            }
          }
          
          if (llmPreferences.research !== undefined) {
            const researchModelSelect = document.getElementById('research-llm-model');
            if (researchModelSelect) {
              researchModelSelect.value = llmPreferences.research;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      showNotification('Failed to load settings', 'error');
    }
  }
  
  // Function to show notification
  function showNotification(title, message, type = 'info') {
    const notification = document.querySelector('.settings-notification');
    const titleElem = notification.querySelector('.notification-title');
    const messageElem = notification.querySelector('.notification-message');
    
    // Set content
    titleElem.textContent = title;
    messageElem.textContent = message;
    
    // Set type class
    notification.className = 'settings-notification';
    notification.classList.add(`notification-${type}`);
    
    // Show notification
    notification.style.opacity = '1';
    notification.style.transform = 'translateY(0)';
    
    // Hide after 5 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateY(20px)';
    }, 5000);
  }
  
  // Save LLM Preferences
  const saveLlmPreferences = async () => {
    try {
      // Get values from all selects
      const defaultModel = document.getElementById('default-llm-model').value;
      const codeModel = document.getElementById('code-llm-model').value;
      const contentModel = document.getElementById('content-llm-model').value;
      const researchModel = document.getElementById('research-llm-model').value;
      
      // Prepare data object
      const modelPreferences = {
        default: defaultModel,
        code: codeModel,
        content: contentModel,
        research: researchModel
      };
      
      // Call API
      const response = await saveLlmPreferences(modelPreferences);
      
      if (response && response.success) {
        showNotification('LLM preferences saved successfully', 'success');
      } else {
        throw new Error(response.error || 'Failed to save LLM preferences');
      }
    } catch (error) {
      console.error('Error saving LLM preferences:', error);
      showNotification(`Error: ${error.message || 'Failed to save LLM preferences'}`, 'error');
    }
  };
  
  // Setup API Key Form Listeners
  function setupAPIKeyFormListeners() {
    // Find all API Key save buttons
    const saveButtons = document.querySelectorAll('.save-key-btn');
    Array.from(saveButtons).forEach(button => {
      button.addEventListener('click', async (e) => {
        const inputId = e.target.closest('.settings-form-group').querySelector('input').id;
        const provider = inputId.split('-')[0];
        const apiKey = document.getElementById(inputId).value;
        
        if (apiKey) {
          try {
            const response = await saveApiKey(provider, apiKey);
            if (response && response.success) {
              showNotification('API key saved successfully', 'success');
              document.getElementById(`${provider}-key-status`).textContent = 'API key is set';
              document.getElementById(`${provider}-key-status`).className = 'key-status success';
              document.getElementById(inputId).placeholder = '••••••••••••••••••••••••••';
              document.getElementById(inputId).value = '';
            } else {
              throw new Error(response.error || 'Failed to save API key');
            }
          } catch (error) {
            console.error('Error saving API key:', error);
            showNotification('Error saving API key', 'error');
          }
        }
      });
    });
    
    // Find all API Key delete buttons
    const deleteButtons = document.querySelectorAll('.delete-key-btn');
    Array.from(deleteButtons).forEach(button => {
      button.addEventListener('click', async (e) => {
        const inputId = e.target.closest('.settings-form-group').querySelector('input').id;
        const provider = inputId.split('-')[0];
        
        try {
          const response = await deleteApiKey(provider);
          if (response && response.success) {
            showNotification('API key deleted successfully', 'success');
            document.getElementById(`${provider}-key-status`).textContent = '';
            document.getElementById(`${provider}-key-status`).className = 'key-status';
            document.getElementById(inputId).placeholder = 'Enter API key';
          } else {
            throw new Error(response.error || 'Failed to delete API key');
          }
        } catch (error) {
          console.error('Error deleting API key:', error);
          showNotification('Error deleting API key', 'error');
        }
      });
    });
  }
  
  // Setup Theme Toggle Listeners
  function setupThemeToggleListeners() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('change', (e) => {
        const theme = e.target.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        eventBus.emit('theme-changed', { theme });
        
        // Save theme preference
        const updatedSettings = settings;
        updatedSettings.interface.theme = theme;
        persistSettings(updatedSettings);
      });
    }
  }
  
  // Setup Interface Option Listeners
  function setupInterfaceOptionListeners() {
    // Font size
    const fontSizeSelect = document.getElementById('font-size-select');
    if (fontSizeSelect) {
      fontSizeSelect.addEventListener('change', (e) => {
        const fontSize = e.target.value;
        document.body.style.fontSize = fontSize;
        
        // Save font size preference
        const updatedSettings = settings;
        updatedSettings.interface.fontSize = fontSize;
        persistSettings(updatedSettings);
      });
    }
    
    // Compact mode
    const compactModeToggle = document.getElementById('compact-mode-toggle');
    if (compactModeToggle) {
      compactModeToggle.addEventListener('change', (e) => {
        const compactMode = e.target.checked;
        document.body.classList.toggle('compact-mode', compactMode);
        
        // Save compact mode preference
        const updatedSettings = settings;
        updatedSettings.interface.compactMode = compactMode;
        persistSettings(updatedSettings);
      });
    }
    
    // Show timestamps
    const showTimestampsToggle = document.getElementById('show-timestamps-toggle');
    if (showTimestampsToggle) {
      showTimestampsToggle.addEventListener('change', (e) => {
        const showTimestamps = e.target.checked;
        document.body.classList.toggle('show-timestamps', showTimestamps);
        
        // Save timestamps preference
        const updatedSettings = settings;
        updatedSettings.interface.showTimestamps = showTimestamps;
        persistSettings(updatedSettings);
      });
    }
  }
  
  // Setup Accessibility Option Listeners
  function setupAccessibilityOptionListeners() {
    // High contrast
    const highContrastToggle = document.getElementById('high-contrast-toggle');
    if (highContrastToggle) {
      highContrastToggle.addEventListener('change', (e) => {
        const highContrast = e.target.checked;
        document.body.classList.toggle('high-contrast', highContrast);
        
        // Save high contrast preference
        const updatedSettings = settings;
        updatedSettings.accessibility.highContrast = highContrast;
        persistSettings(updatedSettings);
      });
    }
    
    // Large text
    const largeTextToggle = document.getElementById('large-text-toggle');
    if (largeTextToggle) {
      largeTextToggle.addEventListener('change', (e) => {
        const largeText = e.target.checked;
        document.body.classList.toggle('large-text', largeText);
        
        // Save large text preference
        const updatedSettings = settings;
        updatedSettings.accessibility.largeText = largeText;
        persistSettings(updatedSettings);
      });
    }
    
    // Focus outlines
    const focusOutlinesToggle = document.getElementById('focus-outlines-toggle');
    if (focusOutlinesToggle) {
      focusOutlinesToggle.addEventListener('change', (e) => {
        const focusOutlines = e.target.checked;
        document.body.classList.toggle('focus-outlines', focusOutlines);
        
        // Save focus outlines preference
        const updatedSettings = settings;
        updatedSettings.accessibility.focusOutlines = focusOutlines;
        persistSettings(updatedSettings);
      });
    }
  }
  
  // Setup LLM Preference Listeners
  function setupLLMPreferenceListeners() {
    // Find all LLM model select elements
    const modelSelects = [
      document.getElementById('default-llm-model'),
      document.getElementById('code-llm-model'),
      document.getElementById('content-llm-model'),
      document.getElementById('research-llm-model')
    ];
    
    // Add save button event listener
    const saveLlmSettingsBtn = document.getElementById('save-llm-settings-btn');
    if (saveLlmSettingsBtn) {
      saveLlmSettingsBtn.addEventListener('click', async () => {
        try {
          // Get values from all selects
          const defaultModel = document.getElementById('default-llm-model')?.value || 'gpt-4';
          const codeModel = document.getElementById('code-llm-model')?.value || 'gpt-4';
          const contentModel = document.getElementById('content-llm-model')?.value || 'gpt-4';
          const researchModel = document.getElementById('research-llm-model')?.value || 'gpt-4';
          
          // Prepare data object
          const modelPreferences = {
            default: defaultModel,
            code: codeModel,
            content: contentModel,
            research: researchModel
          };
          
          // Update local settings
          const updatedSettings = settings;
          updatedSettings.llmPreferences = modelPreferences;
          persistSettings(updatedSettings);
          
          // Call API
          const response = await saveLlmPreferences(modelPreferences);
          
          if (response && response.success) {
            showNotification('LLM preferences saved successfully', 'success');
          } else {
            throw new Error(response?.error || 'Failed to save LLM preferences');
          }
        } catch (error) {
          console.error('Error saving LLM preferences:', error);
          showNotification(`Error: ${error.message || 'Failed to save LLM preferences'}`, 'error');
        }
      });
    }
  }
  
  // Show modal
  function show() {
    if (!isVisible) {
      try {
        console.log("Showing settings modal");
        overlay.style.display = 'flex';
        
        // Set up form listeners now that elements are in the DOM
        setupAPIKeyFormListeners();
        setupThemeToggleListeners();
        setupInterfaceOptionListeners();
        setupAccessibilityOptionListeners();
        setupLLMPreferenceListeners();
        
        // Then proceed with animation
        setTimeout(() => {
          overlay.classList.add('visible');
          isVisible = true;
          eventBus.emit('settings-modal-shown');
        }, 10);
        
        // Load settings from server when showing
        loadSettings();
      } catch (err) {
        console.error("Error showing settings modal:", err);
      }
    }
  }
  
  // Hide modal
  function hide() {
    if (isVisible) {
      overlay.classList.remove('visible');
      setTimeout(() => {
        overlay.style.display = 'none';
        isVisible = false;
        eventBus.emit('settings-modal-hidden');
      }, 300);
    }
  }
  
  // Handle clicks on the overlay background
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      hide();
    }
  });
  
  // Add ESC key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isVisible) {
      hide();
    }
  });
  
  // Add API methods to the container element
  container.show = show;
  container.hide = hide;
  container.toggle = () => (isVisible ? hide() : show());
  
  // Return the container element instead of just an object with methods
  return container;
}

// Create a singleton instance
let modalInstance = null;

export function getSettingsModal() {
  if (!modalInstance) {
    modalInstance = SettingsModal();
    // No need to append to DOM here, we're already returning the DOM element
  }
  return modalInstance;
}

// No need for DOMContentLoaded listener since we'll initialize on-demand
// through the singleton pattern when getSettingsModal() is called

export default {
  getSettingsModal
};
