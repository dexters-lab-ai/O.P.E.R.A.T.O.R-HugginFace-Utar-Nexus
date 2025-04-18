/**
 * Base Button Component
 * A reusable button component with various style variants
 */

import { eventBus } from '../../utils/events.js';

// Enum for button variants
const VARIANTS = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  DANGER: 'danger',
  TEXT: 'text',
  ICON: 'icon'
};

// Enum for button sizes
const SIZES = {
  SMALL: 'sm',
  MEDIUM: 'md',
  LARGE: 'lg'
};

/**
 * Create a button component
 * @param {Object} props - Component properties
 * @returns {HTMLButtonElement} Button element
 */
export function Button(props = {}) {
  const {
    text = '',
    icon = '',
    variant = VARIANTS.PRIMARY,
    size = SIZES.MEDIUM,
    disabled = false,
    onClick = null,
    className = '',
    id = ''
  } = props;

  // Create the button element
  const button = document.createElement('button');
  
  // Set button attributes
  if (id) button.id = id;
  button.disabled = disabled;
  button.type = props.type || 'button';
  
  // Build CSS classes
  const classes = ['btn'];
  
  // Add variant class
  if (variant !== VARIANTS.PRIMARY) {
    classes.push(`btn-${variant}`);
  }
  
  // Add size class if not medium
  if (size !== SIZES.MEDIUM) {
    classes.push(`btn-${size}`);
  }
  
  // Add custom classes
  if (className) {
    classes.push(className);
  }
  
  button.className = classes.join(' ');
  
  // Add icon if provided
  if (icon) {
    const iconEl = document.createElement('i');
    iconEl.className = icon.startsWith('fa-') ? `fas ${icon}` : icon;
    button.appendChild(iconEl);
    
    // Add spacing if there's also text
    if (text) {
      button.appendChild(document.createTextNode(' '));
    }
  }
  
  // Add text content if provided
  if (text) {
    button.appendChild(document.createTextNode(text));
  }
  
  // Add click handler
  if (onClick) {
    button.addEventListener('click', (e) => {
      if (!disabled) onClick(e);
    });
  }
  
  return button;
}

/**
 * Mount a button to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - Button properties
 * @returns {HTMLButtonElement} The mounted button
 */
Button.mount = (parent, props = {}) => {
  const button = Button(props);
  parent.appendChild(button);
  return button;
};

// Export variant and size constants
Button.VARIANTS = VARIANTS;
Button.SIZES = SIZES;

export default Button;
