/**
 * Base Tooltip Component
 * A reusable tooltip component that can be attached to any element
 */

/**
 * Create a tooltip component
 * @param {Object} props - Component properties
 * @returns {Object} Tooltip controller
 */
export function Tooltip(props = {}) {
  const {
    target = null,
    content = '',
    position = 'top',
    theme = 'dark',
    showDelay = 300,
    hideDelay = 200,
    offset = 8,
    className = '',
    interactive = false,
    maxWidth = 200
  } = props;

  // State
  let isVisible = false;
  let tooltipElement = null;
  let showTimeout = null;
  let hideTimeout = null;
  
  // Ensure target element exists
  if (!target || !(target instanceof HTMLElement)) {
    console.error('Tooltip target must be a valid HTML element');
    return null;
  }
  
  /**
   * Create tooltip element
   */
  function createTooltipElement() {
    if (tooltipElement) return;
    
    tooltipElement = document.createElement('div');
    tooltipElement.className = `tooltip tooltip-${position} tooltip-${theme} ${className}`;
    tooltipElement.style.maxWidth = `${maxWidth}px`;
    tooltipElement.style.opacity = '0';
    tooltipElement.style.pointerEvents = interactive ? 'auto' : 'none';
    
    // Add tooltip content
    if (typeof content === 'string') {
      tooltipElement.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      tooltipElement.appendChild(content);
    }
    
    // Add to document
    document.body.appendChild(tooltipElement);
    
    // Prevent tooltip from triggering itself if interactive
    if (interactive) {
      tooltipElement.addEventListener('mouseenter', () => {
        clearTimeout(hideTimeout);
      });
      
      tooltipElement.addEventListener('mouseleave', () => {
        hide();
      });
    }
  }
  
  /**
   * Position the tooltip relative to target
   */
  function positionTooltip() {
    if (!tooltipElement || !target) return;
    
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltipElement.getBoundingClientRect();
    
    // Calculate position based on target and tooltip dimensions
    let top = 0;
    let left = 0;
    
    switch (position) {
      case 'top':
        top = targetRect.top - tooltipRect.height - offset;
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        break;
      case 'bottom':
        top = targetRect.bottom + offset;
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        break;
      case 'left':
        top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
        left = targetRect.left - tooltipRect.width - offset;
        break;
      case 'right':
        top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);
        left = targetRect.right + offset;
        break;
    }
    
    // Add scroll position
    top += window.scrollY;
    left += window.scrollX;
    
    // Constrain to viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    if (left < 0) left = 0;
    if (left + tooltipRect.width > viewportWidth) {
      left = viewportWidth - tooltipRect.width;
    }
    
    if (top < 0) top = 0;
    if (top + tooltipRect.height > viewportHeight) {
      top = viewportHeight - tooltipRect.height;
    }
    
    // Set position
    tooltipElement.style.top = `${top}px`;
    tooltipElement.style.left = `${left}px`;
  }
  
  /**
   * Show the tooltip
   */
  function show() {
    // Clear any pending hide
    clearTimeout(hideTimeout);
    
    // Create tooltip if needed
    if (!tooltipElement) {
      createTooltipElement();
    }
    
    // Position tooltip
    positionTooltip();
    
    // Show with delay
    showTimeout = setTimeout(() => {
      if (tooltipElement) {
        tooltipElement.style.opacity = '1';
        isVisible = true;
      }
    }, showDelay);
  }
  
  /**
   * Hide the tooltip
   */
  function hide() {
    // Clear any pending show
    clearTimeout(showTimeout);
    
    // Hide with delay
    hideTimeout = setTimeout(() => {
      if (tooltipElement) {
        tooltipElement.style.opacity = '0';
        isVisible = false;
      }
    }, hideDelay);
  }
  
  /**
   * Update tooltip content
   * @param {string|HTMLElement} newContent - New tooltip content
   */
  function updateContent(newContent) {
    if (!tooltipElement) {
      createTooltipElement();
    }
    
    // Clear current content
    tooltipElement.innerHTML = '';
    
    // Add new content
    if (typeof newContent === 'string') {
      tooltipElement.innerHTML = newContent;
    } else if (newContent instanceof HTMLElement) {
      tooltipElement.appendChild(newContent);
    }
    
    // Reposition if visible
    if (isVisible) {
      positionTooltip();
    }
  }
  
  /**
   * Set up event listeners
   */
  function setupListeners() {
    // Mouse events
    target.addEventListener('mouseenter', show);
    target.addEventListener('mouseleave', hide);
    
    // Focus events (for accessibility)
    target.addEventListener('focus', show);
    target.addEventListener('blur', hide);
    
    // Update position on scroll or resize
    window.addEventListener('scroll', positionTooltip);
    window.addEventListener('resize', positionTooltip);
  }
  
  /**
   * Remove event listeners
   */
  function removeListeners() {
    target.removeEventListener('mouseenter', show);
    target.removeEventListener('mouseleave', hide);
    target.removeEventListener('focus', show);
    target.removeEventListener('blur', hide);
    
    window.removeEventListener('scroll', positionTooltip);
    window.removeEventListener('resize', positionTooltip);
    
    if (tooltipElement && interactive) {
      tooltipElement.removeEventListener('mouseenter', null);
      tooltipElement.removeEventListener('mouseleave', null);
    }
  }
  
  /**
   * Destroy the tooltip
   */
  function destroy() {
    // Remove event listeners
    removeListeners();
    
    // Clear timeouts
    clearTimeout(showTimeout);
    clearTimeout(hideTimeout);
    
    // Remove tooltip element
    if (tooltipElement && tooltipElement.parentNode) {
      tooltipElement.parentNode.removeChild(tooltipElement);
      tooltipElement = null;
    }
  }
  
  // Initialize
  setupListeners();
  
  // Return public API
  return {
    show,
    hide,
    updateContent,
    isVisible: () => isVisible,
    getElement: () => tooltipElement,
    destroy
  };
}

/**
 * Add a tooltip to an element
 * @param {HTMLElement} element - Element to attach tooltip to
 * @param {Object|string} options - Tooltip options or content string
 * @returns {Object} Tooltip controller
 */
Tooltip.attach = (element, options = {}) => {
  // Handle string content
  const props = typeof options === 'string' ? { content: options } : options;
  
  return Tooltip({
    target: element,
    ...props
  });
};

export default Tooltip;
