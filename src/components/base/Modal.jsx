/**
 * Base Modal Component
 * A reusable modal dialog component with customizable content
 */

import { eventBus } from '../../utils/events.js';
import Button from './Button.jsx';

/**
 * Create a modal component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Modal element
 */
export function Modal(props = {}) {
  const {
    title = '',
    content = '',
    footer = null,
    size = 'medium',
    closeOnBackdrop = true,
    closeOnEscape = true,
    showCloseButton = true,
    onClose = null,
    id = '',
    className = ''
  } = props;

  // State
  let isVisible = false;
  
  // Create modal container
  const container = document.createElement('div');
  container.className = `modal-container ${className}`;
  if (id) container.id = id;
  
  // Create modal backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  
  if (closeOnBackdrop) {
    backdrop.addEventListener('click', () => {
      hide();
      if (onClose) onClose();
    });
  }
  
  container.appendChild(backdrop);
  
  // Create modal dialog
  const dialog = document.createElement('div');
  dialog.className = `modal-dialog size-${size}`;
  
  // Create modal header
  const header = document.createElement('div');
  header.className = 'modal-header';
  
  if (title) {
    const titleEl = document.createElement('h2');
    titleEl.className = 'modal-title';
    
    if (typeof title === 'string') {
      titleEl.textContent = title;
    } else if (title instanceof HTMLElement) {
      titleEl.appendChild(title);
    }
    
    header.appendChild(titleEl);
  }
  
  if (showCloseButton) {
    const closeButton = Button({
      icon: 'fa-times',
      variant: Button.VARIANTS.TEXT,
      className: 'modal-close',
      onClick: () => {
        hide();
        if (onClose) onClose();
      }
    });
    
    header.appendChild(closeButton);
  }
  
  dialog.appendChild(header);
  
  // Create modal body
  const body = document.createElement('div');
  body.className = 'modal-body';
  
  if (typeof content === 'string') {
    body.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    body.appendChild(content);
  } else if (Array.isArray(content)) {
    content.forEach(item => {
      if (item instanceof HTMLElement) {
        body.appendChild(item);
      }
    });
  }
  
  dialog.appendChild(body);
  
  // Create modal footer if provided
  if (footer) {
    const footerEl = document.createElement('div');
    footerEl.className = 'modal-footer';
    
    if (typeof footer === 'string') {
      footerEl.innerHTML = footer;
    } else if (footer instanceof HTMLElement) {
      footerEl.appendChild(footer);
    } else if (Array.isArray(footer)) {
      footer.forEach(item => {
        if (item instanceof HTMLElement) {
          footerEl.appendChild(item);
        }
      });
    }
    
    dialog.appendChild(footerEl);
  }
  
  container.appendChild(dialog);
  
  /**
   * Show the modal
   */
  function show() {
    if (isVisible) return;
    
    // Add to DOM if not already
    if (!document.body.contains(container)) {
      document.body.appendChild(container);
    }
    
    // Show with animation
    container.style.display = 'flex';
    
    // Trigger reflow
    void container.offsetWidth;
    
    // Add visible class for animation
    container.classList.add('visible');
    
    // Add class to body to prevent scrolling
    document.body.classList.add('modal-open');
    
    // Set focus to first focusable element
    const focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) {
      focusable[0].focus();
    }
    
    isVisible = true;
    
    // Set up ESC key listener if enabled
    if (closeOnEscape) {
      document.addEventListener('keydown', handleKeyDown);
    }
    
    // Emit event
    eventBus.emit('modal-shown', { id });
  }
  
  /**
   * Hide the modal
   */
  function hide() {
    if (!isVisible) return;
    
    // Hide with animation
    container.classList.remove('visible');
    
    // Remove from DOM after animation
    setTimeout(() => {
      container.style.display = 'none';
      
      // Remove class from body
      document.body.classList.remove('modal-open');
      
      isVisible = false;
      
      // Remove event listener
      document.removeEventListener('keydown', handleKeyDown);
      
      // Emit event
      eventBus.emit('modal-hidden', { id });
    }, 300); // Match animation duration
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
  
  /**
   * Set modal content
   * @param {string|HTMLElement|Array} newContent - New content for the modal
   */
  function setContent(newContent) {
    // Clear current content
    body.innerHTML = '';
    
    // Add new content
    if (typeof newContent === 'string') {
      body.innerHTML = newContent;
    } else if (newContent instanceof HTMLElement) {
      body.appendChild(newContent);
    } else if (Array.isArray(newContent)) {
      newContent.forEach(item => {
        if (item instanceof HTMLElement) {
          body.appendChild(item);
        }
      });
    }
  }
  
  /**
   * Set modal title
   * @param {string|HTMLElement} newTitle - New title for the modal
   */
  function setTitle(newTitle) {
    let titleEl = header.querySelector('.modal-title');
    
    if (!titleEl) {
      titleEl = document.createElement('h2');
      titleEl.className = 'modal-title';
      header.insertBefore(titleEl, header.firstChild);
    }
    
    // Clear current title
    titleEl.innerHTML = '';
    
    // Set new title
    if (typeof newTitle === 'string') {
      titleEl.textContent = newTitle;
    } else if (newTitle instanceof HTMLElement) {
      titleEl.appendChild(newTitle);
    }
  }
  
  /**
   * Handle keydown events
   * @param {KeyboardEvent} e - Keyboard event
   */
  function handleKeyDown(e) {
    if (e.key === 'Escape' && isVisible) {
      hide();
      if (onClose) onClose();
    }
  }
  
  // Expose public methods
  container.show = show;
  container.hide = hide;
  container.toggle = toggle;
  container.setContent = setContent;
  container.setTitle = setTitle;
  container.isVisible = () => isVisible;
  
  // Cleanup method
  container.destroy = () => {
    if (document.body.contains(container)) {
      document.body.removeChild(container);
    }
    
    document.removeEventListener('keydown', handleKeyDown);
  };

  return container;
}

