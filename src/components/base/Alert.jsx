/**
 * Base Alert Component
 * A reusable alert component for displaying informational messages
 */

import { eventBus } from '../../utils/events.js';
import Button from './Button.jsx';

/**
 * Create an alert component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Alert element
 */
export function Alert(props = {}) {
  const {
    title = '',
    message = '',
    type = 'info', // 'info', 'success', 'warning', 'error'
    dismissible = true,
    duration = 0, // 0 means no auto-dismiss
    icon = true,
    onClose = null,
    id = '',
    className = ''
  } = props;

  // Create alert container
  const container = document.createElement('div');
  container.className = `alert alert-${type} ${dismissible ? 'dismissible' : ''} ${className}`;
  if (id) container.id = id;
  
  // Add role and aria attributes for accessibility
  container.setAttribute('role', 'alert');
  container.setAttribute('aria-live', 'polite');
  
  // Create alert icon
  if (icon) {
    const iconContainer = document.createElement('div');
    iconContainer.className = 'alert-icon';
    
    const iconElement = document.createElement('i');
    
    // Set appropriate icon based on type
    switch (type) {
      case 'info':
        iconElement.className = 'fas fa-info-circle';
        break;
      case 'success':
        iconElement.className = 'fas fa-check-circle';
        break;
      case 'warning':
        iconElement.className = 'fas fa-exclamation-triangle';
        break;
      case 'error':
        iconElement.className = 'fas fa-times-circle';
        break;
      default:
        iconElement.className = 'fas fa-info-circle';
    }
    
    iconContainer.appendChild(iconElement);
    container.appendChild(iconContainer);
  }
  
  // Create alert content
  const content = document.createElement('div');
  content.className = 'alert-content';
  
  // Add title if provided
  if (title) {
    const titleElement = document.createElement('div');
    titleElement.className = 'alert-title';
    titleElement.textContent = title;
    content.appendChild(titleElement);
  }
  
  // Add message
  const messageElement = document.createElement('div');
  messageElement.className = 'alert-message';
  
  if (typeof message === 'string') {
    messageElement.textContent = message;
  } else if (message instanceof HTMLElement) {
    messageElement.appendChild(message);
  }
  
  content.appendChild(messageElement);
  container.appendChild(content);
  
  // Add dismiss button if alert is dismissible
  if (dismissible) {
    const closeButton = Button({
      icon: 'fa-times',
      variant: Button.VARIANTS.TEXT,
      className: 'alert-close',
      onClick: () => {
        dismiss();
      }
    });
    
    container.appendChild(closeButton);
  }
  
  // Set up auto-dismiss if specified
  let dismissTimeout = null;
  if (duration > 0) {
    dismissTimeout = setTimeout(() => {
      dismiss();
    }, duration);
  }
  
  /**
   * Dismiss the alert
   */
  function dismiss() {
    // Clear auto-dismiss timeout if set
    if (dismissTimeout) {
      clearTimeout(dismissTimeout);
    }
    
    // Add dismissing class for animation
    container.classList.add('dismissing');
    
    // Remove after animation completes
    setTimeout(() => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
      
      // Call onClose callback if provided
      if (onClose && typeof onClose === 'function') {
        onClose();
      }
      
      // Emit dismissed event
      eventBus.emit('alert-dismissed', { id });
    }, 300); // Match animation duration in CSS
  }
  
  /**
   * Update alert content
   * @param {Object} updates - Properties to update
   */
  function update(updates = {}) {
    // Update title if provided
    if (updates.title !== undefined) {
      let titleElement = container.querySelector('.alert-title');
      
      if (updates.title) {
        if (titleElement) {
          titleElement.textContent = updates.title;
        } else {
          titleElement = document.createElement('div');
          titleElement.className = 'alert-title';
          titleElement.textContent = updates.title;
          content.insertBefore(titleElement, content.firstChild);
        }
      } else if (titleElement) {
        titleElement.parentNode.removeChild(titleElement);
      }
    }
    
    // Update message if provided
    if (updates.message !== undefined) {
      const messageElement = container.querySelector('.alert-message');
      
      if (messageElement) {
        messageElement.innerHTML = '';
        
        if (typeof updates.message === 'string') {
          messageElement.textContent = updates.message;
        } else if (updates.message instanceof HTMLElement) {
          messageElement.appendChild(updates.message);
        }
      }
    }
    
    // Update type if provided
    if (updates.type !== undefined) {
      // Remove current type class
      container.classList.remove('alert-info', 'alert-success', 'alert-warning', 'alert-error');
      
      // Add new type class
      container.classList.add(`alert-${updates.type}`);
      
      // Update icon if visible
      if (icon) {
        const iconElement = container.querySelector('.alert-icon i');
        
        if (iconElement) {
          iconElement.className = '';
          
          switch (updates.type) {
            case 'info':
              iconElement.className = 'fas fa-info-circle';
              break;
            case 'success':
              iconElement.className = 'fas fa-check-circle';
              break;
            case 'warning':
              iconElement.className = 'fas fa-exclamation-triangle';
              break;
            case 'error':
              iconElement.className = 'fas fa-times-circle';
              break;
            default:
              iconElement.className = 'fas fa-info-circle';
          }
        }
      }
    }
    
    // Update dismissible state if provided
    if (updates.dismissible !== undefined) {
      if (updates.dismissible) {
        container.classList.add('dismissible');
        
        // Add close button if not present
        if (!container.querySelector('.alert-close')) {
          const closeButton = Button({
            icon: 'fa-times',
            variant: Button.VARIANTS.TEXT,
            className: 'alert-close',
            onClick: () => {
              dismiss();
            }
          });
          
          container.appendChild(closeButton);
        }
      } else {
        container.classList.remove('dismissible');
        
        // Remove close button if present
        const closeButton = container.querySelector('.alert-close');
        if (closeButton) {
          container.removeChild(closeButton);
        }
      }
    }
  }
  
  // Expose public methods
  container.dismiss = dismiss;
  container.update = update;

  return container;
}

