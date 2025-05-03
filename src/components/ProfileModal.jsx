/**
 * Profile Modal Component
 * Displays user profile information and allows for updates
 */

import { eventBus } from '../utils/events.js';
import { getUserSettings } from '../api/settings.js';
import { getSettingsModal } from './Settings.jsx';

// Create a singleton instance
let profileModalInstance = null;

// Factory function to get or create the instance
export function getProfileModal() {
  if (!profileModalInstance) {
    profileModalInstance = new ProfileModal();
  }
  return profileModalInstance;
}

class ProfileModal {
  constructor() {
    this.isVisible = false;
    this.containerId = 'profile-modal';
    this.overlay = null;
    this.container = null;
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize());
    } else {
      this.initialize();
    }
  }
  
  initialize() {
    // Create container if it doesn't exist
    this.container = document.createElement('div');
    this.container.id = this.containerId + '-container';
    
    // Create overlay container
    this.overlay = document.createElement('div');
    this.overlay.className = 'profile-modal-overlay';
    this.overlay.id = this.containerId;
    
    // Create modal content
    const modalContainer = document.createElement('div');
    modalContainer.className = 'profile-modal';
    
    modalContainer.innerHTML = `
      <div class="profile-modal-header">
        <h2><i class="fas fa-user-circle"></i> User Profile</h2>
        <button class="close-btn"><i class="fas fa-times"></i></button>
      </div>
      
      <div class="profile-modal-content">
        <div class="profile-tabs">
          <div class="profile-tab active" data-tab="profile">
            <i class="fas fa-user"></i>
            <span>Profile</span>
          </div>
          <div class="profile-tab" data-tab="settings">
            <i class="fas fa-cog"></i>
            <span>Settings</span>
          </div>
          <div class="profile-tab" data-tab="billing">
            <i class="fas fa-credit-card"></i>
            <span>Billing</span>
          </div>
        </div>
        
        <div class="profile-tab-content">
          <!-- Profile Tab -->
          <div class="tab-content active" id="profile-tab">
            <div class="profile-avatar">
              <i class="fas fa-user-circle"></i>
            </div>
            
            <div class="profile-info">
              <div class="form-group">
                <label for="profile-name">Display Name</label>
                <input type="text" id="profile-name" class="text-input" placeholder="Your Name" />
              </div>
              
              <div class="form-group">
                <label for="profile-email">Email</label>
                <input type="email" id="profile-email" class="text-input" placeholder="your.email@example.com" disabled />
                <span class="input-help">Email cannot be changed</span>
              </div>
              
              <div class="form-group">
                <label for="profile-role">Role</label>
                <input type="text" id="profile-role" class="text-input" placeholder="User" disabled />
              </div>
              
              <div class="form-group">
                <label for="profile-joined">Joined</label>
                <input type="text" id="profile-joined" class="text-input" placeholder="January 1, 2023" disabled />
              </div>
            </div>
            
            <div class="profile-stats">
              <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-tasks"></i></div>
                <div class="stat-value" id="tasks-count">0</div>
                <div class="stat-label">Tasks</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-clock"></i></div>
                <div class="stat-value" id="active-days">0</div>
                <div class="stat-label">Days Active</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-bolt"></i></div>
                <div class="stat-value" id="completed-actions">0</div>
                <div class="stat-label">Actions</div>
              </div>
            </div>
          </div>
          
          <!-- Settings Summary Tab -->
          <div class="tab-content" id="settings-tab">
            <h3 class="section-title"><i class="fas fa-sliders-h"></i> Your Settings</h3>
            
            <div class="settings-summary">
              <div class="settings-summary-section">
                <h4><i class="fas fa-palette"></i> Interface</h4>
                <div class="settings-summary-item">
                  <span class="item-label">Theme:</span>
                  <span class="item-value" id="summary-theme">Dark</span>
                </div>
                <div class="settings-summary-item">
                  <span class="item-label">Font Size:</span>
                  <span class="item-value" id="summary-font-size">Medium</span>
                </div>
                <div class="settings-summary-item">
                  <span class="item-label">Compact Mode:</span>
                  <span class="item-value" id="summary-compact-mode">Off</span>
                </div>
              </div>
              
              <div class="settings-summary-section">
                <h4><i class="fas fa-universal-access"></i> Accessibility</h4>
                <div class="settings-summary-item">
                  <span class="item-label">High Contrast:</span>
                  <span class="item-value" id="summary-high-contrast">Off</span>
                </div>
                <div class="settings-summary-item">
                  <span class="item-label">Large Text:</span>
                  <span class="item-value" id="summary-large-text">Off</span>
                </div>
              </div>
              
              <div class="settings-summary-section">
                <h4><i class="fas fa-robot"></i> LLM Models</h4>
                <div class="settings-summary-item">
                  <span class="item-label">Default:</span>
                  <span class="item-value" id="summary-default-model">GPT-4</span>
                </div>
                <div class="settings-summary-item">
                  <span class="item-label">Code:</span>
                  <span class="item-value" id="summary-code-model">GPT-4</span>
                </div>
                <div class="settings-summary-item">
                  <span class="item-label">Content:</span>
                  <span class="item-value" id="summary-content-model">GPT-4</span>
                </div>
              </div>
              
              <div class="settings-summary-section">
                <h4><i class="fas fa-key"></i> API Keys</h4>
                <div class="settings-summary-item">
                  <span class="item-label">OpenAI:</span>
                  <span class="item-value api-key-status" id="summary-openai-key">Not Set</span>
                </div>
                <div class="settings-summary-item">
                  <span class="item-label">Google AI:</span>
                  <span class="item-value api-key-status" id="summary-google-key">Not Set</span>
                </div>
                <div class="settings-summary-item">
                  <span class="item-label">Anthropic:</span>
                  <span class="item-value api-key-status" id="summary-anthropic-key">Not Set</span>
                </div>
              </div>
            </div>
            
            <div class="settings-cta">
              <button class="open-settings-btn" id="open-settings-btn">
                <i class="fas fa-cog"></i> Manage Settings
              </button>
            </div>
          </div>
          
          <!-- Billing Tab -->
          <div class="tab-content" id="billing-tab">
            <h3 class="section-title"><i class="fas fa-credit-card"></i> Billing & Usage</h3>
            
            <div class="token-balance-container">
              <div class="token-balance">
                <div class="token-icon">Ꞧ</div>
                <div class="token-amount">0</div>
                <div class="token-label">$RATOR Tokens</div>
              </div>
              <button class="buy-tokens-btn">
                <i class="fas fa-plus-circle"></i> Buy Tokens
              </button>
            </div>
            
            <div class="usage-stats">
              <h4><i class="fas fa-chart-line"></i> Usage Statistics</h4>
              
              <div class="usage-chart-container">
                <div class="usage-chart-placeholder">
                  <div class="no-data-message">
                    <i class="fas fa-chart-bar"></i>
                    <p>Usage data will appear here as you use the platform</p>
                  </div>
                </div>
              </div>
              
              <div class="usage-metrics">
                <div class="usage-metric">
                  <div class="metric-label">API Calls</div>
                  <div class="metric-value">0</div>
                </div>
                <div class="usage-metric">
                  <div class="metric-label">Tokens Used</div>
                  <div class="metric-value">0</div>
                </div>
                <div class="usage-metric">
                  <div class="metric-label">Est. Cost</div>
                  <div class="metric-value">$0.00</div>
                </div>
              </div>
            </div>
            
            <div class="billing-section">
              <h4><i class="fas fa-wallet"></i> Token Management</h4>
              <p class="section-description">
                Use $RATOR tokens for a 50% discount on API calls, or pay with other cryptocurrencies.
              </p>
              
              <div class="token-options">
                <div class="token-option">
                  <div class="token-option-header">
                    <i class="fas fa-coins"></i>
                    <span>$RATOR</span>
                  </div>
                  <div class="token-option-body">
                    <p>Native platform token with 50% discount on API calls</p>
                    <button class="option-btn">Buy $RATOR</button>
                  </div>
                </div>
                
                <div class="token-option">
                  <div class="token-option-header">
                    <i class="fab fa-ethereum"></i>
                    <span>ETH/USDC</span>
                  </div>
                  <div class="token-option-body">
                    <p>Pay with Ethereum or USDC stablecoins</p>
                    <button class="option-btn">Buy with ETH/USDC</button>
                  </div>
                </div>
                
                <div class="token-option">
                  <div class="token-option-header">
                    <i class="fab fa-bitcoin"></i>
                    <span>BTC</span>
                  </div>
                  <div class="token-option-body">
                    <p>Pay with Bitcoin via Lightning Network</p>
                    <button class="option-btn">Buy with BTC</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="profile-modal-footer">
        <button class="cancel-btn">Cancel</button>
        <button class="save-btn">Save Changes</button>
      </div>
    `;
    
    // Add to DOM
    this.overlay.appendChild(modalContainer);
    this.container.appendChild(this.overlay);
    document.body.appendChild(this.container);
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Set initial styles
    this.overlay.style.display = 'none';
  }
  
  setupEventListeners() {
    // Close on overlay click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });
    
    // Close button
    const closeBtn = this.overlay.querySelector('.close-btn');
    closeBtn.addEventListener('click', () => this.hide());
    
    // Cancel button
    const cancelBtn = this.overlay.querySelector('.cancel-btn');
    cancelBtn.addEventListener('click', () => this.hide());
    
    // Save button
    const saveBtn = this.overlay.querySelector('.save-btn');
    saveBtn.addEventListener('click', () => this.saveProfile());
    
    // Escape key handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });
    
    // Open settings button
    const openSettingsBtn = this.overlay.querySelector('#open-settings-btn');
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => {
        this.hide();
        // Use setTimeout to prevent UI flicker
        setTimeout(() => {
          const settingsModal = getSettingsModal();
          if (settingsModal && typeof settingsModal.show === 'function') {
            settingsModal.show();
          }
        }, 300);
      });
    }
    
    // Tab switching
    const tabs = this.overlay.querySelectorAll('.profile-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.getAttribute('data-tab');
        this.switchTab(tabId);
      });
    });
    
    // Listen for profile events - both old and new patterns
    eventBus.on('toggle-profile-modal', () => this.toggle());
    eventBus.on('open-profile', () => this.show());
  }
  
  switchTab(tabId) {
    // Update tab buttons
    const tabs = this.overlay.querySelectorAll('.profile-tab');
    tabs.forEach(tab => {
      if (tab.getAttribute('data-tab') === tabId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    
    // Update tab content
    const tabContents = this.overlay.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
      if (content.id === `${tabId}-tab`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }
  
  async loadProfile() {
    try {
      // Load user profile data
      const profile = await this.fetchProfileData();
      if (profile) {
        this.updateProfileUI(profile);
      }
      
      // Load settings summary
      await this.loadSettingsSummary();
    } catch (error) {
      console.error('Error loading profile data', error);
    }
  }
  
  async fetchProfileData() {
    // Mock data for now - would be replaced with real API call
    return {
      name: 'Test User',
      email: 'user@example.com',
      role: 'Admin',
      joinedDate: '2023-01-15',
      stats: {
        tasksCount: 24,
        activeDays: 45,
        completedActions: 156
      }
    };
  }
  
  updateProfileUI(profile) {
    // Update profile form fields
    const nameInput = document.getElementById('profile-name');
    const emailInput = document.getElementById('profile-email');
    const roleInput = document.getElementById('profile-role');
    const joinedInput = document.getElementById('profile-joined');
    
    if (nameInput) nameInput.value = profile.name;
    if (emailInput) emailInput.value = profile.email;
    if (roleInput) roleInput.value = profile.role;
    
    // Format joined date
    if (joinedInput && profile.joinedDate) {
      const date = new Date(profile.joinedDate);
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      joinedInput.value = date.toLocaleDateString('en-US', options);
    }
    
    // Update stats
    const tasksCount = document.getElementById('tasks-count');
    const activeDays = document.getElementById('active-days');
    const completedActions = document.getElementById('completed-actions');
    
    if (tasksCount) tasksCount.textContent = profile.stats.tasksCount;
    if (activeDays) activeDays.textContent = profile.stats.activeDays;
    if (completedActions) completedActions.textContent = profile.stats.completedActions;
  }
  
  async loadSettingsSummary() {
    try {
      // Fetch user settings from API
      const settings = await getUserSettings();
      
      // Update interface settings summary
      this.updateInterfaceSettingsSummary(settings);
      
      // Update accessibility settings summary
      this.updateAccessibilitySettingsSummary(settings);
      
      // Update LLM model preferences
      this.updateLLMSettingsSummary(settings);
      
      // Update API keys status
      this.updateAPIKeysSummary(settings);
      
    } catch (error) {
      console.error('Error loading settings summary', error);
    }
  }
  
  updateInterfaceSettingsSummary(settings) {
    const themeEl = document.getElementById('summary-theme');
    const fontSizeEl = document.getElementById('summary-font-size');
    const compactModeEl = document.getElementById('summary-compact-mode');
    
    if (settings.interface) {
      if (themeEl && settings.interface.theme) {
        themeEl.textContent = settings.interface.theme === 'dark' ? 'Dark' : 'Light';
      }
      
      if (fontSizeEl && settings.interface.fontSize) {
        fontSizeEl.textContent = this.capitalizeFirstLetter(settings.interface.fontSize);
      }
      
      if (compactModeEl && settings.interface.compactMode !== undefined) {
        compactModeEl.textContent = settings.interface.compactMode ? 'On' : 'Off';
      }
    }
  }
  
  updateAccessibilitySettingsSummary(settings) {
    const highContrastEl = document.getElementById('summary-high-contrast');
    const largeTextEl = document.getElementById('summary-large-text');
    
    if (settings.accessibility) {
      if (highContrastEl && settings.accessibility.highContrast !== undefined) {
        highContrastEl.textContent = settings.accessibility.highContrast ? 'On' : 'Off';
      }
      
      if (largeTextEl && settings.accessibility.largeText !== undefined) {
        largeTextEl.textContent = settings.accessibility.largeText ? 'On' : 'Off';
      }
    }
  }
  
  updateLLMSettingsSummary(settings) {
    const defaultModelEl = document.getElementById('summary-default-model');
    const codeModelEl = document.getElementById('summary-code-model');
    const contentModelEl = document.getElementById('summary-content-model');
    
    if (settings.llmPreferences) {
      if (defaultModelEl && settings.llmPreferences.defaultModel) {
        defaultModelEl.textContent = settings.llmPreferences.defaultModel;
      }
      
      if (codeModelEl && settings.llmPreferences.codeModel) {
        codeModelEl.textContent = settings.llmPreferences.codeModel;
      }
      
      if (contentModelEl && settings.llmPreferences.contentModel) {
        contentModelEl.textContent = settings.llmPreferences.contentModel;
      }
    }
  }
  
  updateAPIKeysSummary(settings) {
    const openaiKeyEl = document.getElementById('summary-openai-key');
    const googleKeyEl = document.getElementById('summary-google-key');
    const anthropicKeyEl = document.getElementById('summary-anthropic-key');
    
    // Helper function to update key status
    const updateKeyStatus = (element, isSet) => {
      if (element) {
        element.textContent = isSet ? 'Set' : 'Not Set';
        if (isSet) {
          element.classList.add('set');
        } else {
          element.classList.remove('set');
        }
      }
    };
    
    if (settings.apiKeys) {
      updateKeyStatus(openaiKeyEl, settings.apiKeys.openai);
      updateKeyStatus(googleKeyEl, settings.apiKeys.google);
      updateKeyStatus(anthropicKeyEl, settings.apiKeys.anthropic);
    }
  }
  
  saveProfile() {
    try {
      // Get form values
      const name = document.getElementById('profile-name').value;
      
      // Validate form
      if (!name.trim()) {
        this.showNotification('Please enter a display name', 'error');
        return;
      }
      
      // Save profile data
      // This would be replaced with a real API call
      
      // Show success notification
      this.showNotification('Profile updated successfully', 'success');
      
      // Close modal
      setTimeout(() => {
        this.hide();
      }, 1500);
    } catch (error) {
      console.error('Error saving profile', error);
      this.showNotification('Failed to update profile', 'error');
    }
  }
  
  showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.querySelector('.profile-notification');
    if (!notification) {
      notification = document.createElement('div');
      notification.className = 'profile-notification';
      document.body.appendChild(notification);
      
      // Create message element
      const messageEl = document.createElement('p');
      messageEl.className = 'notification-message';
      notification.appendChild(messageEl);
    }
    
    // Update notification
    const messageEl = notification.querySelector('.notification-message');
    messageEl.textContent = message;
    
    // Set type
    notification.className = 'profile-notification';
    notification.classList.add(type);
    
    // Show notification
    setTimeout(() => {
      notification.classList.add('show');
    }, 10);
    
    // Hide notification after 3 seconds
    setTimeout(() => {
      notification.classList.remove('show');
      
      // Remove from DOM after animation
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 3000);
  }
  
  capitalizeFirstLetter(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
  
  show() {
    if (!this.isVisible) {
      this.overlay.style.display = 'flex';
      setTimeout(() => this.overlay.classList.add('visible'), 10);
      this.isVisible = true;
      
      // Load profile data when showing
      this.loadProfile();
      
      // Emit event
      eventBus.emit('profile-modal-shown');
    }
  }
  
  hide() {
    if (this.isVisible) {
      this.overlay.classList.remove('visible');
      setTimeout(() => {
        this.overlay.style.display = 'none';
        this.isVisible = false;
        
        // Emit event
        eventBus.emit('profile-modal-hidden');
      }, 300);
    }
  }
  
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
}

export default getProfileModal;
