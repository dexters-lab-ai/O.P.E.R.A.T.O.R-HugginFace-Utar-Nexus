/**
 * Notifications Component
 * Displays toast notifications and alerts
 */

import { eventBus } from '../utils/events.js';

// Default notification duration in ms
const DEFAULT_DURATION = 5000;

/**
 * Create a notifications component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Notifications container
 */
export function Notifications(props = {}) {
  const {
    containerId = 'notifications',
    position = 'top-right'
  } = props;

  // Create component container
  const container = document.createElement('div');
  container.className = `notifications-container position-${position}`;
  container.id = containerId;
  
  // Track active notifications
  const activeNotifications = [];
  
  // Generate unique notification ID
  function generateId() {
    return `notification-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
  
  // Show a notification
  function showNotification(options) {
    const {
      message,
      type = 'info',
      duration = DEFAULT_DURATION,
      dismissible = true
    } = options;
    
    // Create notification element
    const notificationId = generateId();
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.id = notificationId;
    
    // Set icon based on type
    let icon = 'info-circle';
    switch (type) {
      case 'success':
        icon = 'check-circle';
        break;
      case 'error':
        icon = 'exclamation-circle';
        break;
      case 'warning':
        icon = 'exclamation-triangle';
        break;
    }
    
    // Create notification content
    notification.innerHTML = `
      <div class="notification-icon">
        <i class="fas fa-${icon}"></i>
      </div>
      <div class="notification-content">
        <div class="notification-message">${message}</div>
        ${dismissible ? '<button class="notification-close"><i class="fas fa-times"></i></button>' : ''}
      </div>
      ${duration > 0 ? '<div class="notification-progress"></div>' : ''}
    `;
    
    // Add to container
    container.appendChild(notification);
    
    // Track notification
    activeNotifications.push({
      id: notificationId,
      element: notification,
      timer: null
    });
    
    // Show with animation
    setTimeout(() => {
      notification.classList.add('visible');
    }, 10);
    
    // Set up auto-dismiss
    if (duration > 0) {
      const progressBar = notification.querySelector('.notification-progress');
      if (progressBar) {
        progressBar.style.animationDuration = `${duration}ms`;
      }
      
      const timer = setTimeout(() => {
        dismissNotification(notificationId);
      }, duration);
      
      // Update timer in tracking array
      const index = activeNotifications.findIndex(n => n.id === notificationId);
      if (index !== -1) {
        activeNotifications[index].timer = timer;
      }
    }
    
    // Set up manual dismiss
    if (dismissible) {
      const closeButton = notification.querySelector('.notification-close');
      if (closeButton) {
        closeButton.addEventListener('click', () => {
          dismissNotification(notificationId);
        });
      }
    }
    
    return notificationId;
  }
  
  // Dismiss a notification
  function dismissNotification(id) {
    const notification = document.getElementById(id);
    if (!notification) return;
    
    // Find in tracking array
    const index = activeNotifications.findIndex(n => n.id === id);
    
    // Clear timer if exists
    if (index !== -1 && activeNotifications[index].timer) {
      clearTimeout(activeNotifications[index].timer);
    }
    
    // Remove with animation
    notification.classList.remove('visible');
    
    // Remove from DOM after animation
    setTimeout(() => {
      if (notification.parentNode === container) {
        container.removeChild(notification);
      }
      
      // Remove from tracking array
      if (index !== -1) {
        activeNotifications.splice(index, 1);
      }
    }, 300); // Match animation duration
  }
  
  // Dismiss all notifications
  function dismissAll() {
    // Clone array to avoid modification during iteration
    const notifications = [...activeNotifications];
    
    // Dismiss each notification
    notifications.forEach(notification => {
      dismissNotification(notification.id);
    });
  }
  
  // Initialize event listeners
  function initialize() {
    // Listen for notification events
    const unsubscribeNotification = eventBus.on('notification', (options) => {
      showNotification(options);
    });
    
    // Listen for dismiss all event
    const unsubscribeDismissAll = eventBus.on('dismiss-all-notifications', () => {
      dismissAll();
    });
    
    // Cleanup function
    return () => {
      unsubscribeNotification();
      unsubscribeDismissAll();
    };
  }
  
  // Initialize and get cleanup function
  const cleanup = initialize();
  
  // Expose public methods
  container.show = showNotification;
  container.dismiss = dismissNotification;
  container.dismissAll = dismissAll;
  container.addNotification = (msg, type = 'info') => {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = msg;
    container.appendChild(notification);
  };
  
  // Cleanup method
  container.destroy = () => {
    cleanup();
    
    // Clear all timeouts
    activeNotifications.forEach(notification => {
      if (notification.timer) {
        clearTimeout(notification.timer);
      }
    });
    
    // Remove all notifications
    container.innerHTML = '';
  };

  return container;
}

/**
 * Create notification types
 */
Notifications.info = (message, options = {}) => {
  eventBus.emit('notification', {
    message,
    type: 'info',
    ...options
  });
};

Notifications.success = (message, options = {}) => {
  eventBus.emit('notification', {
    message,
    type: 'success',
    ...options
  });
};

Notifications.warning = (message, options = {}) => {
  eventBus.emit('notification', {
    message,
    type: 'warning',
    ...options
  });
};

Notifications.error = (message, options = {}) => {
  eventBus.emit('notification', {
    message,
    type: 'error',
    ...options
  });
};

/**
 * Mount notifications to document body
 * @param {Object} props - Notifications properties
 * @returns {HTMLElement} The mounted notifications container
 */
Notifications.mount = (props = {}) => {
  const notifications = Notifications(props);
  document.body.appendChild(notifications);
  return notifications;
};

export default Notifications;
