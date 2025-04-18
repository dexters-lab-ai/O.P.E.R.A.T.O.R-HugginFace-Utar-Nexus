/**
 * Sidebar Component
 * Collapsible sidebar with navigation links and custom content
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.js';

/**
 * Create a sidebar component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Sidebar element
 */
export function Sidebar(props = {}) {
  const {
    containerId = 'sidebar',
    position = 'left',
    collapsed = false,
    items = [],
    width = '250px',
    minWidth = '60px'
  } = props;

  // State
  let isCollapsed = collapsed;
  
  // Create component container
  const container = document.createElement('div');
  container.className = `sidebar ${position} ${isCollapsed ? 'collapsed' : ''}`;
  container.style.width = isCollapsed ? minWidth : width;
  if (containerId) container.id = containerId;
  
  // Create header with toggle button
  const header = document.createElement('div');
  header.className = 'sidebar-header';
  
  const toggleButton = Button({
    icon: 'fa-chevron-left',
    variant: Button.VARIANTS.TEXT,
    className: 'sidebar-toggle',
    onClick: () => {
      toggleCollapse();
    }
  });
  
  header.appendChild(toggleButton);
  
  // Create content container
  const content = document.createElement('div');
  content.className = 'sidebar-content';
  
  // Create navigation menu
  const nav = document.createElement('nav');
  nav.className = 'sidebar-nav';
  
  // Create navigation items
  items.forEach(item => {
    createNavItem(item, nav);
  });
  
  // Add elements to container
  content.appendChild(nav);
  container.appendChild(header);
  container.appendChild(content);
  
  /**
   * Create a navigation item
   * @param {Object} item - Navigation item data
   * @param {HTMLElement} parent - Parent element
   */
  function createNavItem(item, parent) {
    if (item.type === 'divider') {
      // Create divider
      const divider = document.createElement('div');
      divider.className = 'sidebar-divider';
      
      if (item.label) {
        divider.innerHTML = `<span>${item.label}</span>`;
      }
      
      parent.appendChild(divider);
      return;
    }
    
    // Create nav item
    const navItem = document.createElement('div');
    navItem.className = `sidebar-item ${item.active ? 'active' : ''}`;
    
    // Create item link
    const link = document.createElement('a');
    link.href = item.href || '#';
    link.className = 'sidebar-link';
    
    // Add icon
    if (item.icon) {
      const icon = document.createElement('i');
      icon.className = `fas ${item.icon}`;
      link.appendChild(icon);
    }
    
    // Add text container
    const textContainer = document.createElement('span');
    textContainer.className = 'sidebar-text';
    textContainer.textContent = item.text || '';
    link.appendChild(textContainer);
    
    // Add badge if present
    if (item.badge) {
      const badge = document.createElement('span');
      badge.className = `sidebar-badge ${item.badgeVariant || 'primary'}`;
      badge.textContent = item.badge;
      link.appendChild(badge);
    }
    
    // Handle click event
    link.addEventListener('click', (e) => {
      if (!item.href || item.href === '#') {
        e.preventDefault();
      }
      
      // Call item action if provided
      if (item.action) {
        item.action(item);
      }
      
      // Emit event
      eventBus.emit('sidebar-item-clicked', { item });
      
      // Set active state if enabled
      if (item.setActive !== false) {
        setActiveItem(item);
      }
    });
    
    navItem.appendChild(link);
    
    // Add submenu if present
    if (item.items && item.items.length > 0) {
      // Add dropdown indicator
      const dropdown = document.createElement('span');
      dropdown.className = 'dropdown-indicator';
      dropdown.innerHTML = '<i class="fas fa-angle-right"></i>';
      link.appendChild(dropdown);
      
      // Create submenu
      const submenu = document.createElement('div');
      submenu.className = 'sidebar-submenu';
      
      // Create submenu items
      item.items.forEach(subitem => {
        createNavItem(subitem, submenu);
      });
      
      navItem.appendChild(submenu);
      
      // Toggle submenu on click
      link.addEventListener('click', (e) => {
        if (!item.href || item.href === '#') {
          e.preventDefault();
          navItem.classList.toggle('expanded');
        }
      });
    }
    
    parent.appendChild(navItem);
  }
  
  /**
   * Toggle sidebar collapse state
   */
  function toggleCollapse() {
    isCollapsed = !isCollapsed;
    
    // Update container class and style
    container.classList.toggle('collapsed', isCollapsed);
    container.style.width = isCollapsed ? minWidth : width;
    
    // Update toggle button icon
    const icon = toggleButton.querySelector('i');
    if (icon) {
      icon.className = `fas ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-left'}`;
    }
    
    // Update store state
    stores.ui.setState({
      sidebarCollapsed: isCollapsed
    });
    
    // Emit event
    eventBus.emit('sidebar-toggled', { collapsed: isCollapsed });
  }
  
  /**
   * Set the active navigation item
   * @param {Object} activeItem - Item to set as active
   */
  function setActiveItem(activeItem) {
    // Remove active class from all items
    const allItems = container.querySelectorAll('.sidebar-item');
    allItems.forEach(item => {
      item.classList.remove('active');
    });
    
    // Find and set the active item
    items.forEach((item, index) => {
      if (item === activeItem) {
        const navItem = container.querySelectorAll('.sidebar-item')[index];
        if (navItem) {
          navItem.classList.add('active');
        }
      }
      
      // Check subitems
      if (item.items && item.items.length > 0) {
        item.items.forEach(subitem => {
          if (subitem === activeItem) {
            // Find parent and expand it
            const parentItem = container.querySelectorAll('.sidebar-item')[index];
            if (parentItem) {
              parentItem.classList.add('expanded');
            }
          }
        });
      }
    });
  }
  
  /**
   * Add a new navigation item
   * @param {Object} item - Item data
   * @param {number} position - Position to insert at (optional)
   */
  function addItem(item, position) {
    if (position !== undefined && position >= 0 && position <= items.length) {
      // Insert at specific position
      items.splice(position, 0, item);
    } else {
      // Add to end
      items.push(item);
    }
    
    // Recreate navigation
    content.removeChild(nav);
    const newNav = document.createElement('nav');
    newNav.className = 'sidebar-nav';
    
    items.forEach(item => {
      createNavItem(item, newNav);
    });
    
    content.appendChild(newNav);
  }
  
  /**
   * Remove a navigation item
   * @param {number} index - Item index to remove
   */
  function removeItem(index) {
    if (index >= 0 && index < items.length) {
      items.splice(index, 1);
      
      // Recreate navigation
      content.removeChild(nav);
      const newNav = document.createElement('nav');
      newNav.className = 'sidebar-nav';
      
      items.forEach(item => {
        createNavItem(item, newNav);
      });
      
      content.appendChild(newNav);
    }
  }
  
  /**
   * Add content to the sidebar
   * @param {HTMLElement} element - Element to add
   * @param {string} position - Position ('top', 'bottom')
   */
  function addContent(element, position = 'bottom') {
    if (position === 'top') {
      content.insertBefore(element, content.firstChild);
    } else {
      content.appendChild(element);
    }
  }
  
  // Subscribe to store changes
  const unsubscribe = stores.ui.subscribe((state) => {
    // Update collapse state if changed externally
    if (state.sidebarCollapsed !== undefined && state.sidebarCollapsed !== isCollapsed) {
      isCollapsed = state.sidebarCollapsed;
      
      // Update container class and style
      container.classList.toggle('collapsed', isCollapsed);
      container.style.width = isCollapsed ? minWidth : width;
      
      // Update toggle button icon
      const icon = toggleButton.querySelector('i');
      if (icon) {
        icon.className = `fas ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-left'}`;
      }
    }
  });
  
  // Expose public methods
  container.toggleCollapse = toggleCollapse;
  container.isCollapsed = () => isCollapsed;
  container.setActiveItem = setActiveItem;
  container.addItem = addItem;
  container.removeItem = removeItem;
  container.addContent = addContent;
  
  // Cleanup method
  container.destroy = () => {
    unsubscribe();
  };
  
  return container;
}

/**
 * Mount a sidebar to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - Sidebar properties
 * @returns {HTMLElement} The mounted sidebar
 */
Sidebar.mount = (parent, props = {}) => {
  const sidebar = Sidebar(props);
  if (parent) {
    parent.appendChild(sidebar);
  }
  return sidebar;
};

export default Sidebar;
