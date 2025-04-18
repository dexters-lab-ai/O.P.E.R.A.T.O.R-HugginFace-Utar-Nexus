/**
 * History Overlay Component
 * Full-screen overlay for browsing command and chat history
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.js';
import api from '../utils/api.js';

/**
 * Create a history overlay component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} History overlay container
 */
export function HistoryOverlay(props = {}) {
  const {
    containerId = 'history-overlay'
  } = props;

  // Local state
  let isVisible = false;
  let currentView = 'list'; // 'list' or 'timeline'
  let currentFilter = 'all'; // 'all', 'chat', 'command'
  let isLoading = false;
  let currentPage = 1;
  let totalPages = 1;
  
  // Create component container
  const container = document.createElement('div');
  container.className = 'history-overlay';
  container.id = containerId;
  
  // Create overlay header
  const header = document.createElement('div');
  header.className = 'overlay-header';
  
  const title = document.createElement('h2');
  title.innerHTML = '<i class="fas fa-history"></i> Command History';
  header.appendChild(title);
  
  // Add filter buttons
  const filterContainer = document.createElement('div');
  filterContainer.className = 'history-filters';
  
  const filterButtons = [
    { text: 'All', value: 'all', icon: 'fa-list-ul' },
    { text: 'Chat', value: 'chat', icon: 'fa-comments' },
    { text: 'Commands', value: 'command', icon: 'fa-terminal' }
  ];
  
  filterButtons.forEach(filter => {
    const button = Button({
      text: filter.text,
      icon: filter.icon,
      variant: filter.value === currentFilter ? Button.VARIANTS.PRIMARY : Button.VARIANTS.SECONDARY,
      size: Button.SIZES.SMALL,
      className: filter.value === currentFilter ? 'active' : '',
      onClick: () => {
        // Update filter
        currentFilter = filter.value;
        
        // Update button states
        filterContainer.querySelectorAll('button').forEach(btn => {
          btn.classList.toggle('active', btn.textContent.trim() === filter.text);
          
          // Update button variant
          btn.className = btn.className.replace(/btn-\w+/g, '');
          btn.classList.add(btn.textContent.trim() === filter.text ? 
            'btn-primary' : 'btn-secondary');
        });
        
        // Reload history
        loadHistory();
      }
    });
    
    filterContainer.appendChild(button);
  });
  
  header.appendChild(filterContainer);
  
  // Add view toggle
  const viewToggle = document.createElement('div');
  viewToggle.className = 'view-toggle';
  
  const listViewBtn = Button({
    icon: 'fa-list',
    variant: currentView === 'list' ? Button.VARIANTS.PRIMARY : Button.VARIANTS.SECONDARY,
    size: Button.SIZES.SMALL,
    className: currentView === 'list' ? 'active' : '',
    onClick: () => {
      if (currentView !== 'list') {
        currentView = 'list';
        updateViewToggle();
        updateContentView();
      }
    }
  });
  
  const timelineViewBtn = Button({
    icon: 'fa-stream',
    variant: currentView === 'timeline' ? Button.VARIANTS.PRIMARY : Button.VARIANTS.SECONDARY,
    size: Button.SIZES.SMALL,
    className: currentView === 'timeline' ? 'active' : '',
    onClick: () => {
      if (currentView !== 'timeline') {
        currentView = 'timeline';
        updateViewToggle();
        updateContentView();
      }
    }
  });
  
  viewToggle.appendChild(listViewBtn);
  viewToggle.appendChild(timelineViewBtn);
  
  header.appendChild(viewToggle);
  
  // Add close button
  const closeButton = Button({
    icon: 'fa-times',
    variant: Button.VARIANTS.TEXT,
    onClick: () => hide()
  });
  
  header.appendChild(closeButton);
  container.appendChild(header);
  
  // Create content container
  const content = document.createElement('div');
  content.className = 'overlay-content';
  
  // List view container
  const listView = document.createElement('div');
  listView.className = 'history-list-view';
  
  // History table
  const historyTable = document.createElement('table');
  historyTable.className = 'history-table';
  historyTable.innerHTML = `
    <thead>
      <tr>
        <th width="50">#</th>
        <th>Command/Message</th>
        <th width="200">Time</th>
        <th width="100">Type</th>
        <th width="80">Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  
  listView.appendChild(historyTable);
  
  // Timeline view container
  const timelineView = document.createElement('div');
  timelineView.className = 'history-timeline-view';
  
  // Timeline visualization
  const timelineViz = document.createElement('div');
  timelineViz.className = 'timeline-visualization';
  
  timelineView.appendChild(timelineViz);
  
  // Add views to content
  content.appendChild(listView);
  content.appendChild(timelineView);
  container.appendChild(content);
  
  // Create pagination controls
  const pagination = document.createElement('div');
  pagination.className = 'history-pagination';
  
  const prevPageBtn = Button({
    text: 'Previous',
    icon: 'fa-chevron-left',
    variant: Button.VARIANTS.SECONDARY,
    disabled: currentPage <= 1,
    onClick: () => {
      if (currentPage > 1) {
        currentPage--;
        loadHistory();
      }
    }
  });
  
  const nextPageBtn = Button({
    text: 'Next',
    icon: 'fa-chevron-right',
    variant: Button.VARIANTS.SECONDARY,
    iconPosition: 'right',
    disabled: currentPage >= totalPages,
    onClick: () => {
      if (currentPage < totalPages) {
        currentPage++;
        loadHistory();
      }
    }
  });
  
  const pageIndicator = document.createElement('div');
  pageIndicator.className = 'page-indicator';
  pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
  
  pagination.appendChild(prevPageBtn);
  pagination.appendChild(pageIndicator);
  pagination.appendChild(nextPageBtn);
  
  container.appendChild(pagination);
  
  // Loading indicator
  const loadingIndicator = document.createElement('div');
  loadingIndicator.className = 'loading-indicator';
  loadingIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  loadingIndicator.style.display = 'none';
  
  container.appendChild(loadingIndicator);
  
  // Update the view toggle buttons
  function updateViewToggle() {
    listViewBtn.className = listViewBtn.className.replace(/btn-\w+/g, '');
    timelineViewBtn.className = timelineViewBtn.className.replace(/btn-\w+/g, '');
    
    listViewBtn.classList.add(currentView === 'list' ? 'btn-primary' : 'btn-secondary');
    timelineViewBtn.classList.add(currentView === 'timeline' ? 'btn-primary' : 'btn-secondary');
    
    listViewBtn.classList.toggle('active', currentView === 'list');
    timelineViewBtn.classList.toggle('active', currentView === 'timeline');
  }
  
  // Update content view based on selected view
  function updateContentView() {
    listView.style.display = currentView === 'list' ? 'block' : 'none';
    timelineView.style.display = currentView === 'timeline' ? 'block' : 'none';
  }
  
  // Load history data
  async function loadHistory() {
    if (isLoading) return;
    
    isLoading = true;
    loadingIndicator.style.display = 'flex';
    
    try {
      // Update content based on view and filter
      const tableBody = historyTable.querySelector('tbody');
      tableBody.innerHTML = ''; // Clear table
      
      timelineViz.innerHTML = ''; // Clear timeline
      
      // Get history data from API
      const historyData = await api.history.getHistory({
        page: currentPage,
        limit: 20,
        type: currentFilter === 'all' ? null : currentFilter
      });
      
      if (historyData) {
        // Update pagination
        totalPages = historyData.totalPages || 1;
        currentPage = historyData.currentPage || 1;
        
        // Update page indicator
        pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
        
        // Update pagination buttons
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
        
        // Populate view with data
        if (historyData.items && historyData.items.length > 0) {
          if (currentView === 'list') {
            populateListView(historyData.items);
          } else {
            populateTimelineView(historyData.items);
          }
        } else {
          // Show empty state
          if (currentView === 'list') {
            tableBody.innerHTML = `
              <tr>
                <td colspan="5" class="empty-state">
                  <i class="fas fa-search"></i>
                  <p>No history items found</p>
                </td>
              </tr>
            `;
          } else {
            timelineViz.innerHTML = `
              <div class="empty-state">
                <i class="fas fa-search"></i>
                <p>No history items found</p>
              </div>
            `;
          }
        }
      }
    } catch (error) {
      console.error('Failed to load history:', error);
      
      // Show error state
      if (currentView === 'list') {
        const tableBody = historyTable.querySelector('tbody');
        tableBody.innerHTML = `
          <tr>
            <td colspan="5" class="error-state">
              <i class="fas fa-exclamation-triangle"></i>
              <p>Failed to load history</p>
            </td>
          </tr>
        `;
      } else {
        timelineViz.innerHTML = `
          <div class="error-state">
            <i class="fas fa-exclamation-triangle"></i>
            <p>Failed to load history</p>
          </div>
        `;
      }
    } finally {
      isLoading = false;
      loadingIndicator.style.display = 'none';
    }
  }
  
  // Populate list view with history items
  function populateListView(items) {
    const tableBody = historyTable.querySelector('tbody');
    
    items.forEach((item, index) => {
      const row = document.createElement('tr');
      
      // Format date
      const date = new Date(item.timestamp);
      const formattedDate = date.toLocaleString();
      
      // Determine icon and type label
      let typeIcon = 'fa-comment';
      let typeLabel = 'Message';
      
      if (item.type === 'command') {
        typeIcon = 'fa-terminal';
        typeLabel = 'Command';
      } else if (item.role === 'assistant') {
        typeIcon = 'fa-robot';
        typeLabel = 'Response';
      }
      
      row.innerHTML = `
        <td>${(currentPage - 1) * 20 + index + 1}</td>
        <td class="command-cell">
          <i class="fas ${typeIcon}"></i>
          <span class="command-text">${item.content}</span>
        </td>
        <td>${formattedDate}</td>
        <td><span class="badge ${item.type}">${typeLabel}</span></td>
        <td class="actions-cell">
          <button class="btn btn-icon btn-sm btn-secondary rerun-btn" title="Re-run or re-send">
            <i class="fas fa-redo"></i>
          </button>
          <button class="btn btn-icon btn-sm btn-secondary copy-btn" title="Copy to clipboard">
            <i class="fas fa-copy"></i>
          </button>
        </td>
      `;
      
      // Add event handlers
      const rerunBtn = row.querySelector('.rerun-btn');
      rerunBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        rerunHistoryItem(item);
      });
      
      const copyBtn = row.querySelector('.copy-btn');
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(item.content);
      });
      
      tableBody.appendChild(row);
    });
  }
  
  // Populate timeline view with history items
  function populateTimelineView(items) {
    // Group items by date
    const groupedByDate = {};
    
    items.forEach(item => {
      const date = new Date(item.timestamp);
      const dateKey = date.toLocaleDateString();
      
      if (!groupedByDate[dateKey]) {
        groupedByDate[dateKey] = [];
      }
      
      groupedByDate[dateKey].push(item);
    });
    
    // Create timeline groups
    Object.entries(groupedByDate).forEach(([dateKey, dateItems]) => {
      const dateGroup = document.createElement('div');
      dateGroup.className = 'timeline-date-group';
      
      const dateHeader = document.createElement('h3');
      dateHeader.className = 'timeline-date';
      dateHeader.textContent = dateKey;
      dateGroup.appendChild(dateHeader);
      
      const timelineItems = document.createElement('div');
      timelineItems.className = 'timeline-items';
      
      // Add items
      dateItems.forEach(item => {
        const timelineItem = document.createElement('div');
        timelineItem.className = `timeline-item ${item.type} ${item.role || ''}`;
        
        // Format time
        const date = new Date(item.timestamp);
        const formattedTime = date.toLocaleTimeString();
        
        // Determine icon
        let itemIcon = 'fa-comment';
        
        if (item.type === 'command') {
          itemIcon = 'fa-terminal';
        } else if (item.role === 'assistant') {
          itemIcon = 'fa-robot';
        }
        
        timelineItem.innerHTML = `
          <div class="timeline-item-icon">
            <i class="fas ${itemIcon}"></i>
          </div>
          <div class="timeline-item-content">
            <div class="timeline-item-header">
              <span class="timeline-item-time">${formattedTime}</span>
              <div class="timeline-item-actions">
                <button class="btn btn-icon btn-xs btn-secondary rerun-btn" title="Re-run or re-send">
                  <i class="fas fa-redo"></i>
                </button>
                <button class="btn btn-icon btn-xs btn-secondary copy-btn" title="Copy to clipboard">
                  <i class="fas fa-copy"></i>
                </button>
              </div>
            </div>
            <div class="timeline-item-text">${item.content}</div>
          </div>
        `;
        
        // Add event handlers
        const rerunBtn = timelineItem.querySelector('.rerun-btn');
        rerunBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          rerunHistoryItem(item);
        });
        
        const copyBtn = timelineItem.querySelector('.copy-btn');
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          copyToClipboard(item.content);
        });
        
        timelineItems.appendChild(timelineItem);
      });
      
      dateGroup.appendChild(timelineItems);
      timelineViz.appendChild(dateGroup);
    });
  }
  
  // Rerun or resend a history item
  function rerunHistoryItem(item) {
    // Hide the overlay
    hide();
    
    // Emit event to re-run or re-send the item
    eventBus.emit('history-item-rerun', item);
    
    // If it's a chat message, also emit event to populate the input field
    if (item.type === 'chat') {
      eventBus.emit('populate-chat-input', { text: item.content });
    }
  }
  
  // Copy text to clipboard
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
      .then(() => {
        // Show success notification
        eventBus.emit('notification', {
          message: 'Copied to clipboard',
          type: 'success'
        });
      })
      .catch(err => {
        console.error('Failed to copy text: ', err);
        
        // Show error notification
        eventBus.emit('notification', {
          message: 'Failed to copy to clipboard',
          type: 'error'
        });
      });
  }
  
  // Show the overlay
  function show() {
    if (!isVisible) {
      // Reset to page 1 when showing
      currentPage = 1;
      
      // Load history data
      loadHistory();
      
      // Show overlay with animation
      container.style.display = 'flex';
      
      // Trigger reflow
      void container.offsetWidth;
      
      // Add visible class for animation
      container.classList.add('visible');
      
      // Update state
      isVisible = true;
      
      // Update store
      stores.ui.setState({ historyOverlayVisible: true });
      
      // Emit event
      eventBus.emit('history-overlay-shown');
      
      // Add body class to prevent scrolling
      document.body.classList.add('overlay-open');
    }
  }
  
  // Hide the overlay
  function hide() {
    if (isVisible) {
      // Hide with animation
      container.classList.remove('visible');
      
      // Wait for animation to complete
      setTimeout(() => {
        container.style.display = 'none';
        
        // Update state
        isVisible = false;
        
        // Update store
        stores.ui.setState({ historyOverlayVisible: false });
        
        // Emit event
        eventBus.emit('history-overlay-hidden');
        
        // Remove body class
        document.body.classList.remove('overlay-open');
      }, 300); // Match animation duration
    }
  }
  
  // Toggle overlay visibility
  function toggle() {
    if (isVisible) {
      hide();
    } else {
      show();
    }
  }
  
  // Initialize component
  function initialize() {
    // Apply initial view
    updateContentView();
    
    // Subscribe to store changes
    const unsubscribeStore = stores.ui.subscribe((state) => {
      if (state.historyOverlayVisible !== undefined && state.historyOverlayVisible !== isVisible) {
        if (state.historyOverlayVisible) {
          show();
        } else {
          hide();
        }
      }
    });
    
    // Listen for history toggle events
    const unsubscribeEvent = eventBus.on('toggle-history-overlay', toggle);
    
    // Set up ESC key to close overlay
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isVisible) {
        hide();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    // Clean up function
    return () => {
      unsubscribeStore();
      unsubscribeEvent();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }
  
  // Initialize and get cleanup method
  const cleanup = initialize();
  
  // Expose public methods
  container.show = show;
  container.hide = hide;
  container.toggle = toggle;
  container.refresh = loadHistory;
  
  // Cleanup method
  container.destroy = () => {
    cleanup();
    
    // Remove event listeners
    const buttons = container.querySelectorAll('button');
    buttons.forEach(button => {
      button.removeEventListener('click', null);
    });
  };

  return container;
}

/**
 * Mount a history overlay to the document body
 * @param {Object} props - Overlay properties
 * @returns {HTMLElement} The mounted overlay
 */
HistoryOverlay.mount = (props = {}) => {
  const overlay = HistoryOverlay(props);
  document.body.appendChild(overlay);
  return overlay;
};

export default HistoryOverlay;
