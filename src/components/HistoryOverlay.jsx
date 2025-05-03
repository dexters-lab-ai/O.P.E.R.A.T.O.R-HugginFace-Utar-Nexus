/**
 * History Overlay Component
 * Full-screen overlay for browsing command and chat history
 */

import { eventBus } from '../utils/events.js';
import { getAllHistory, deleteHistory, getHistoryById } from '../api/history.js';

// Create a singleton instance
let historyOverlayInstance = null;

/**
 * Get singleton instance of the HistoryOverlay
 * @returns {HTMLElement} The history overlay component
 */
export function getHistoryOverlay() {
  if (!historyOverlayInstance) {
    historyOverlayInstance = createHistoryOverlay();
    // Append to DOM immediately
    document.body.appendChild(historyOverlayInstance);
  }
  return historyOverlayInstance;
}

/**
 * Create a history overlay component
 * @returns {HTMLElement} The history overlay component
 */
function createHistoryOverlay() {
  // Create the overlay container
  const overlay = document.createElement('div');
  overlay.className = 'history-overlay';
  overlay.id = 'history-overlay';
  
  // Build the overlay structure
  overlay.innerHTML = `
    <div class="history-content">
      <div class="overlay-header">
        <h2><i class="fas fa-history"></i> Command History</h2>
        <div class="overlay-controls">
          <div class="search-container">
            <input type="text" placeholder="Search history..." class="search-input">
            <button class="search-btn"><i class="fas fa-search"></i></button>
          </div>
          <div class="filter-container">
            <select class="filter-select">
              <option value="all">All Categories</option>
              <option value="task">Tasks</option>
              <option value="query">Queries</option>
              <option value="action">Actions</option>
            </select>
          </div>
          <div class="view-toggle">
            <button class="view-btn active" data-view="card"><i class="fas fa-th-large"></i></button>
            <button class="view-btn" data-view="list"><i class="fas fa-list"></i></button>
          </div>
          <button class="close-btn"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="history-container">
        <div class="history-items">
          <div class="card-view active">
            <div class="history-grid">
              <!-- Cards will be populated here -->
              <div class="loading-container">
                <div class="loading-spinner"></div>
                <p>Loading history...</p>
              </div>
            </div>
          </div>
          <div class="list-view">
            <table class="history-table">
              <thead>
                <tr>
                  <th width="15%">Date</th>
                  <th width="30%">Command/Summary</th>
                  <th width="10%" class="center-align">Category</th>
                  <th width="10%" class="center-align">Status</th>
                  <th width="20%">Reports</th>
                  <th width="15%">Actions</th>
                </tr>
              </thead>
              <tbody>
                <!-- Table rows will be populated here -->
              </tbody>
            </table>
          </div>
        </div>
        <div class="pagination-controls">
          <button class="pagination-btn prev-page-btn" disabled><i class="fas fa-chevron-left"></i></button>
          <span class="page-info">Page 1 of 1</span>
          <button class="pagination-btn next-page-btn" disabled><i class="fas fa-chevron-right"></i></button>
        </div>
      </div>
    </div>
  `;
  
  // Get elements
  const closeBtn = overlay.querySelector('.close-btn');
  const searchInput = overlay.querySelector('.search-input');
  const searchBtn = overlay.querySelector('.search-btn');
  const filterSelect = overlay.querySelector('.filter-select');
  const viewBtns = overlay.querySelectorAll('.view-btn');
  const cardView = overlay.querySelector('.card-view');
  const listView = overlay.querySelector('.list-view');
  const historyGrid = overlay.querySelector('.history-grid');
  const historyTable = overlay.querySelector('.history-table');
  const prevPageBtn = overlay.querySelector('.prev-page-btn');
  const nextPageBtn = overlay.querySelector('.next-page-btn');
  const pageInfo = overlay.querySelector('.page-info');
  
  // State
  let currentPage = 1;
  let totalPages = 1;
  let currentView = 'card'; // 'card' or 'list'
  let currentFilter = 'all';
  let searchTerm = '';
  let isLoading = false;
  let itemsPerPage = 20;
  let totalItems = 0;
  
  // Stop propagation on content clicks to prevent closing when clicking inside
  const historyContainer = overlay.querySelector('.history-container');
  historyContainer.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // Stop propagation on header clicks
  const overlayHeader = overlay.querySelector('.overlay-header');
  overlayHeader.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // Handle clicks on the overlay background (close the overlay)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      toggle(false);
    }
  });
  
  // Close button handler
  closeBtn.addEventListener('click', () => {
    toggle(false);
  });
  
  // View toggle handlers
  viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      setView(view);
    });
  });
  
  // Search handlers
  searchBtn.addEventListener('click', () => {
    searchTerm = searchInput.value.trim();
    currentPage = 1;
    loadHistory();
  });
  
  searchInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      searchTerm = searchInput.value.trim();
      currentPage = 1;
      loadHistory();
    }
  });
  
  // Filter handlers
  filterSelect.addEventListener('change', () => {
    currentFilter = filterSelect.value;
    currentPage = 1;
    loadHistory();
  });
  
  // Pagination handlers
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadHistory();
    }
  });
  
  nextPageBtn.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      loadHistory();
    }
  });
  
  // Set the current view
  function setView(view) {
    currentView = view;
    
    // Update UI
    viewBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === view);
    });
    
    console.log(`Switching to ${view} view`);
    
    if (view === 'card') {
      cardView.classList.add('active');
      listView.classList.remove('active');
    } else {
      cardView.classList.remove('active');
      listView.classList.add('active');
    }
    
    // Make sure the container is visible regardless of view
    const historyItemsContainer = overlay.querySelector('.history-items');
    historyItemsContainer.style.display = 'block';
    historyItemsContainer.style.width = '100%';
    historyItemsContainer.style.height = '100%';
    
    // Load the data again to ensure the current view is populated
    loadHistory();
  }
  
  // Load history data
  async function loadHistory() {
    if (isLoading) return;
    
    isLoading = true;
    updateLoadingState(true);
    
    try {
      // Get the page and limit from the pagination controls
      const page = currentPage || 1;
      const limit = itemsPerPage || 20;
      
      // Apply filter if needed
      const params = { 
        page, 
        limit,
        type: currentFilter !== 'all' ? currentFilter : undefined,
        search: searchTerm || undefined
      };
      
      console.log('Fetching history with params:', params);
      
      // Call the API with the correct parameters
      const response = await getAllHistory(params);
      console.log('History API response:', response);
      
      // Handle different response formats
      let items = [];
      let paginationInfo = { totalPages: 1, totalItems: 0 };
      
      if (Array.isArray(response)) {
        // Simple array response
        items = response;
      } else if (response.items && Array.isArray(response.items)) {
        // Response with items array and pagination
        items = response.items;
        if (response.pagination) {
          paginationInfo = response.pagination;
        } else if (response.total_pages) {
          paginationInfo = {
            totalPages: response.total_pages,
            totalItems: response.total_items || items.length
          };
        }
      } else if (response.data && Array.isArray(response.data)) {
        // Response with data array field
        items = response.data;
        if (response.pagination) {
          paginationInfo = response.pagination;
        }
      }
      
      // Update pagination controls
      totalPages = paginationInfo.totalPages || 1;
      totalItems = paginationInfo.totalItems || items.length;
      updatePaginationControls();
      
      console.log(`Loaded ${items.length} history items`);
      
      // Normalize items to ensure they have the expected fields
      const normalizedItems = items.map(item => {
        console.log('Processing history item:', item);
        // Extract result data - could be directly in result or in meta
        const result = item.result || {};
        const meta = item.meta || result.meta || {};
        
        // Extract report URLs from various possible locations in the data structure
        const midsceneReportUrl = meta.midsceneReportUrl || 
                               result.midsceneReportUrl || 
                               (result.raw && result.raw.midsceneReportUrl) || 
                               '';
        
        const landingReportUrl = meta.landingReportUrl || 
                              result.landingReportUrl || 
                              (result.raw && result.raw.landingReportUrl) || 
                              '';
        
        // Extract the summary - could be in multiple locations
        const summary = meta.summary || 
                    item.summary || 
                    (result.aiPrepared && result.aiPrepared.summary) || 
                    result.summary || 
                    '';
                    
        // Extract screenshot if available - check both screenshot and screenshotPath fields
        const screenshot = meta.screenshot || 
                        meta.screenshotPath ||
                        result.screenshot ||
                        result.screenshotPath ||
                        (result.raw && (result.raw.screenshot || result.raw.screenshotPath)) ||
                        '';
        
        return {
          id: item.id || item._id || item.taskId || '',
          title: item.title || item.command || item.prompt || 'Untitled Task',
          summary: summary,
          date: item.date || item.timestamp || item.created_at || new Date().toISOString(),
          status: item.status || (item.error ? 'error' : 'completed'),
          type: item.type || 'task',
          tags: item.tags || [],
          url: item.url || '',
          command: item.command || item.prompt || '',
          // Include the metadata fields
          midsceneReportUrl: midsceneReportUrl,
          landingReportUrl: landingReportUrl,
          screenshot: screenshot,
          // Store the raw result for detailed view
          rawResult: result
        };
      });
      
      // Update view with normalized data
      if (currentView === 'card') {
        renderCardView(normalizedItems);
      } else {
        renderListView(normalizedItems);
      }
    } catch (error) {
      console.error('Error loading history:', error);
      
      // Show error state
      if (currentView === 'card') {
        historyGrid.innerHTML = `
          <div class="error-container">
            <i class="fas fa-exclamation-triangle"></i>
            <p>Failed to load history: ${error.message || 'Unknown error'}</p>
            <button class="retry-btn">Retry</button>
          </div>
        `;
        
        // Add retry button handler
        const retryBtn = historyGrid.querySelector('.retry-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', loadHistory);
        }
      } else {
        const tableBody = historyTable.querySelector('tbody');
        tableBody.innerHTML = `
          <tr>
            <td colspan="5" class="error-state">
              <i class="fas fa-exclamation-triangle"></i>
              <p>Failed to load history: ${error.message || 'Unknown error'}</p>
              <button class="retry-btn">Retry</button>
            </td>
          </tr>
        `;
        
        // Add retry button handler
        const retryBtn = tableBody.querySelector('.retry-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', loadHistory);
        }
      }
    } finally {
      isLoading = false;
      updateLoadingState(false);
    }
  }
  
  // Render card view
  function renderCardView(items) {
    if (!items || items.length === 0) {
      historyGrid.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-inbox"></i>
          <p>No history items found</p>
        </div>
      `;
      return;
    }
    
    historyGrid.innerHTML = items.map(item => {
      // Generate link badges if URLs are available
      const midsceneLink = item.midsceneReportUrl ? 
        `<a href="${item.midsceneReportUrl}" class="report-link midscene-link" target="_blank" title="Midscene Report"><i class="fas fa-file-alt"></i> Midscene</a>` : '';
      
      const landingLink = item.landingReportUrl ? 
        `<a href="${item.landingReportUrl}" class="report-link landing-link" target="_blank" title="Landing Report"><i class="fas fa-file-alt"></i> Landing</a>` : '';
      
      // Generate screenshot preview if available
      const screenshotPreview = item.screenshot ? 
        `<div class="screenshot-preview" style="background-image: url(${item.screenshot})" title="Task Screenshot"></div>` : '';
      
      return `
        <div class="history-card" data-id="${item.id}" data-command="${item.command}">
          <div class="history-card-header">
            <div class="history-date">${formatDate(item.date)}</div>
            <div class="history-status ${getStatusClass(item.status)}">${item.status}</div>
          </div>
          ${screenshotPreview}
          <div class="history-card-content">
            <h3 class="history-title">${item.title}</h3>
            <p class="history-summary">${item.summary}</p>
          </div>
          <div class="history-card-footer">
            <div class="history-links">
              ${midsceneLink}
              ${landingLink}
            </div>
            <div class="history-actions">
              <button class="history-action-btn view-btn" title="View Details"><i class="fas fa-eye"></i></button>
              <button class="history-action-btn replay-btn" title="Replay Command"><i class="fas fa-play"></i></button>
              <button class="history-action-btn delete-btn" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    // Add card action handlers
    attachCardActions();
  }
  
  // Render list view
  function renderListView(data) {
    console.log('Rendering list view with data:', data);
    const tableBody = listView.querySelector('tbody');
    tableBody.innerHTML = '';

    if (!data || data.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'empty-row';
      emptyRow.innerHTML = `
        <td colspan="6" class="empty-message">
          <div class="empty-state">
            <i class="fa-light fa-hourglass-empty"></i>
            <span>No history items found</span>
          </div>
        </td>
      `;
      tableBody.appendChild(emptyRow);
      return;
    }
    
    // Make sure list view is shown
    listView.style.display = 'block';
    
    // Generate table rows
    data.forEach(item => {
      // Generate link badges if URLs are available
      const links = [];
      
      if (item.landingReportUrl) {
        links.push(`<a href="${item.landingReportUrl}" class="report-badge landing" target="_blank">Landing</a>`);
      }
      
      if (item.midsceneReportUrl) {
        links.push(`<a href="${item.midsceneReportUrl}" class="report-badge midscene" target="_blank">Midscene</a>`);
      }
      
      if (item.errorReportUrl) {
        links.push(`<a href="${item.errorReportUrl}" class="report-badge error" target="_blank">Error</a>`);
      }
      
      const linksHtml = links.length > 0 ? links.join('') : '<span class="no-reports">No reports</span>';
      
      const tr = document.createElement('tr');
      tr.setAttribute('data-id', item.id);
      tr.setAttribute('data-command', escapeHtml(item.command || ''));
      
      tr.innerHTML = `
        <td>${formatDate(item.date)}</td>
        <td class="table-summary">${escapeHtml(item.summary || 'No summary available')}</td>
        <td class="center-align">${item.category || 'command'}</td>
        <td class="center-align"><span class="status-badge ${getStatusClass(item.status)}">${item.status || 'completed'}</span></td>
        <td class="reports-cell">${linksHtml}</td>
        <td class="actions-cell">
          <button class="view-btn" title="View Details"><i class="fas fa-eye"></i></button>
          <button class="replay-btn" title="Replay Command"><i class="fas fa-redo"></i></button>
          <button class="delete-btn" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      `;
      
      tableBody.appendChild(tr);
    });
    
    // Add row action handlers
    attachTableActions();
    
    // Make rows clickable
    makeRowsClickable();
  }
  function attachCardActions() {
    // View details
    historyGrid.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.history-card');
        const id = card.getAttribute('data-id');
        viewHistoryDetails(id);
      });
    });
    
    // Replay command
    historyGrid.querySelectorAll('.replay-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.history-card');
        const id = card.getAttribute('data-id');
        replayCommand(id);
      });
    });
    
    // Delete
    historyGrid.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.history-card');
        const id = card.getAttribute('data-id');
        deleteHistoryItem(id);
      });
    });
  }
  
  // Make entire card clickable (view details)
  historyGrid.querySelectorAll('.history-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      viewHistoryDetails(id);
    });
  });
  
  // Attach action handlers to table rows
  function attachTableActions() {
    // View details
    listView.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('tr');
        const id = row.getAttribute('data-id');
        viewHistoryDetails(id);
      });
    });
    
    // Replay command
    listView.querySelectorAll('.replay-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('tr');
        const id = row.getAttribute('data-id');
        replayCommand(id);
      });
    });
    
    // Delete
    listView.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('tr');
        const id = row.getAttribute('data-id');
        deleteHistoryItem(id);
      });
    });
    
  }
  
  // Make entire row clickable (view details) - attach after rendering list view
  function makeRowsClickable() {
    listView.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', (e) => {
        // Only trigger if not clicking on a button
        if (!e.target.closest('button')) {
          const id = row.getAttribute('data-id');
          viewHistoryDetails(id);
        }
      });
    });
  }
  
  // View history item details
  async function viewHistoryDetails(id) {
    try {
      console.log('Viewing details for history item:', id);
      
      // First try to find the item in our already loaded data
      const historyCard = document.querySelector(`.history-card[data-id="${id}"]`);
      const historyRow = document.querySelector(`tr[data-id="${id}"]`);
      
      let historyData = null;
      let apiDataFetched = false;
      
      // Extract data from DOM first
      if (historyCard || historyRow) {
        // We already have some data in the DOM
        const element = historyCard || historyRow;
        const command = element.getAttribute('data-command');
        
        // Create basic history data from DOM
        historyData = {
          id,
          command,
          // Try to extract data from our DOM elements
          summary: historyCard ? 
            historyCard.querySelector('.history-summary')?.textContent : 
            historyRow.querySelector('.table-summary')?.textContent,
          status: 'completed', // Default status if not available
          date: new Date().toISOString() // Default date if not available
        };
        
        // Try to extract additional data from DOM
        if (historyCard) {
          historyData.status = historyCard.querySelector('.history-status')?.textContent || 'completed';
          historyData.date = historyCard.querySelector('.history-date')?.textContent || new Date().toISOString();
        } else if (historyRow) {
          const statusElement = historyRow.querySelector('.status-badge');
          if (statusElement) {
            historyData.status = statusElement.textContent || 'completed';
          }
          
          const dateElement = historyRow.cells[0];
          if (dateElement) {
            historyData.date = dateElement.textContent || new Date().toISOString();
          }
        }
      }
      
      // Try to get data from API
      try {
        // Fetch complete details from the API
        const details = await getHistoryById(id);
        console.log('Fetched history details:', details);
        historyData = details;
        apiDataFetched = true;
      } catch (error) {
        console.warn('Could not fetch full details from API', error);
        if (!historyData) {
          // No DOM data and API failed, show error
          throw new Error('Could not find or fetch history item details');
        }
        // Otherwise continue with DOM data
      }
      
      // Create a details modal to display the information
      const detailsModal = document.createElement('div');
      detailsModal.className = 'history-details-modal';
      
      // Get the result data - normalize it to handle different formats
      const result = historyData.result || {};
      const meta = historyData.meta || result.meta || {};
      const aiPrepared = result.aiPrepared || {};
      const raw = result.raw || {};
      
      // Extract relevant URLs
      const midsceneReportUrl = meta.midsceneReportUrl || result.midsceneReportUrl || raw.midsceneReportUrl || '';
      const landingReportUrl = meta.landingReportUrl || result.landingReportUrl || raw.landingReportUrl || '';
      const screenshot = meta.screenshot || result.screenshot || raw.screenshot || '';
      
      // Format display data
      const summary = aiPrepared.summary || meta.summary || historyData.summary || 'No summary available';
      const command = historyData.command || 'Unknown command';
      const timestamp = formatDate(historyData.date || historyData.timestamp || historyData.created_at || new Date());
      
      // Generate report links HTML
      const reportLinks = [];
      if (midsceneReportUrl) {
        reportLinks.push(`<a href="${midsceneReportUrl}" class="report-link" target="_blank"><i class="fas fa-file-alt"></i> Midscene Report</a>`);
      }
      if (landingReportUrl) {
        reportLinks.push(`<a href="${landingReportUrl}" class="report-link" target="_blank"><i class="fas fa-file-alt"></i> Landing Report</a>`);
      }
      
      // Create the modal content
      detailsModal.innerHTML = `
        <div class="details-modal-content">
          <div class="details-modal-header">
            <h3>Task Details</h3>
            <button class="close-details-btn"><i class="fas fa-times"></i></button>
          </div>
          <div class="details-modal-body">
            <div class="details-section">
              <div class="command-section">
                <h4>Command</h4>
                <p class="command-text">${command}</p>
                <button class="replay-command-btn" data-command="${command}"><i class="fas fa-play"></i> Replay Command</button>
              </div>
              ${screenshot ? `
                <div class="screenshot-section">
                  <h4>Screenshot</h4>
                  <img src="${screenshot}" alt="Task Screenshot" class="task-screenshot">
                </div>
              ` : ''}
            </div>
            
            <div class="details-section">
              <h4>Summary</h4>
              <div class="summary-content">${summary}</div>
            </div>
            
            ${reportLinks.length > 0 ? `
              <div class="details-section">
                <h4>Reports</h4>
                <div class="report-links">
                  ${reportLinks.join('')}
                </div>
              </div>
            ` : ''}
            
            <div class="details-section">
              <h4>Metadata</h4>
              <div class="metadata">
                <p><strong>Task ID:</strong> ${id}</p>
                <p><strong>Date:</strong> ${timestamp}</p>
                <p><strong>Status:</strong> ${historyData.status || 'Unknown'}</p>
              </div>
            </div>
          </div>
        </div>
      `;
      
      // Add event listeners
      const closeBtn = detailsModal.querySelector('.close-details-btn');
      closeBtn.addEventListener('click', () => {
        detailsModal.classList.remove('visible');
        setTimeout(() => {
          detailsModal.remove();
        }, 300);
      });
      
      // Add replay button handler
      const replayBtn = detailsModal.querySelector('.replay-command-btn');
      if (replayBtn) {
        replayBtn.addEventListener('click', () => {
          const cmd = replayBtn.getAttribute('data-command');
          replayCommand(null, cmd);
          // Close the modal
          detailsModal.classList.remove('visible');
          setTimeout(() => {
            detailsModal.remove();
          }, 300);
        });
      }
      
      // Add to DOM and show
      document.body.appendChild(detailsModal);
      setTimeout(() => {
        detailsModal.classList.add('visible');
      }, 10);
      
    } catch (error) {
      console.error('Error viewing history details:', error);
      alert(`Failed to load task details: ${error.message}`);
    }
  }
  
  // Replay a command
  async function replayCommand(id, commandOverride = null) {
    try {
      let command = commandOverride;
      
      // If no command override was provided, try to get it from the DOM or API
      if (!command && id) {
        // First check if we have it in the DOM
        const element = document.querySelector(`.history-card[data-id="${id}"], tr[data-id="${id}"]`);
        
        if (element) {
          command = element.getAttribute('data-command');
        } else {
          // Fetch from the API
          try {
            const historyItem = await getHistoryById(id);
            command = historyItem.command;
          } catch (error) {
            console.error('Failed to fetch command from API:', error);
            throw new Error('Could not retrieve the original command.');
          }
        }
      }
      
      if (!command) {
        throw new Error('No command found to replay.');
      }
      
      console.log('Replaying command:', command);
      
      // Close the history overlay
      toggle(false);
      
      // Emit an event for the main app to handle
      eventBus.emit('execute-command', { command });
      
    } catch (error) {
      console.error('Error replaying command:', error);
      alert(`Failed to replay command: ${error.message}`);
    }
  }
  
  // Delete a history item
  async function deleteHistoryItem(id) {
    if (confirm('Are you sure you want to delete this history item?')) {
      try {
        // Show loading/processing state on the item
        const cardItem = historyGrid.querySelector(`.history-card[data-id="${id}"]`);
        const listItem = historyTable.querySelector(`tr[data-id="${id}"]`);
        
        if (cardItem) {
          cardItem.style.opacity = '0.5';
          cardItem.style.pointerEvents = 'none';
        }
        
        if (listItem) {
          listItem.style.opacity = '0.5';
          listItem.style.pointerEvents = 'none';
        }
        
        // Call API to delete the item
        const response = await deleteHistory(id);
        
        if (response && response.success) {
          // Remove the item from the UI with animation
          if (cardItem) {
            cardItem.style.height = '0';
            cardItem.style.margin = '0';
            cardItem.style.padding = '0';
            cardItem.style.transition = 'all 0.3s ease';
            setTimeout(() => {
              cardItem.remove();
              // Check if grid is empty
              if (historyGrid.children.length === 0) {
                historyGrid.innerHTML = `
                  <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No history items found</p>
                  </div>
                `;
              }
            }, 300);
          }
          
          if (listItem) {
            listItem.style.height = '0';
            listItem.style.padding = '0';
            listItem.style.transition = 'all 0.3s ease';
            setTimeout(() => {
              listItem.remove();
              // Check if table is empty
              if (historyTable.querySelector('tbody').children.length === 0) {
                historyTable.querySelector('tbody').innerHTML = `
                  <tr>
                    <td colspan="5" class="empty-state">
                      <i class="fas fa-inbox"></i>
                      <p>No history items found</p>
                    </td>
                  </tr>
                `;
              }
            }, 300);
          }
        } else {
          throw new Error(response.error || 'Failed to delete history item');
        }
      } catch (error) {
        console.error('Error deleting history item:', error);
        
        // Show error notification
        const errorToast = document.createElement('div');
        errorToast.className = 'history-toast error';
        errorToast.innerHTML = `
          <i class="fas fa-exclamation-circle"></i>
          <span>Failed to delete: ${error.message || 'Unknown error'}</span>
        `;
        document.body.appendChild(errorToast);
        
        // Show toast and remove after 3 seconds
        setTimeout(() => {
          errorToast.classList.add('show');
          setTimeout(() => {
            errorToast.classList.remove('show');
            setTimeout(() => {
              errorToast.remove();
            }, 300);
          }, 3000);
        }, 100);
        
        // Reset UI state
        loadHistory();
      }
    }
  }
  
  // Format date for display
  function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    
    const date = new Date(timestamp);
    return date.toLocaleString();
  }
  
  // Helper to escape HTML entities
  function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  
  // Get status class for styling
  function getStatusClass(status) {
    if (!status) return 'status-unknown';
    
    switch (status.toLowerCase()) {
      case 'completed':
      case 'success':
        return 'status-success';
      case 'failed':
      case 'error':
        return 'status-error';
      case 'pending':
      case 'in-progress':
        return 'status-pending';
      default:
        return 'status-unknown';
    }
  }
  
  // Update loading state
  function updateLoadingState(isLoading) {
    if (isLoading) {
      // Only update UI for loading state, don't call loadHistory again
      if (currentView === 'card') {
        historyGrid.innerHTML = `
          <div class="loading-container">
            <div class="loading-spinner"></div>
            <p>Loading history...</p>
          </div>
        `;
      } else {
        const tableBody = historyTable.querySelector('tbody');
        tableBody.innerHTML = `
          <tr>
            <td colspan="5" class="loading-state">
              <div class="loading-spinner"></div>
              <p>Loading history...</p>
            </td>
          </tr>
        `;
      }
    }
    // Don't call loadHistory here - that would create an infinite loop
  }
  
  // Update pagination controls
  function updatePaginationControls() {
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
  }
  
  // Listen for toggle-history-overlay events
  eventBus.on('toggle-history-overlay', () => {
    toggle();
  });
  
  /**
   * Toggle overlay visibility
   * @param {boolean} show - Whether to show or hide the overlay
   */
  function toggle(show = true) {
    if (show) {
      // Reset any custom styles that might override the CSS
      overlay.style = '';
      overlay.className = 'history-overlay';
      
      // Update display using classes only (no inline styles)
      setTimeout(() => {
        overlay.classList.add('visible');
        loadHistory();
        // Focus on search input
        searchInput.focus();
      }, 10);
    } else {
      overlay.classList.remove('visible');
      // No inline styles for hiding
    }
  }
  
  // Initialize data loading
  loadHistory();
  
  // Add API  // Public methods
  overlay.show = () => toggle(true);
  overlay.hide = () => toggle(false);
  overlay.toggle = () => toggle();
  
  // Apply proper styling classes from history-overlay.css
  // Make sure we're not adding any inline styles that would override the CSS
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.add('futuristic-btn');
  });
  
  // Make sure all select elements have the right styling
  document.querySelectorAll('.filter-select').forEach(select => {
    select.classList.add('custom-select');
  });

  return overlay;
}

export default {
  getHistoryOverlay
};