/**
 * Show a modal with the specified options
 * @param {Object} options - Modal options
 * @returns {HTMLElement} The modal element
 */
Modal.show = (options = {}) => {
  const modal = Modal(options);
  modal.show();
  return modal;
};

/**
 * Create a confirmation modal
 * @param {Object} options - Confirmation options
 * @returns {Promise} Resolves with true if confirmed, false if canceled
 */
Modal.confirm = (options = {}) => {
  return new Promise((resolve) => {
    const {
      title = 'Confirm',
      message = 'Are you sure?',
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      confirmVariant = Button.VARIANTS.PRIMARY,
      size = 'small'
    } = options;
    
    // Create buttons
    const confirmButton = Button({
      text: confirmText,
      variant: confirmVariant,
      onClick: () => {
        modal.hide();
        resolve(true);
      }
    });
    
    const cancelButton = Button({
      text: cancelText,
      variant: Button.VARIANTS.SECONDARY,
      onClick: () => {
        modal.hide();
        resolve(false);
      }
    });
    
    // Create footer with buttons
    const footer = document.createElement('div');
    footer.className = 'modal-buttons';
    footer.appendChild(cancelButton);
    footer.appendChild(confirmButton);
    
    // Create modal
    const modal = Modal({
      title,
      content: message,
      footer,
      size,
      onClose: () => resolve(false)
    });
    
    modal.show();
  });
};

/**
 * Create a prompt modal
 * @param {Object} options - Prompt options
 * @returns {Promise} Resolves with input value if confirmed, null if canceled
 */
Modal.prompt = (options = {}) => {
  return new Promise((resolve) => {
    const {
      title = 'Prompt',
      message = 'Please enter a value:',
      placeholder = '',
      defaultValue = '',
      confirmText = 'OK',
      cancelText = 'Cancel',
      size = 'small'
    } = options;
    
    // Create input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    input.placeholder = placeholder;
    input.value = defaultValue;
    
    // Create content
    const content = document.createElement('div');
    content.className = 'modal-prompt-content';
    
    if (message) {
      const messageEl = document.createElement('p');
      messageEl.className = 'modal-prompt-message';
      messageEl.textContent = message;
      content.appendChild(messageEl);
    }
    
    content.appendChild(input);
    
    // Create buttons
    const confirmButton = Button({
      text: confirmText,
      variant: Button.VARIANTS.PRIMARY,
      onClick: () => {
        modal.hide();
        resolve(input.value);
      }
    });
    
    const cancelButton = Button({
      text: cancelText,
      variant: Button.VARIANTS.SECONDARY,
      onClick: () => {
        modal.hide();
        resolve(null);
      }
    });
    
    // Create footer with buttons
    const footer = document.createElement('div');
    footer.className = 'modal-buttons';
    footer.appendChild(cancelButton);
    footer.appendChild(confirmButton);
    
    // Create modal
    const modal = Modal({
      title,
      content,
      footer,
      size,
      onClose: () => resolve(null)
    });
    
    modal.show();
    
    // Focus input
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
    
    // Handle Enter key
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        modal.hide();
        resolve(input.value);
      }
    });
  });
};

/**
 * Create an alert modal
 * @param {Object} options - Alert options
 * @returns {Promise} Resolves when alert is closed
 */
Modal.alert = (options = {}) => {
  return new Promise((resolve) => {
    const {
      title = 'Alert',
      message = '',
      buttonText = 'OK',
      size = 'small'
    } = options;
    
    // Create button
    const button = Button({
      text: buttonText,
      variant: Button.VARIANTS.PRIMARY,
      onClick: () => {
        modal.hide();
        resolve();
      }
    });
    
    // Create footer with button
    const footer = document.createElement('div');
    footer.className = 'modal-buttons';
    footer.appendChild(button);
    
    // Create modal
    const modal = Modal({
      title,
      content: message,
      footer,
      size,
      onClose: () => resolve()
    });
    
    modal.show();
    
    // Focus button
    setTimeout(() => {
      button.focus();
    }, 100);
  });
};

export default Modal;
