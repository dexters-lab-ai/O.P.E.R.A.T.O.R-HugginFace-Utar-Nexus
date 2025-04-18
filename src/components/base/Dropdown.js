/**
 * Base Dropdown Component
 * A reusable dropdown menu component
 */

import { eventBus } from '../../utils/events.js';
import Button from './Button.js';

/**
 * Create a dropdown component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Dropdown element
 */
export function Dropdown(props = {}) {
  const {
    trigger = null,
    items = [],
    position = 'bottom-right',
    width = 'auto',
    maxHeight = 300,
    closeOnSelect = true,
    closeOnClickOutside = true,
    className = '',
    id = ''
  } = props;

  // State
  let isOpen = false;
  
  // Create component container
  const container = document.createElement('div');
  container.className = `dropdown ${className}`;
  if (id) container.id = id;
  
  // Create trigger if not provided
  const triggerElement = trigger || Button({
    icon: 'fa-ellipsis-v',
    variant: Button.VARIANTS.TEXT,
    className: 'dropdown-trigger'
  });
  
  // Make sure trigger has required attributes
  triggerElement.setAttribute('aria-haspopup', 'true');
  triggerElement.setAttribute('aria-expanded', 'false');
  
  container.appendChild(triggerElement);
  
  // Create dropdown menu
  const menu = document.createElement('div');
  menu.className = `dropdown-menu position-${position}`;
  menu.style.width = width === 'auto' ? 'auto' : `${width}px`;
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.display = 'none';
  
  // Populate menu items
  populateMenuItems(items);
  
  container.appendChild(menu);
  
  // Function to populate menu items
  function populateMenuItems(menuItems) {
    // Clear existing items
    menu.innerHTML = '';
    
    // Add new items
    menuItems.forEach(item => {
      if (item.divider) {
        // Add divider
        const divider = document.createElement('div');
        divider.className = 'dropdown-divider';
        menu.appendChild(divider);
      } else {
        // Add menu item
        const menuItem = document.createElement('a');
        menuItem.href = item.href || '#';
        menuItem.className = `dropdown-item ${item.className || ''}`;
        
        if (item.disabled) {
          menuItem.classList.add('disabled');
        }
        
        // Add icon if specified
        if (item.icon) {
          const icon = document.createElement('i');
          icon.className = `fas ${item.icon}`;
          menuItem.appendChild(icon);
          menuItem.appendChild(document.createTextNode(' '));
        }
        
        // Add item text
        const text = document.createTextNode(item.text || '');
        menuItem.appendChild(text);
        
        // Handle click events
        menuItem.addEventListener('click', (e) => {
          if (item.disabled) {
            e.preventDefault();
            return;
          }
          
          // Execute action if provided
          if (item.onClick) {
            e.preventDefault();
            item.onClick(e);
          }
          
          // Close dropdown if specified
          if (closeOnSelect) {
            close();
          }
        });
        
        menu.appendChild(menuItem);
      }
    });
  }
  
  /**
   * Toggle dropdown visibility
   */
  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }
  
  /**
   * Open the dropdown
   */
  function open() {
    if (isOpen) return;
    
    // Show menu
    menu.style.display = 'block';
    
    // Position menu
    positionMenu();
    
    // Update trigger state
    triggerElement.setAttribute('aria-expanded', 'true');
    triggerElement.classList.add('active');
    
    isOpen = true;
    
    // Add click outside listener
    if (closeOnClickOutside) {
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
      }, 0);
    }
    
    // Emit event
    eventBus.emit('dropdown-opened', { id });
  }
  
  /**
   * Close the dropdown
   */
  function close() {
    if (!isOpen) return;
    
    // Hide menu
    menu.style.display = 'none';
    
    // Update trigger state
    triggerElement.setAttribute('aria-expanded', 'false');
    triggerElement.classList.remove('active');
    
    isOpen = false;
    
    // Remove click outside listener
    document.removeEventListener('click', handleClickOutside);
    
    // Emit event
    eventBus.emit('dropdown-closed', { id });
  }
  
  /**
   * Position the dropdown menu
   */
  function positionMenu() {
    // Get position based on trigger element
    const triggerRect = triggerElement.getBoundingClientRect();
    
    // Reset position styles
    menu.style.top = '';
    menu.style.right = '';
    menu.style.bottom = '';
    menu.style.left = '';
    
    // Position based on specified position
    switch (position) {
      case 'bottom-right':
        menu.style.top = `${triggerRect.bottom}px`;
        menu.style.right = `${window.innerWidth - triggerRect.right}px`;
        break;
      case 'bottom-left':
        menu.style.top = `${triggerRect.bottom}px`;
        menu.style.left = `${triggerRect.left}px`;
        break;
      case 'top-right':
        menu.style.bottom = `${window.innerHeight - triggerRect.top}px`;
        menu.style.right = `${window.innerWidth - triggerRect.right}px`;
        break;
      case 'top-left':
        menu.style.bottom = `${window.innerHeight - triggerRect.top}px`;
        menu.style.left = `${triggerRect.left}px`;
        break;
      case 'right':
        menu.style.top = `${triggerRect.top}px`;
        menu.style.left = `${triggerRect.right}px`;
        break;
      case 'left':
        menu.style.top = `${triggerRect.top}px`;
        menu.style.right = `${window.innerWidth - triggerRect.left}px`;
        break;
    }
    
    // Adjust if menu would go off screen
    const menuRect = menu.getBoundingClientRect();
    
    if (menuRect.right > window.innerWidth) {
      menu.style.right = '0';
      menu.style.left = '';
    }
    
    if (menuRect.bottom > window.innerHeight) {
      // If bottom position is off-screen, try to position above trigger
      if (position.startsWith('bottom')) {
        menu.style.bottom = `${window.innerHeight - triggerRect.top}px`;
        menu.style.top = '';
      } else {
        // Otherwise ensure menu doesn't exceed viewport
        menu.style.maxHeight = `${window.innerHeight - menuRect.top - 10}px`;
      }
    }
  }
  
  /**
   * Set dropdown items
   * @param {Array} newItems - New dropdown items
   */
  function setItems(newItems) {
    populateMenuItems(newItems);
  }
  
  /**
   * Handle click outside
   * @param {Event} e - Click event
   */
  function handleClickOutside(e) {
    if (!container.contains(e.target)) {
      close();
    }
  }
  
  /**
   * Initialize the component
   */
  function initialize() {
    // Add click event to trigger
    triggerElement.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    
    // Update position on window resize
    window.addEventListener('resize', () => {
      if (isOpen) {
        positionMenu();
      }
    });
    
    // Return cleanup function
    return () => {
      triggerElement.removeEventListener('click', null);
      window.removeEventListener('resize', null);
      document.removeEventListener('click', handleClickOutside);
    };
  }
  
  // Initialize component
  const cleanup = initialize();
  
  // Expose public methods
  container.open = open;
  container.close = close;
  container.toggle = toggle;
  container.setItems = setItems;
  container.isOpen = () => isOpen;
  
  // Cleanup method
  container.destroy = () => {
    cleanup();
    
    // Remove event listeners from menu items
    const menuItems = menu.querySelectorAll('.dropdown-item');
    menuItems.forEach(item => {
      item.removeEventListener('click', null);
    });
  };

  return container;
}

/**
 * Create a dropdown menu at a specific position
 * @param {Object} options - Dropdown options
 * @returns {HTMLElement} Dropdown element
 */
Dropdown.create = (options = {}) => {
  const dropdown = Dropdown(options);
  
  if (options.appendTo) {
    if (typeof options.appendTo === 'string') {
      const container = document.querySelector(options.appendTo);
      if (container) {
        container.appendChild(dropdown);
      }
    } else if (options.appendTo instanceof HTMLElement) {
      options.appendTo.appendChild(dropdown);
    }
  }
  
  return dropdown;
};

export default Dropdown;
