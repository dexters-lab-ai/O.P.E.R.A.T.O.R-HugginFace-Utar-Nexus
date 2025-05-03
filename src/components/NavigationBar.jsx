/**
 * Navigation Bar Component
 * Main application header with navigation controls and user information
 */

console.log('[NAVIGATION-BAR] Component file loaded');

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import api from '../utils/api.js';
// UI and Task stores
const { ui: uiStore, tasks: tasksStore } = stores;
import Button from './base/Button.jsx';
import { getHistoryOverlay } from './HistoryOverlay.jsx';
import { getSettingsModal } from './Settings.jsx';
import { getGuideOverlay } from './GuideOverlay.jsx';
import { getProfileModal } from './ProfileModal.jsx';

// DEBUG: Log initialization
console.log('[NAVIGATION-BAR] Component initialized');

/**
 * Create a navigation bar component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Navigation bar container
 */
export function NavigationBar(props = {}) {
  const {
    containerId = 'navigation-bar'
  } = props;

  // State
  let isMinimized = false;
  
  // Create component container
  const container = document.createElement('div');
  container.className = 'navigation-bar';
  if (containerId) container.id = containerId;
  
  // Use MutationObserver to detect removal from DOM
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.removedNodes.forEach((removed) => {
        if (removed === container) {
          console.warn('[NAVIGATION-BAR] Element was removed from DOM!');
        }
      });
    });
  });
  if (container.parentNode) {
    observer.observe(container.parentNode, { childList: true });
  }
  
  // Create branding section
  const branding = document.createElement('div');
  branding.className = 'nav-branding';
  
  const logo = document.createElement('div');
  logo.className = 'nav-logo';
  logo.innerHTML = '<span>O.P.E.R.A.T.O.R</span>';
  
  branding.appendChild(logo);
  
  // Navigation links completely removed as they're redundant with the top-right buttons
  
  // Create tools section
  const tools = document.createElement('div');
  tools.className = 'nav-tools';
  
  // Create theme toggle
  const themeToggle = Button({
    icon: 'fa-moon',
    variant: Button.VARIANTS.TEXT,
    className: 'nav-tool theme-toggle',
    title: 'Toggle dark/light mode',
    onClick: () => {
      eventBus.emit('theme-change', { 
        theme: document.documentElement.getAttribute('data-theme') === 'dark' 
          ? 'light' 
          : 'dark'
      });
    }
  });
  
  // Create layout toggle
  const layoutToggle = Button({
    icon: 'fa-columns',
    variant: Button.VARIANTS.TEXT,
    className: 'nav-tool layout-toggle',
    title: 'Change layout',
    onClick: () => {
      showLayoutMenu(layoutToggle);
    }
  });
  // hide removed layout toggle
  layoutToggle.style.display = 'none';
  
  // Create settings button
  const settingsButton = Button({
    icon: 'fa-cog',
    variant: Button.VARIANTS.TEXT,
    className: 'nav-tool settings-button',
    title: 'Settings',
    onClick: () => {
      getSettingsModal().show();
    }
  });
  
  // Create guide button
  const guideButton = Button({
    icon: 'fa-book',
    variant: Button.VARIANTS.TEXT,
    className: 'nav-tool guide-button',
    title: 'Guide',
    onClick: () => {
      getGuideOverlay().show();
    }
  });
  
  // Create history button
  const historyButton = Button({
    icon: 'fa-history',
    variant: Button.VARIANTS.TEXT,
    className: 'nav-tool history-button',
    title: 'History',
    onClick: () => {
      getHistoryOverlay().show();
    }
  });
  
  // Task indicator button
  const tasksButton = document.createElement('div');
  tasksButton.className = 'nav-tool tasks-button';
  tasksButton.title = 'Active Tasks';
  // Badge element
  const tasksBadge = document.createElement('span');
  tasksBadge.className = 'badge';
  tasksBadge.style.display = 'none';
  tasksButton.innerHTML = '<i class="fas fa-tasks"></i>';
  tasksButton.appendChild(tasksBadge);
  tasksButton.addEventListener('click', () => uiStore.setState({ activeTab: 'active-tasks' }));
  // Subscribe to task count
  tasksStore.subscribe(state => {
    const count = state.active.length;
    tasksBadge.textContent = count;
    tasksBadge.style.display = count > 0 ? 'inline-block' : 'none';
  });
  
  // --- USER MENU ---
  // Create user menu button (avatar)
  const userButton = document.createElement('div');
  userButton.className = 'nav-tool user-menu-btn';
  userButton.title = 'User Menu';
  userButton.innerHTML = '<i class="fas fa-user-circle"></i>';
  userButton.style.position = 'relative';
  tools.appendChild(userButton);

  // Create dropdown menu container
  const userMenu = document.createElement('div');
  userMenu.className = 'user-menu';
  userMenu.tabIndex = -1;
  
  // Get user email from localStorage or use placeholder
  const userEmail = localStorage.getItem('userEmail') || 'user@example.com';
  const displayName = localStorage.getItem('displayName') || 'User';
  
  userMenu.innerHTML = `
    <div class="user-menu-header">
      <div class="user-menu-avatar">
        <i class="fas fa-user"></i>
      </div>
      <div class="user-menu-name">${displayName}</div>
      <div class="user-menu-email">${userEmail}</div>
    </div>
    <button class="user-menu-item" data-action="profile" tabindex="0"><i class="fas fa-user"></i> Profile</button>
    <button class="user-menu-item" data-action="preferences" tabindex="0"><i class="fas fa-cog"></i> Preferences</button>
    <button class="user-menu-item" data-action="theme" tabindex="0"><i class="fas fa-moon"></i> Switch Theme</button>
    <button class="user-menu-item" data-action="copy-id" tabindex="0"><i class="fas fa-copy"></i> Copy User ID</button>
    <div class="menu-separator"></div>
    <button class="user-menu-item" data-action="logout" tabindex="0"><i class="fas fa-sign-out-alt"></i> Logout</button>
    <button class="user-menu-item delete-account" data-action="delete-account" tabindex="0"><i class="fas fa-user-slash"></i> Delete Account</button>
  `;
  userButton.appendChild(userMenu);

  // --- Dropdown Positioning ---
  function showUserMenu() {
    userMenu.style.display = 'block';
    userMenu.focus();
    // Position absolutely below userButton, right aligned
    const rect = userButton.getBoundingClientRect();
    userMenu.style.position = 'absolute';
    userMenu.style.top = rect.height + 8 + 'px';
    userMenu.style.right = '0px';
    userMenu.style.left = 'auto';
    userMenu.style.minWidth = '220px';
    userMenu.style.zIndex = 9999;
  }
  function hideUserMenu() {
    userMenu.style.display = 'none';
  }
  userButton.onclick = (e) => {
    e.stopPropagation();
    if (userMenu.style.display === 'block') hideUserMenu();
    else showUserMenu();
  };
  // Hide menu on outside click or ESC
  document.addEventListener('mousedown', (e) => {
    if (!userMenu.contains(e.target) && !userButton.contains(e.target)) hideUserMenu();
  });
  userMenu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideUserMenu();
  });

  // --- User Menu Actions ---
  userMenu.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('user-menu-item')) return;
    const action = e.target.getAttribute('data-action');
    switch (action) {
      case 'profile':
        hideUserMenu();
        getProfileModal().show();
        break;
      case 'preferences':
        // Use the singleton settings modal
        hideUserMenu();
        getSettingsModal().show();
        break;
      case 'theme':
        eventBus.emit('theme-change', { theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark' });
        break;
      case 'copy-id':
        const uid = localStorage.getItem('userId') || 'unknown';
        navigator.clipboard.writeText(uid).then(() => {
          e.target.textContent = 'Copied!';
          setTimeout(() => { e.target.innerHTML = '<i class="fas fa-copy"></i> Copy User ID'; }, 1200);
        });
        break;
      case 'logout':
        try {
          await api.auth.logout();
        } catch (err) {}
        window.location.href = '/login.html';
        break;
      case 'delete-account':
        if (confirm('Are you sure you want to delete your account? This cannot be undone.')) {
          try {
            const res = await api.auth.deleteAccount();
            if (res && res.success) {
              window.location.href = '/login.html';
            } else {
              alert(res && res.error ? res.error : 'Failed to delete account.');
            }
          } catch (err) {
            alert('Failed to delete account.');
          }
        }
        break;
    }
    hideUserMenu();
  });

  // Keyboard navigation for accessibility
  userMenu.addEventListener('keydown', (e) => {
    const items = Array.from(userMenu.querySelectorAll('.user-menu-item'));
    let idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    }
  });

  // Add to tools section (top right)
  tools.appendChild(userButton);

  // Create user profile button
  const userButtonOld = document.createElement('div');
  userButtonOld.className = 'user-profile';
  userButtonOld.innerHTML = `
    <div class="user-avatar">
      <i class="fas fa-user"></i>
    </div>
    <div class="user-info">
      <div class="user-name">User</div>
      <div class="user-status">
        <span class="status-indicator online"></span>
        <div class="status-text">Active</div>
      </div>
    </div>
  `;

  // --- User Menu Dropdown ---
  const userMenuOld = document.createElement('div');
  userMenuOld.className = 'dropdown-menu';
  userMenuOld.style.display = 'none';

  // Add user info to menu
  const userInfo = document.createElement('div');
  userInfo.className = 'dropdown-user-info';
  userInfo.innerHTML = `
    <div class="user-avatar">
      <i class="fas fa-user"></i>
    </div>
    <div class="user-data">
      <div class="user-name">User</div>
      <div class="user-email">user@example.com</div>
    </div>
  `;
  userMenuOld.appendChild(userInfo);

  window.addEventListener('click', (e) => {
    if (!userMenuOld.contains(e.target) && !userButtonOld.contains(e.target)) {
      userMenuOld.classList.remove('open');
      userMenuOld.style.display = 'none';
    }
  });

  // Add divider
  const divider = document.createElement('div');
  divider.className = 'dropdown-divider';
  userMenuOld.appendChild(divider);

  // Create menu items
  const menuItems = [
    { text: 'Profile', icon: 'fa-user', action: 'profile' },
    { text: 'Preferences', icon: 'fa-sliders-h', action: 'settings' },
    { text: 'Logout', icon: 'fa-sign-out-alt', action: 'logout' }
  ];

  // Add menu items to dropdown
  menuItems.forEach(item => {
    const menuItem = document.createElement('a');
    menuItem.href = '#';
    menuItem.className = 'dropdown-item';
    menuItem.innerHTML = `<i class="fas ${item.icon}"></i> ${item.text}`;
    menuItem.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.action === 'logout') {
        window.location.href = '/logout';
      } else if (item.action === 'settings') {
        getSettingsModal().show();
      } else {
        eventBus.emit(item.action);
      }
      userMenuOld.classList.remove('open');
      userMenuOld.style.display = 'none';
    });
    userMenuOld.appendChild(menuItem);
  });

  // Add tools to container
  tools.appendChild(themeToggle);
  tools.appendChild(layoutToggle);
  tools.appendChild(settingsButton);
  tools.appendChild(guideButton);
  tools.appendChild(historyButton);
  tools.appendChild(tasksButton);
  // tools.appendChild(userButtonOld);

  // Assemble navbar
  container.appendChild(branding);
  // Navigation links completely removed so we don't append them anymore
  container.appendChild(tools);

  // Initialize menus at component creation
  const layoutMenu = document.createElement('div');
  layoutMenu.className = 'dropdown-menu';
  layoutMenu.style.display = 'none';

  // Helper to hide all dropdown menus
  function hideMenus() {
    userMenuOld.style.display = 'none';
  }

  // Show layout menu positioned below button
  function showLayoutMenu(button) {
    hideMenus();
    layoutMenu.style.display = 'block';
    const rect = button.getBoundingClientRect();
    layoutMenu.style.left = `${rect.right - layoutMenu.offsetWidth}px`;
    layoutMenu.style.top = `${rect.bottom}px`;
  }

  // Create layout menu items
  const layoutPresets = [
    { 
      id: 'default', 
      name: 'Default', 
      icon: 'fa-columns',
      description: 'Balanced view with sidebar and main content'
    },
    { 
      id: 'centered', 
      name: 'Centered', 
      icon: 'fa-align-center',
      description: 'Focus on content with minimal distractions'
    },
    { 
      id: 'focus', 
      name: 'Focus Mode', 
      icon: 'fa-bullseye',
      description: 'Maximize content area for focused work'
    },
    { 
      id: 'expanded', 
      name: 'Expanded', 
      icon: 'fa-expand',
      description: 'Wide layout showing all panels'
    }
  ];
  
  layoutPresets.forEach((option) => {
    const menuItem = document.createElement('div');
    menuItem.className = 'dropdown-item layout-option';
    menuItem.dataset.layout = option.id;
    menuItem.innerHTML = `
      <div class="layout-icon">
        <i class="fas ${option.icon}"></i>
      </div>
      <div class="layout-info">
        <div class="layout-name">${option.name}</div>
        <div class="layout-description">${option.description}</div>
      </div>
      <div class="layout-check">
        <i class="fas fa-check"></i>
      </div>
    `;
    
    menuItem.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Add loading state
      menuItem.classList.add('loading');
      
      // Emit event with error handling
      try {
        eventBus.emit('layout-change-requested', { 
          preset: option.id,
          callback: (success) => {
            menuItem.classList.remove('loading');
            if (success) {
              // Update active state
              layoutMenu.querySelectorAll('.dropdown-item').forEach(item => {
                item.classList.toggle('active', item.dataset.layout === option.id);
              });
              localStorage.setItem('layout_preset', option.id);
            }
          }
        });
      } catch (err) {
        console.error('Layout change failed:', err);
        menuItem.classList.remove('loading');
      }
      
      hideMenus();
    });
    
    // Set initial active state
    const currentLayout = localStorage.getItem('layout_preset') || 'default';
    if (option.id === currentLayout) {
      menuItem.classList.add('active');
    }
    
    layoutMenu.appendChild(menuItem);
  });

  document.body.appendChild(layoutMenu);

  console.log('[DEBUG] NavigationBar container:', container);

  /**
   * Update theme toggle icon based on current theme
   */
  function updateThemeToggle() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const themeIcon = themeToggle.querySelector('i');
    
    if (themeIcon) {
      themeIcon.className = `fas ${currentTheme === 'dark' ? 'fa-sun' : 'fa-moon'}`;
    }
  }
  
  /**
   * Update username and info if available
   */
  function updateUserInfo(userData) {
    if (!userData) return;
    
    const userNameElements = container.querySelectorAll('.user-name');
    const userEmailElement = container.querySelector('.user-email');
    
    userNameElements.forEach(element => {
      element.textContent = userData.name || 'User';
    });
    
    if (userEmailElement && userData.email) {
      userEmailElement.textContent = userData.email;
    }
  }
  
  /**
   * Initialize the component
   */
  function initialize() {
    // Update theme toggle based on current theme
    updateThemeToggle();
    
    // Set up event listeners
    const unsubscribeTheme = eventBus.on('theme-changed', () => {
      updateThemeToggle();
    });
    
    // Listen for user data updates
    const unsubscribeUser = eventBus.on('user-data-updated', (userData) => {
      updateUserInfo(userData);
    });
    
    // Subscribe to store changes
    const unsubscribeStore = stores.ui.subscribe((state) => {
      // Update minimized state
      if (state.navbarMinimized !== undefined && state.navbarMinimized !== isMinimized) {
        isMinimized = state.navbarMinimized;
        
        // Update navigation text
        navigation.querySelectorAll('.nav-link').forEach(link => {
          const text = link.querySelector('span:not(.fas)');
          if (text) {
            text.style.display = isMinimized ? 'none' : 'inline';
          }
        });
        
        // Update container class
        container.classList.toggle('minimized', isMinimized);
      }
    });
    
    // Try to get user data
    fetch('/api/auth/user')
      .then(response => response.json())
      .then(data => {
        if (data.success && data.user) {
          updateUserInfo(data.user);
        }
      })
      .catch(error => {
        console.error('Failed to fetch user data:', error);
      });
    
    // Return cleanup function
    return () => {
      unsubscribeTheme();
      unsubscribeUser();
      unsubscribeStore();
      
      hideMenus();
    };
  }
  
  // Initialize component
  const cleanup = initialize();
  
  // Expose public methods
  container.minimize = () => {
    isMinimized = true;
    container.classList.add('minimized');
    stores.ui.setState({ navbarMinimized: true });
  };
  
  container.expand = () => {
    isMinimized = false;
    container.classList.remove('minimized');
    stores.ui.setState({ navbarMinimized: false });
  };
  
  container.toggle = () => {
    if (isMinimized) {
      container.expand();
    } else {
      container.minimize();
    }
  };
  
  // Cleanup method
  container.destroy = () => {
    cleanup();
    
    // Remove event listeners
    container.querySelectorAll('button').forEach(button => {
      button.removeEventListener('click', null);
    });
    
    userButton.removeEventListener('click', null);
  };

  // Get singleton instance of history overlay, no need to mount it
  getHistoryOverlay();

  return container;
}

/**
 * Mount a navigation bar to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - Navigation bar properties
 * @returns {HTMLElement} The mounted navigation bar
 */
NavigationBar.mount = (parent, props = {}) => {
  const navbar = NavigationBar(props);
  parent.appendChild(navbar);
  return navbar;
};

export default NavigationBar;
