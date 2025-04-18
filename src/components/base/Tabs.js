/**
 * Base Tabs Component
 * A reusable tabbed interface component
 */

import { eventBus } from '../../utils/events.js';

/**
 * Create a tabs component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Tabs container
 */
export function Tabs(props = {}) {
  const {
    items = [],
    activeTab = 0,
    orientation = 'horizontal', // 'horizontal' or 'vertical'
    tabStyle = 'default', // 'default', 'pills', 'underline'
    onChange = null,
    id = '',
    className = '',
    contentClassName = ''
  } = props;

  // State
  let currentTabIndex = activeTab;
  
  // Create component container
  const container = document.createElement('div');
  container.className = `tabs-container ${orientation} ${className}`;
  if (id) container.id = id;
  
  // Create tabs navigation
  const tabsNav = document.createElement('div');
  tabsNav.className = `tabs-nav ${tabStyle}`;
  
  // Create tabs content container
  const tabsContent = document.createElement('div');
  tabsContent.className = `tabs-content ${contentClassName}`;
  
  // Add tabs and content
  items.forEach((item, index) => {
    // Create tab button
    const tabButton = document.createElement('button');
    tabButton.className = 'tab-button';
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-selected', index === currentTabIndex ? 'true' : 'false');
    tabButton.setAttribute('aria-controls', `tab-panel-${id}-${index}`);
    tabButton.id = `tab-${id}-${index}`;
    
    // Add icon if specified
    if (item.icon) {
      const icon = document.createElement('i');
      icon.className = `fas ${item.icon}`;
      tabButton.appendChild(icon);
      tabButton.appendChild(document.createTextNode(' '));
    }
    
    // Add tab text
    const tabText = document.createTextNode(item.title || '');
    tabButton.appendChild(tabText);
    
    // Add badge if specified
    if (item.badge) {
      const badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.textContent = item.badge;
      tabButton.appendChild(badge);
    }
    
    // Set active state
    if (index === currentTabIndex) {
      tabButton.classList.add('active');
    }
    
    // Handle click event
    tabButton.addEventListener('click', () => {
      setActiveTab(index);
      
      // Call onChange callback if provided
      if (onChange) {
        onChange(index, item);
      }
    });
    
    tabsNav.appendChild(tabButton);
    
    // Create tab panel
    const tabPanel = document.createElement('div');
    tabPanel.className = 'tab-panel';
    tabPanel.id = `tab-panel-${id}-${index}`;
    tabPanel.setAttribute('role', 'tabpanel');
    tabPanel.setAttribute('aria-labelledby', `tab-${id}-${index}`);
    
    // Set initial visibility
    tabPanel.style.display = index === currentTabIndex ? 'block' : 'none';
    
    // Add content
    if (typeof item.content === 'string') {
      tabPanel.innerHTML = item.content;
    } else if (item.content instanceof HTMLElement) {
      tabPanel.appendChild(item.content);
    } else if (typeof item.contentFn === 'function') {
      // Lazy-load content with function
      if (index === currentTabIndex) {
        const contentResult = item.contentFn();
        if (contentResult instanceof HTMLElement) {
          tabPanel.appendChild(contentResult);
        } else if (typeof contentResult === 'string') {
          tabPanel.innerHTML = contentResult;
        }
      } else {
        // Store function for later
        tabPanel.dataset.lazyContent = 'true';
      }
    }
    
    tabsContent.appendChild(tabPanel);
  });
  
  // Add elements to container
  container.appendChild(tabsNav);
  container.appendChild(tabsContent);
  
  /**
   * Set the active tab
   * @param {number} index - Tab index to activate
   */
  function setActiveTab(index) {
    if (index < 0 || index >= items.length) return;
    
    // Update current tab
    const prevIndex = currentTabIndex;
    currentTabIndex = index;
    
    // Update tab buttons
    const tabButtons = tabsNav.querySelectorAll('.tab-button');
    tabButtons.forEach((button, i) => {
      button.classList.toggle('active', i === index);
      button.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    
    // Update tab panels
    const tabPanels = tabsContent.querySelectorAll('.tab-panel');
    tabPanels.forEach((panel, i) => {
      panel.style.display = i === index ? 'block' : 'none';
      
      // Handle lazy loading
      if (i === index && panel.dataset.lazyContent === 'true') {
        // Get content function and execute it
        const item = items[i];
        if (typeof item.contentFn === 'function') {
          const contentResult = item.contentFn();
          
          // Clear any previous content
          panel.innerHTML = '';
          
          if (contentResult instanceof HTMLElement) {
            panel.appendChild(contentResult);
          } else if (typeof contentResult === 'string') {
            panel.innerHTML = contentResult;
          }
          
          // Remove lazy flag
          delete panel.dataset.lazyContent;
        }
      }
    });
    
    // Emit event for tab change
    eventBus.emit('tab-changed', { 
      containerId: id,
      prevIndex,
      currentIndex: index, 
      item: items[index] 
    });
  }
  
  /**
   * Get the currently active tab index
   * @returns {number} Active tab index
   */
  function getActiveTab() {
    return currentTabIndex;
  }
  
  /**
   * Get the currently active tab data
   * @returns {Object} Active tab data
   */
  function getActiveTabData() {
    return items[currentTabIndex];
  }
  
  /**
   * Add a new tab
   * @param {Object} tabData - Tab data
   * @param {boolean} setActive - Whether to activate the new tab
   */
  function addTab(tabData, setActive = false) {
    // Add to items array
    items.push(tabData);
    const newIndex = items.length - 1;
    
    // Create tab button
    const tabButton = document.createElement('button');
    tabButton.className = 'tab-button';
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-selected', setActive ? 'true' : 'false');
    tabButton.setAttribute('aria-controls', `tab-panel-${id}-${newIndex}`);
    tabButton.id = `tab-${id}-${newIndex}`;
    
    // Add icon if specified
    if (tabData.icon) {
      const icon = document.createElement('i');
      icon.className = `fas ${tabData.icon}`;
      tabButton.appendChild(icon);
      tabButton.appendChild(document.createTextNode(' '));
    }
    
    // Add tab text
    const tabText = document.createTextNode(tabData.title || '');
    tabButton.appendChild(tabText);
    
    // Add badge if specified
    if (tabData.badge) {
      const badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.textContent = tabData.badge;
      tabButton.appendChild(badge);
    }
    
    // Handle click event
    tabButton.addEventListener('click', () => {
      setActiveTab(newIndex);
      
      // Call onChange callback if provided
      if (onChange) {
        onChange(newIndex, tabData);
      }
    });
    
    tabsNav.appendChild(tabButton);
    
    // Create tab panel
    const tabPanel = document.createElement('div');
    tabPanel.className = 'tab-panel';
    tabPanel.id = `tab-panel-${id}-${newIndex}`;
    tabPanel.setAttribute('role', 'tabpanel');
    tabPanel.setAttribute('aria-labelledby', `tab-${id}-${newIndex}`);
    
    // Set initial visibility
    tabPanel.style.display = setActive ? 'block' : 'none';
    
    // Add content
    if (typeof tabData.content === 'string') {
      tabPanel.innerHTML = tabData.content;
    } else if (tabData.content instanceof HTMLElement) {
      tabPanel.appendChild(tabData.content);
    } else if (typeof tabData.contentFn === 'function') {
      // Lazy-load content with function
      if (setActive) {
        const contentResult = tabData.contentFn();
        if (contentResult instanceof HTMLElement) {
          tabPanel.appendChild(contentResult);
        } else if (typeof contentResult === 'string') {
          tabPanel.innerHTML = contentResult;
        }
      } else {
        // Store function for later
        tabPanel.dataset.lazyContent = 'true';
      }
    }
    
    tabsContent.appendChild(tabPanel);
    
    // Activate tab if specified
    if (setActive) {
      setActiveTab(newIndex);
    }
    
    return newIndex;
  }
  
  /**
   * Remove a tab
   * @param {number} index - Index of tab to remove
   */
  function removeTab(index) {
    if (index < 0 || index >= items.length) return;
    
    // Remove tab button
    const tabButtons = tabsNav.querySelectorAll('.tab-button');
    if (tabButtons[index]) {
      tabsNav.removeChild(tabButtons[index]);
    }
    
    // Remove tab panel
    const tabPanels = tabsContent.querySelectorAll('.tab-panel');
    if (tabPanels[index]) {
      tabsContent.removeChild(tabPanels[index]);
    }
    
    // Remove from items array
    items.splice(index, 1);
    
    // Update IDs of remaining tabs
    tabsNav.querySelectorAll('.tab-button').forEach((button, i) => {
      button.id = `tab-${id}-${i}`;
      button.setAttribute('aria-controls', `tab-panel-${id}-${i}`);
    });
    
    tabsContent.querySelectorAll('.tab-panel').forEach((panel, i) => {
      panel.id = `tab-panel-${id}-${i}`;
      panel.setAttribute('aria-labelledby', `tab-${id}-${i}`);
    });
    
    // If current tab was removed, activate the previous tab or the first one
    if (currentTabIndex === index) {
      if (currentTabIndex > 0) {
        setActiveTab(currentTabIndex - 1);
      } else if (items.length > 0) {
        setActiveTab(0);
      } else {
        currentTabIndex = -1;
      }
    } else if (currentTabIndex > index) {
      // If removed tab was before the current tab, adjust current index
      currentTabIndex--;
    }
  }
  
  /**
   * Update tab content
   * @param {number} index - Tab index
   * @param {Object} updates - Updates to apply to the tab
   */
  function updateTab(index, updates) {
    if (index < 0 || index >= items.length) return;
    
    // Update item in array
    const item = items[index];
    Object.assign(item, updates);
    
    // Update button
    const tabButtons = tabsNav.querySelectorAll('.tab-button');
    const button = tabButtons[index];
    
    if (button) {
      // Update title if provided
      if (updates.title !== undefined) {
        // Clear button content
        button.innerHTML = '';
        
        // Add icon if specified
        if (item.icon) {
          const icon = document.createElement('i');
          icon.className = `fas ${item.icon}`;
          button.appendChild(icon);
          button.appendChild(document.createTextNode(' '));
        }
        
        // Add tab text
        const tabText = document.createTextNode(item.title || '');
        button.appendChild(tabText);
        
        // Add badge if specified
        if (item.badge) {
          const badge = document.createElement('span');
          badge.className = 'tab-badge';
          badge.textContent = item.badge;
          button.appendChild(badge);
        }
      } else if (updates.icon !== undefined) {
        // Update just the icon
        const icon = button.querySelector('i');
        if (icon) {
          icon.className = `fas ${item.icon}`;
        } else if (item.icon) {
          const newIcon = document.createElement('i');
          newIcon.className = `fas ${item.icon}`;
          button.insertBefore(newIcon, button.firstChild);
          button.insertBefore(document.createTextNode(' '), button.childNodes[1]);
        }
      }
      
      // Update badge if provided
      if (updates.badge !== undefined) {
        let badge = button.querySelector('.tab-badge');
        
        if (badge) {
          if (item.badge) {
            badge.textContent = item.badge;
          } else {
            button.removeChild(badge);
          }
        } else if (item.badge) {
          badge = document.createElement('span');
          badge.className = 'tab-badge';
          badge.textContent = item.badge;
          button.appendChild(badge);
        }
      }
    }
    
    // Update panel content if specified
    if (updates.content !== undefined || updates.contentFn !== undefined) {
      const tabPanels = tabsContent.querySelectorAll('.tab-panel');
      const panel = tabPanels[index];
      
      if (panel) {
        // Clear panel content
        panel.innerHTML = '';
        
        // Add new content
        if (typeof item.content === 'string') {
          panel.innerHTML = item.content;
        } else if (item.content instanceof HTMLElement) {
          panel.appendChild(item.content);
        } else if (typeof item.contentFn === 'function') {
          // Lazy-load content with function
          if (index === currentTabIndex) {
            const contentResult = item.contentFn();
            if (contentResult instanceof HTMLElement) {
              panel.appendChild(contentResult);
            } else if (typeof contentResult === 'string') {
              panel.innerHTML = contentResult;
            }
          } else {
            // Store function for later
            panel.dataset.lazyContent = 'true';
          }
        }
      }
    }
  }
  
  /**
   * Destroy the component
   */
  function destroy() {
    // Remove event listeners
    tabsNav.querySelectorAll('.tab-button').forEach(button => {
      button.removeEventListener('click', null);
    });
    
    // Clear content
    container.innerHTML = '';
  }
  
  // Expose public methods
  container.setActiveTab = setActiveTab;
  container.getActiveTab = getActiveTab;
  container.getActiveTabData = getActiveTabData;
  container.addTab = addTab;
  container.removeTab = removeTab;
  container.updateTab = updateTab;
  container.destroy = destroy;

  return container;
}

export default Tabs;
