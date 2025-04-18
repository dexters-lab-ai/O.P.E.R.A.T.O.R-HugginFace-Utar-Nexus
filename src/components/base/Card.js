/**
 * Base Card Component
 * A reusable card container component with various style options
 */

/**
 * Create a card component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Card element
 */
export function Card(props = {}) {
  const {
    title = '',
    titleIcon = '',
    content = '',
    footer = '',
    collapsible = false,
    collapsed = false,
    className = '',
    id = '',
    onCollapse = null
  } = props;

  // Create the card container
  const card = document.createElement('div');
  card.className = `card ${className || ''}`;
  if (id) card.id = id;
  
  // Add data attributes
  if (collapsible) {
    card.setAttribute('data-collapsible', 'true');
    card.classList.add(collapsed ? 'collapsed' : 'expanded');
  }

  // Create title if provided
  if (title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    
    // Add icon if provided
    if (titleIcon) {
      const iconEl = document.createElement('i');
      iconEl.className = titleIcon.startsWith('fa-') ? `fas ${titleIcon}` : titleIcon;
      titleEl.appendChild(iconEl);
      titleEl.appendChild(document.createTextNode(' '));
    }
    
    // Add title text
    titleEl.appendChild(document.createTextNode(title));
    
    // Add collapse toggle button if card is collapsible
    if (collapsible) {
      const toggleEl = document.createElement('button');
      toggleEl.className = 'collapse-toggle';
      toggleEl.innerHTML = '<i class="fas fa-chevron-down"></i>';
      
      toggleEl.addEventListener('click', (e) => {
        e.preventDefault();
        
        const isCollapsed = card.classList.contains('collapsed');
        card.classList.toggle('collapsed', !isCollapsed);
        card.classList.toggle('expanded', isCollapsed);
        
        // Set proper icon rotation
        toggleEl.querySelector('i').className = isCollapsed 
          ? 'fas fa-chevron-down' 
          : 'fas fa-chevron-up';
        
        // Call onCollapse callback if provided
        if (onCollapse) onCollapse(!isCollapsed);
      });
      
      // Initial state
      toggleEl.querySelector('i').className = collapsed 
        ? 'fas fa-chevron-up'
        : 'fas fa-chevron-down';
        
      titleEl.appendChild(toggleEl);
    }
    
    card.appendChild(titleEl);
  }

  // Create content container
  const contentEl = document.createElement('div');
  contentEl.className = 'card-content';
  
  // Handle content
  if (typeof content === 'string') {
    contentEl.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    contentEl.appendChild(content);
  } else if (Array.isArray(content)) {
    content.forEach(item => {
      if (item instanceof HTMLElement) {
        contentEl.appendChild(item);
      }
    });
  }
  
  card.appendChild(contentEl);

  // Create footer if provided
  if (footer) {
    const footerEl = document.createElement('div');
    footerEl.className = 'card-footer';
    
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
    
    card.appendChild(footerEl);
  }

  return card;
}

/**
 * Mount a card to a parent element
 * @param {HTMLElement} parent - Parent element
 * @param {Object} props - Card properties
 * @returns {HTMLElement} The mounted card
 */
Card.mount = (parent, props = {}) => {
  const card = Card(props);
  parent.appendChild(card);
  return card;
};

export default Card;
