/**
 * Navigation Bar Component
 * Main application header with navigation controls and user information
 */

console.log('[NAVIGATION-BAR] Component file loaded');

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.jsx';

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
  
  // Create navigation section
  const navigation = document.createElement('div');
  navigation.className = 'nav-links';
  
  const navItems = [
    { text: 'Guide', icon: 'fa-book', action: 'toggle-guide' },
    { text: 'History', icon: 'fa-history', action: 'toggle-history-overlay' }
  ];
  
  // Add navigation buttons
  navItems.forEach(item => {
    const button = Button({
      text: isMinimized ? '' : item.text,
      icon: item.icon,
      variant: Button.VARIANTS.TEXT,
      className: 'nav-link',
      onClick: () => {
        eventBus.emit(item.action);
      }
    });
    
    navigation.appendChild(button);
  });
  
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
      // Show layout menu
      showLayoutMenu(layoutToggle);
    }
  });
  
  // Create settings button
  const settingsButton = Button({
    icon: 'fa-cog',
    variant: Button.VARIANTS.TEXT,
    className: 'nav-tool settings-button',
    title: 'Settings',
    onClick: () => {
      eventBus.emit('toggle-settings');
    }
  });
  
  // Create user profile button
  const userButton = document.createElement('div');
  userButton.className = 'user-profile';
  userButton.innerHTML = `
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
  
  userButton.addEventListener('click', () => {
    showUserMenu(userButton);
  });
  
  // Add tools to container
  tools.appendChild(themeToggle);
  tools.appendChild(layoutToggle);
  tools.appendChild(settingsButton);
  tools.appendChild(userButton);
  
  // Assemble navbar
  container.appendChild(branding);
  container.appendChild(navigation);
  container.appendChild(tools);

  // Initialize menus at component creation
  const layoutMenu = document.createElement('div');
  layoutMenu.className = 'dropdown-menu';
  layoutMenu.style.display = 'none';
  
  const userMenu = document.createElement('div');
  userMenu.className = 'dropdown-menu';
  userMenu.style.display = 'none';

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

  // Create user menu with full original functionality
  const menuItems = [
    { text: 'Profile', icon: 'fa-user', action: 'profile' },
    { text: 'Preferences', icon: 'fa-sliders-h', action: 'toggle-settings' },
    { text: 'Logout', icon: 'fa-sign-out-alt', action: 'logout' }
  ];
  
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
  
  userMenu.appendChild(userInfo);
  
  // Add divider
  const divider = document.createElement('div');
  divider.className = 'dropdown-divider';
  userMenu.appendChild(divider);
  
  // Create menu items with full original functionality
  menuItems.forEach(item => {
    const menuItem = document.createElement('a');
    menuItem.href = '#';
    menuItem.className = 'dropdown-item';
    menuItem.innerHTML = `<i class="fas ${item.icon}"></i> ${item.text}`;
    
    menuItem.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Handle special actions
      if (item.action === 'logout') {
        window.location.href = '/logout';
      } else {
        // Emit event for other actions
        eventBus.emit(item.action);
      }
      
      hideMenus();
    });
    
    userMenu.appendChild(menuItem);
  });

  // Add menus to DOM
  document.body.appendChild(layoutMenu);
  document.body.appendChild(userMenu);

  /**
   * Hide all menus
   */
  function hideMenus() {
    layoutMenu.style.display = 'none';
    userMenu.style.display = 'none';
  }

  /**
   * Show layout menu
   * @param {HTMLElement} button - Button that triggered the menu
   */
  function showLayoutMenu(button) {
    hideMenus();
    
    // Position menu below button
    const rect = button.getBoundingClientRect();
    layoutMenu.style.left = `${rect.left}px`;
    layoutMenu.style.top = `${rect.bottom}px`;
    layoutMenu.style.display = 'block';
    
    // Close menu when clicking outside
    const clickOutside = (e) => {
      if (!layoutMenu.contains(e.target) && e.target !== button) {
        hideMenus();
        document.removeEventListener('click', clickOutside);
      }
    };
    
    document.addEventListener('click', clickOutside);
  }

  /**
   * Show user menu
   * @param {HTMLElement} button - Button that triggered the menu
   */
  function showUserMenu(button) {
    hideMenus();
    
    // Show menu before measuring width
    userMenu.style.display = 'block';

    // Position menu below button
    const rect = button.getBoundingClientRect();
    userMenu.style.left = `${rect.right - userMenu.offsetWidth}px`;
    userMenu.style.top = `${rect.bottom}px`;
    
    // Close menu when clicking outside
    const clickOutside = (e) => {
      if (!userMenu.contains(e.target) && e.target !== button) {
        hideMenus();
        document.removeEventListener('click', clickOutside);
      }
    };
    
    document.addEventListener('click', clickOutside);
  }

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