/**
 * Create and append an alert to a container
 * @param {Object} props - Alert properties
 * @param {HTMLElement|string} container - Container element or selector
 * @returns {HTMLElement} The created alert
 */
Alert.show = (props = {}, container = 'body') => {
  const alert = Alert(props);
  
  let targetContainer;
  if (typeof container === 'string') {
    targetContainer = document.querySelector(container);
  } else if (container instanceof HTMLElement) {
    targetContainer = container;
  } else {
    targetContainer = document.body;
  }
  
  if (targetContainer) {
    targetContainer.appendChild(alert);
  }
  
  return alert;
};

/**
 * Create an info alert
 * @param {string} message - Alert message
 * @param {Object} options - Additional alert options
 * @returns {HTMLElement} The created alert
 */
Alert.info = (message, options = {}) => {
  return Alert.show({
    type: 'info',
    message,
    ...options
  });
};

/**
 * Create a success alert
 * @param {string} message - Alert message
 * @param {Object} options - Additional alert options
 * @returns {HTMLElement} The created alert
 */
Alert.success = (message, options = {}) => {
  return Alert.show({
    type: 'success',
    message,
    ...options
  });
};

/**
 * Create a warning alert
 * @param {string} message - Alert message
 * @param {Object} options - Additional alert options
 * @returns {HTMLElement} The created alert
 */
Alert.warning = (message, options = {}) => {
  return Alert.show({
    type: 'warning',
    message,
    ...options
  });
};

/**
 * Create an error alert
 * @param {string} message - Alert message
 * @param {Object} options - Additional alert options
 * @returns {HTMLElement} The created alert
 */
Alert.error = (message, options = {}) => {
  return Alert.show({
    type: 'error',
    message,
    ...options
  });
};

export default Alert;
