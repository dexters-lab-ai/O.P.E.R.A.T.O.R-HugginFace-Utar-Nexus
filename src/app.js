// app.js

// Global state
let taskResults = [];
let activeTasks = [];
let scheduledTasks = [];
let repetitiveTasks = [];

// WebSocket setup
let ws = null;
let reconnectAttempts = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// Function to initialize WebSocket connection
function initWebSocket(userId) {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${window.location.host}/ws?userId=${encodeURIComponent(userId)}`;
  ws = new WebSocket(wsUrl);
  ws.addEventListener('open', () => {
    console.log('WebSocket connected at', new Date().toISOString());
    reconnectAttempts = 0;
  });

  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);
  
      switch (data.event) {
        case 'taskStart':
          handleTaskStart(data.taskId, data.prompt, data.url);
          break;
        case 'stepProgress':
          updateStepProgress(data.taskId, data.stepIndex, data.progress, data.message, data.log);
          break;
        case 'taskUpdate':
          updateTaskProgress(data.taskId, data.progress, data.status, data.error, data.milestone, data.subTask);
          break;
        case 'intermediateResult':
          console.log('[WebSocket] Intermediate result received:', data);
          handleIntermediateResult(data.taskId, data.result, data.subTask, data.streaming);
          break;
        case 'taskComplete':
          // If taskId exists, then this is a task update.
          if (data.taskId) {
            handleTaskCompletion(data.taskId, data.status, data.result || {});
          } else if (data.assistantReply) {
            // Otherwise, if an assistantReply is provided, treat it as a chat message.
            const timelineContainer = document.getElementById('message-timeline');
            // Optionally, use a function to render assistant messages in the timeline if needed.
          } else {
            console.warn('Received taskComplete event with insufficient data:', data);
          }
          break;
        case 'thoughtUpdate':
          appendThought(data.taskId, data.thought);
          break;
        case 'thoughtComplete':
          finalizeThought(data.taskId, data.thought);
          break;
        case 'functionCallPartial':
          updateFunctionCallPartial(data.taskId, data.partialArgs);
          break;
        case 'taskError':
          handleTaskError(data.taskId, data.error);
          break;
        default:
          console.warn('Unhandled WebSocket event:', data.event);
      }
    } catch (e) {
      console.error('Error processing WebSocket message:', e);
    }
  });  

  ws.addEventListener('close', () => {
    console.log('[WebSocket] Disconnected');
    // Allow reconnection only if this connection is really closed.
    ws = null;
    if (reconnectAttempts < MAX_RETRIES) {
      reconnectAttempts++;
      console.log(`[WebSocket] Reconnecting... Attempt ${reconnectAttempts}/${MAX_RETRIES}`);
      setTimeout(() => initWebSocket(userId), RETRY_DELAY * Math.pow(2, reconnectAttempts));
    } else {
      showNotification('Failed to reconnect to WebSocket.', 'error');
    }
  });

  ws.addEventListener('error', (error) => {
    console.error('WebSocket error:', error);
  });
}
// Initialize WebSocket connection on app load
const userId = localStorage.getItem('userId'); // Replace with your method of getting userId
initWebSocket(userId);

/**************************** Utility Functions ****************************/
function updateFunctionCallPartial(taskId, partialArgs) {
  let partialElement = document.getElementById(`functionCall-${taskId}`);
  if (!partialElement) {
    partialElement = document.createElement('div');
    partialElement.id = `functionCall-${taskId}`;
    partialElement.className = 'function-call-partial';
    document.getElementById('').prepend(partialElement);
  }
  partialElement.textContent = partialArgs;
}

function handleTaskError(taskId, error) {
  console.log(`Task ${taskId} errored: ${error}`);
  const convertedHtml = marked.parse(error);
  const nliResults = document.getElementById('');
  const errorMessage = document.createElement('div');
  errorMessage.className = 'chat-message ai-message animate-in';
  errorMessage.innerHTML = `
    <div class="message-content">
      <p class="summary-text error">Error: ${convertedHtml}</p>
      <span class="timestamp">${new Date().toLocaleTimeString()}</span>
    </div>
  `;
  nliResults.prepend(errorMessage);
  nliResults.scrollTop = 0;
  updateTaskProgress(taskId, 0, 'error', error);
  loadActiveTasks(); // Refresh active tasks list immediately.
}

function initializeResultCard(taskId, command) {
  const outputContainer = document.getElementById('output-container');
  if (document.getElementById('no-results')) document.getElementById('no-results').remove();

  let resultCard = document.querySelector(`.result-card[data-task-id="${taskId}"]`);
  if (!resultCard) {
    resultCard = document.createElement('div');
    resultCard.className = 'result-card animate-in';
    resultCard.dataset.taskId = taskId;
    const timestamp = new Date();
    const formattedTime = timestamp.toLocaleTimeString();

    resultCard.innerHTML = `
      <div class="result-header">
        <h4><i class="fas fa-globe"></i> Processing...</h4>
        <p><strong>Command:</strong> ${command || 'Unknown'}</p>
        <div class="meta">
          <span>${formattedTime}</span>
        </div>
      </div>
      <div class="result-content">
        <div class="intermediate-results"></div>
        <div class="outputs"></div>
        <div class="screenshots"></div>
      </div>
    `;
    outputContainer.prepend(resultCard);
    outputContainer.style.display = 'block';
  }
  return resultCard;
}

function handleTaskStart(taskId, prompt, url) {
  // Ensure the task appears in the active tasks list
  loadActiveTasks();
  initializeResultCard(taskId, prompt); // Optional: Show in results area
}

function updateStepProgress(taskId, stepIndex, progress, message, log) {
  const taskElement = document.querySelector(`.active-task[data-task-id="${taskId}"]`);
  if (taskElement) {
    const progressBar = taskElement.querySelector('.task-progress');
    if (progressBar) progressBar.style.width = `${progress}%`;

    let logContainer = taskElement.querySelector('.task-log');
    if (!logContainer) {
      logContainer = document.createElement('div');
      logContainer.className = 'task-log';
      taskElement.prepend(logContainer);
    }

    const logEntries = Array.isArray(log) ? log : [log];
    logEntries.forEach(entry => {
      // Trim or default
      const rawMsg = entry.message || message || '';
      let shortMsg = rawMsg;
      if (shortMsg.length > 150) {
        shortMsg = shortMsg.substring(0, 150) + '...';
      }
      
      const timeStr = entry.timestamp || new Date().toLocaleTimeString();
      const logEntry = document.createElement('p');
      logEntry.style.fontSize = '0.9em';
      logEntry.style.color = '#ccc';
      logEntry.textContent = `[${timeStr}] ${shortMsg}`;
      
      logContainer.prepend(logEntry);
    });

    // Keep the log container scrolled if you want the newest to appear at the top.
    taskElement.scrollTop = taskElement.scrollHeight;
  }
}

console.log('Script loaded'); // Confirm script runs

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
};

/**
 * Helper function to simulate a typing effect.
 * Appends the provided text to the element letter by letter.
 * @param {HTMLElement} element - The element whose text content will be updated.
 * @param {string} text - The text to type.
 * @param {number} delay - The delay (in milliseconds) between characters.
 * @returns {Promise} - Resolves once the text has been fully typed.
 */
function simulateTypingEffect(element, text, delay = 50) {
  return new Promise(resolve => {
    let index = 0;
    // If there's already text in the element, preserve it.
    const baseText = element.textContent || '';
    const intervalId = setInterval(() => {
      if (index < text.length) {
        element.textContent = baseText + text.slice(0, index + 1);
        index++;
      } else {
        clearInterval(intervalId);
        // Optionally remove the blinking-cursor CSS class
        element.classList.remove('typing');
        resolve();
      }
    }, delay);
  });
}

/**
 * Updates (or creates) a thought bubble for the given task.
 * This function is called on each "thoughtUpdate" event.
 * It uses simulateTypingEffect to append the new chunk with a typing animation.
 * @param {string} taskId - The ID of the task.
 * @param {string} newChunk - The new text chunk received.
 */
function updateThoughtBubble(taskId, newChunk) {
  // Look for an existing element by id; if not present, create it.
  let thoughtElement = document.getElementById(`thought-${taskId}`);
  
  if (!thoughtElement) {
    thoughtElement = document.createElement('div');
    thoughtElement.id = `thought-${taskId}`;
    thoughtElement.className = 'chat-message ai-message thought-bubble typing';
    thoughtElement.innerHTML = `
      <div class="message-content">
        <p class="thought-text"></p>
        <span class="timestamp">${new Date().toLocaleTimeString()}</span>
      </div>
    `;
    document.getElementById('').prepend(thoughtElement);
  }
  
  // Append the new text chunk with a typing effect.
  const textElement = thoughtElement.querySelector('.thought-text');
  simulateTypingEffect(textElement, newChunk).catch(err => console.error(err));
}

/**
 * Appends a thought update (animated) for the given task.
 * This function is called from your WebSocket "thoughtUpdate" handler.
 * @param {string} taskId - The ID of the task.
 * @param {string} thoughtChunk - The text chunk to add.
 */
function appendThought(taskId, thoughtChunk) {
  updateThoughtBubble(taskId, thoughtChunk);
}

/**
 * Finalizes the thought bubble.
 * This should be called when all thought updates are complete.
 * It optionally appends a final marker.
 * @param {string} taskId - The ID of the task.
 * @param {string} finalThought - The final thought text to append.
 */
function finalizeThought(taskId, finalThought) {
  const thoughtElement = document.getElementById(`thought-${taskId}`);
  if (thoughtElement) {
    const textElement = thoughtElement.querySelector('.thought-text');
    // Immediately append the final thought without animation.
    textElement.textContent += "\n\n[Final]: " + finalThought;
    // Remove the typing effect class (which may include a blinking cursor)
    thoughtElement.classList.remove('typing');
  }
}

/**************************** Initialization ****************************/
function startSplashAnimation() {
  return new Promise((resolve) => {
    const loadingProgress = document.getElementById('loading-progress');
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      loadingProgress.style.width = `${progress}%`;
      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(() => resolve(), 500);
      }
    }, 100);
  });
}

function hideSplashScreen() {
  return new Promise((resolve) => {
    const splashScreen = document.getElementById('splash-screen');
    splashScreen.style.opacity = '0';
    setTimeout(() => {
      splashScreen.style.display = 'none';
      if (!localStorage.getItem('operatorIntroShown')) {
        document.getElementById('intro-overlay').style.display = 'flex';
      }
      resolve();
    }, 500);
  });
}

// Unified Timeline Filter State
let timelineFilter = 'all'; // 'all', 'chat', 'command'

// Render filter buttons above the timeline
function renderTimelineFilters() {
  let filtersDiv = document.getElementById('timeline-filters');
  const timelineContainer = document.getElementById('message-timeline');
  if (!filtersDiv && timelineContainer) {
    filtersDiv = document.createElement('div');
    filtersDiv.className = 'timeline-filters';
    filtersDiv.id = 'timeline-filters';
    timelineContainer.parentNode.insertBefore(filtersDiv, timelineContainer);
  }
  if (filtersDiv) {
    filtersDiv.innerHTML = `
      <button class="timeline-filter-btn${timelineFilter==='all' ? ' active' : ''}" data-filter="all">All</button>
      <button class="timeline-filter-btn${timelineFilter==='chat' ? ' active' : ''}" data-filter="chat">Chat</button>
      <button class="timeline-filter-btn${timelineFilter==='command' ? ' active' : ''}" data-filter="command">Command</button>
    `;
    filtersDiv.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        timelineFilter = btn.getAttribute('data-filter');
        loadUnifiedMessageTimeline();
      };
    });
  }
}

// Escape HTML to prevent XSS
function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag]));
}

// Main unified timeline loader
async function loadUnifiedMessageTimeline(page = 1, limit = 50) {
  try {
    const res = await fetch(`/messages/history?page=${page}&limit=${limit}`, {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      const text = await res.text();
      console.error('Failed to fetch message history:', text);
      showNotification('Failed to load message history', 'error');
      return;
    }
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      console.error('Expected JSON for message history, got:', text);
      showNotification('Unexpected server response when loading message history.', 'error');
      return;
    }
    const data = await res.json();
    if (!data.success) {
      showNotification('Failed to load message history', 'error');
      return;
    }
    renderTimelineFilters();
    const timelineContainer = document.getElementById('message-timeline');
    if (!timelineContainer) return;
    timelineContainer.innerHTML = '';
    let filtered = data.items;
    if (timelineFilter !== 'all') {
      filtered = filtered.filter(msg => msg.type === timelineFilter);
    }
    filtered.forEach(msg => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `msg-item msg-${msg.role} msg-${msg.type}`;
      msgDiv.innerHTML = `
        <div class="msg-meta">
          <span class="msg-role">${msg.role === 'user' ? '🧑' : '🤖'}</span>
          <span class="msg-type">${msg.type}</span>
          <span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="msg-content">${escapeHTML(msg.content)}</div>
        ${msg.type === 'command' && msg.meta && msg.meta.error ? `<div class="msg-error">Error: ${escapeHTML(msg.meta.error)}</div>` : ''}
      `;
      timelineContainer.appendChild(msgDiv);
    });
    // Auto-scroll to bottom
    timelineContainer.scrollTop = timelineContainer.scrollHeight;
  } catch (err) {
    console.error('Error loading message history:', err);
    showNotification('Error loading message history.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOMContentLoaded fired');
  // Start splash animation
  const splashPromise = startSplashAnimation();
  try {
    // Load essential data
    await loadUnifiedMessageTimeline();
    await loadActiveTasks();
    await loadHistory();
  } catch (error) {
    console.error('Error during initial load:', error);
    showNotification('Error initializing application. Some data may be missing.', 'error');
  } finally {
    // Ensure splash screen always hides
    await splashPromise;
    await hideSplashScreen();
  }
});

window.addEventListener('beforeunload', () => {
  // cleanup();
});

function saveChatMessage(role, content) {
  const savedMessages = JSON.parse(localStorage.getItem('chatHistory') || '[]');
  savedMessages.push({ role, content, timestamp: new Date() });
  localStorage.setItem('chatHistory', JSON.stringify(savedMessages));
}

// =====================================
// NLI & CHAT: Single Submit Handler (No Streaming Approach)
// =====================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('Unified DOMContentLoaded fired');
  logger.info('DOM content loaded, chat history initialized');

  // Use the unified input form
  const unifiedForm = document.getElementById('unified-input-form');
  if (!unifiedForm) {
    logger.error('Unified input form (id="unified-input-form") not found in DOM');
    showNotification('Command input form not found. Please refresh or contact support.', 'error');
    return;
  }

  // Find the input or textarea inside the unified form
  const promptInput = unifiedForm.querySelector('input[type="text"], textarea');
  if (!promptInput) {
    logger.error('Prompt input not found in unified input form');
    showNotification('Prompt input not found. Please refresh or contact support.', 'error');
    return;
  }

  unifiedForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = promptInput.value.trim();
    logger.info('Form submitted at', new Date().toISOString(), 'Prompt:', prompt);

    if (!prompt) {
      showNotification('Please enter a command', 'error');
      logger.warn('Empty prompt submitted');
      return;
    }

    const submitButton = unifiedForm.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    showNotification('Executing command...', 'success');
    document.dispatchEvent(new CustomEvent('taskStateChange', { detail: { running: true } }));

    const nliResults = document.getElementById('message-timeline');
    try {
      console.log('Sending fetch request');
      const response = await fetch('/nli', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'include',
        body: JSON.stringify({ prompt })
      });

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) {
        // could be a 302→login.html or a 401 JSON
        console.error('Auth failure or network error:', await response.text());
        return []; // or handle logout
      }
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        logger.error('Expected JSON but got:', text);
        showNotification('Unexpected server response. Please try again.', 'error');
        return;
      }
      await handleTaskResponse(response, nliResults, prompt);
    } catch (err) {
      console.error('Caught error:', err.message);
      logger.error('Error processing NLI request:', err.message);
      handleError(nliResults, prompt, err);
    } finally {
      if (submitButton) submitButton.disabled = false;
      document.dispatchEvent(new CustomEvent('taskStateChange', { detail: { running: false } }));
      logger.info('Form submission completed');
    }
  });
});

// Helper Functions

function appendChatMessage(container, role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}-message animate-in`;
  messageDiv.innerHTML = `
    <div class="message-content">
      <p class="summary-text${role === 'assistant' && content.startsWith('Error:') ? ' error' : ''}">${content}</p>
      <span class="timestamp">${new Date().toLocaleTimeString()}</span>
    </div>
  `;
  container.prepend(messageDiv);
  container.scrollTop = 0;
}

async function handleTaskResponse(response, nliResults, prompt) {
  console.log('Handling task response');
  try {
    const data = await response.json();
    logger.info('JSON response received:', data);

    if (!data.success) throw new Error(data.error || 'Task execution failed');

    if (!data.taskId) {
      // Chat branch (non-task)
      const summary =
        data.assistantReply ||
        (data.result && data.result.aiPrepared ? data.result.aiPrepared.summary : 'No summary available');
      appendChatMessage(nliResults, 'assistant', summary);
      saveChatMessage('assistant', summary);
      addToHistory('N/A', prompt, {
        taskId: `chat-${Date.now()}`,
        command: prompt,
        url: 'N/A',
        output: summary,
        aiOutput: summary,
        timestamp: new Date(),
        status: 'completed',
        result: {} // Ensure result exists
      });
      return;
    } else {
      // Task branch (non-streaming)
      const taskId = data.taskId;
      await loadActiveTasks();
      const resultCard = initializeResultCard(taskId, prompt);
      const summary =
        data.result && data.result.aiPrepared
          ? data.result.aiPrepared.summary
          : (data.error || 'No summary available');
      appendChatMessage(nliResults, 'assistant', summary);
      saveChatMessage('assistant', summary);
      updateResultCard(resultCard, data.result, data.status, summary);
      addToHistory(
        data.result && data.result.raw && data.result.raw.url ? data.result.raw.url : 'N/A',
        prompt,
        {
          taskId,
          command: prompt,
          url: data.result && data.result.raw && data.result.raw.url ? data.result.raw.url : 'N/A',
          output:
            data.result && data.result.raw && data.result.raw.pageText
              ? data.result.raw.pageText
              : 'No raw output',
          aiOutput: summary,
          timestamp: new Date(),
          screenshot: data.result ? data.result.screenshotPath : undefined,
          report: data.result ? data.result.runReport : undefined,
          status: data.status === 'error' ? 'error' : 'completed',
          result: data.result || {}
        }
      );
      loadActiveTasks();
      loadHistory();
    }
  } catch (jsonErr) {
    console.log('Not JSON, treating as text');
    const text = await response.text();
    logger.info('Text response received:', text);
    appendChatMessage(nliResults, 'assistant', text || 'Received non-JSON response');
    saveChatMessage('assistant', text || 'Received non-JSON response');
    addToHistory('N/A', prompt, {
      taskId: `chat-${Date.now()}`,
      command: prompt,
      url: 'N/A',
      output: text,
      aiOutput: text,
      timestamp: new Date(),
      status: 'completed',
      result: {}
    });
  }
}

function updateSubTasks(taskId, subTasks) {
  const taskElement = document.querySelector(`.active-task[data-task-id="${taskId}"]`);
  if (!taskElement) return;
  subTasks.forEach((subTask, index) => {
    const progressBar = taskElement.querySelector(`.subtask-progress-bar-${index}`);
    if (progressBar) progressBar.style.width = `${subTask.progress || 0}%`;
    const statusSpan = taskElement.querySelector(`.subtask-status-${index}`);
    if (statusSpan) {
      statusSpan.textContent = subTask.status;
      statusSpan.className = `subtask-status ${subTask.status.toLowerCase()}`;
    }
  });
}

function updateResultCard(resultCard, result, status, summary) {
  // Ensure result is at least an empty object
  result = result || {};
  let rawUrl = 'N/A';
  let aiPreparedSummary = 'No AI summary';
  let rawPageText = 'No raw output';
  let runReportHtml = '';
  let screenshotPath = '';

  if (typeof result === "object") {
    if (result.raw && typeof result.raw === "object" && result.raw.url) {
      rawUrl = result.raw.url;
    }
    if (result.aiPrepared && typeof result.aiPrepared === "object" && result.aiPrepared.summary) {
      aiPreparedSummary = result.aiPrepared.summary;
    }
    if (result.raw && typeof result.raw === "object" && result.raw.pageText) {
      rawPageText = result.raw.pageText;
    }
    if (result.runReport) {
      runReportHtml = `<a href="${result.runReport}" target="_blank" class="btn btn-primary btn-sm mt-2">View Report</a>`;
    }
    if (result.screenshotPath) {
      screenshotPath = result.screenshotPath;
    }
  }

  resultCard.querySelector('.result-header h4').innerHTML = `<i class="fas fa-globe"></i> ${rawUrl}`;
  const outputsDiv = resultCard.querySelector('.outputs');
  outputsDiv.innerHTML = `
    <div class="toggle-buttons">
      <button class="toggle-btn active" data-view="ai">AI Prepared</button>
      <button class="toggle-btn" data-view="raw">Raw Output</button>
    </div>
    <div class="ai-output active">${aiPreparedSummary}</div>
    <div class="raw-output">${rawPageText}</div>
    ${runReportHtml}
  `;
  if (screenshotPath) {
    const img = document.createElement('img');
    img.src = screenshotPath;
    img.alt = 'Final Screenshot';
    img.style.cssText = 'max-width: 100%; margin-top: 10px; display: block;';
    const screenshotsDiv = resultCard.querySelector('.screenshots');
    if (screenshotsDiv) {
      screenshotsDiv.prepend(img);
    }
  }
  setupToggleButtons(resultCard);
}

function setupToggleButtons(resultCard) {
  const toggleButtons = resultCard.querySelectorAll('.toggle-btn');
  const aiOutput = resultCard.querySelector('.ai-output');
  const rawOutput = resultCard.querySelector('.raw-output');
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleButtons.forEach(b => b.classList.remove('active'));
      aiOutput.classList.remove('active');
      rawOutput.classList.remove('active');
      btn.classList.add('active');
      if (btn.dataset.view === 'ai') aiOutput.classList.add('active');
      else rawOutput.classList.add('active');
    });
  });
}

function handleError(nliResults, prompt, err, taskId, resultCard) {
  showNotification(err.message, 'error');
  appendChatMessage(nliResults, 'assistant', `Error: ${err.message}`);
  saveChatMessage('assistant', `Error: ${err.message}`);
  const chatResult = {
    taskId: taskId || `error-${Date.now()}`,
    command: prompt,
    url: 'N/A',
    output: err.message,
    aiOutput: `Error: ${err.message}`,
    timestamp: new Date(),
    status: 'error',
  };
  addToHistory('N/A', prompt, chatResult);
  if (taskId && resultCard) {
    resultCard.querySelector('.result-header h4').innerHTML = `<i class="fas fa-globe"></i> Error`;
    resultCard.querySelector('.outputs').innerHTML = `<div class="error">${err.message}</div>`;
  }
}

// ===============================================
// Clear Task Results
document.getElementById('clear-results').addEventListener('click', clearTaskResults);

// Update clearTaskResults to reset animation state
function clearTaskResults() {
  taskResults = [];
  const outputContainer = document.getElementById('output-container');
  const aiResults = document.getElementById('ai-results');
  const rawResults = document.getElementById('raw-results');
  if (aiResults) aiResults.innerHTML = '';
  if (rawResults) rawResults.innerHTML = '';
  if (outputContainer) {
    outputContainer.innerHTML = '<p id="no-results" class="text-muted">No results yet. Run a task to see output here.</p>';
    outputContainer.style.display = 'block';
  }

  showNotification('Task results cleared!', 'success');
}

document.addEventListener('DOMContentLoaded', () => {
  // Manual Task – load via URL parameters if available
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('url') && urlParams.get('command')) {
    document.getElementById('manual-url').value = decodeURIComponent(urlParams.get('url'));
    document.getElementById('manual-command').value = decodeURIComponent(urlParams.get('command'));
    toggleTaskTab('manual');
  }
  
  // Mode Toggle
  document.getElementById('mode-toggle').onclick = () => {
    document.body.classList.toggle('light-mode');
  };
  
  // Intro Overlay Controls
  document.getElementById('close-intro').addEventListener('click', () => {
    document.getElementById('intro-overlay').style.display = 'none';
    localStorage.setItem('operatorIntroShown', 'true');
  });
  document.getElementById('show-intro-later').addEventListener('click', () => {
    document.getElementById('intro-overlay').style.display = 'none';
  });
  document.getElementById('start-using').addEventListener('click', () => {
    document.getElementById('intro-overlay').style.display = 'none';
    localStorage.setItem('operatorIntroShown', 'true');
  });
  document.getElementById('guide-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('intro-overlay').style.display = 'flex';
  });
  
  // Tab Switching for Task Types
  const taskTypeTabs = document.getElementById('task-type-tabs');
  taskTypeTabs.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) {
      document.querySelectorAll('#task-type-tabs .tab-btn').forEach(tab => tab.classList.remove('active'));
      e.target.classList.add('active');
      toggleTaskTab(e.target.dataset.taskType);
    }
  });
  
  // Active Tasks Subtabs
  const activeSubtabs = document.querySelectorAll('.active-tasks-subtabs .tab-btn');
  activeSubtabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activeSubtabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`${tab.dataset.subtab}-tasks-content`).classList.add('active');
    });
  });
  
  // Sonic Operations
  const sonicOperations = document.getElementById('sonic-operations');
  if (sonicOperations) {
    sonicOperations.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-btn')) {
        document.querySelectorAll('#sonic-operations .tab-btn').forEach(tab => tab.classList.remove('active'));
        e.target.classList.add('active');
        const operation = e.target.dataset.sonicOperation;
        const bridgeForm = document.getElementById('bridge-form');
        const stakeForm = document.getElementById('stake-form');
        if (bridgeForm && stakeForm) {
          if (operation === 'bridge') {
            bridgeForm.style.display = 'block';
            stakeForm.style.display = 'none';
          } else {
            bridgeForm.style.display = 'none';
            stakeForm.style.display = 'block';
          }
        }
      }
    });
    const bridgeForm = document.getElementById('bridge-form');
    const stakeForm = document.getElementById('stake-form');
    // Bridge form needs update
    bridgeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('bridge-url').value.trim();
      const command = document.getElementById('bridge-command').value.trim();
      if (!command) { 
        showNotification('Please enter bridge operation details', 'error'); 
        return; 
      }
      executeTaskWithAnimation(url, command, 'sonic-bridge');
    });

    // Stake form needs update
    stakeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('stake-url').value.trim();
      const command = document.getElementById('stake-command').value.trim();
      if (!command) { 
        showNotification('Please enter staking details', 'error'); 
        return; 
      }
      executeTaskWithAnimation(url, command, 'sonic-stake');
    });

    const bridgeBtn = document.getElementById('bridge-btn');
    const stakeBtn = document.getElementById('stake-btn');
    if (bridgeBtn) {
      bridgeBtn.addEventListener('click', () => {
        const url = document.getElementById('sonic-url').value.trim();
        const command = document.getElementById('sonic-command').value.trim();
        if (!url || !command) { showNotification('Please enter both URL and command', 'error'); return; }
        executeTaskWithAnimation(url, command, 'sonic-bridge');
      });
    }
    if (stakeBtn) {
      stakeBtn.addEventListener('click', () => {
        const url = document.getElementById('sonic-url').value.trim();
        const command = document.getElementById('sonic-command').value.trim();
        if (!url || !command) { showNotification('Please enter both URL and command', 'error'); return; }
        executeTaskWithAnimation(url, command, 'sonic-stake');
      });
    }
  }
  
  // Repetitive Task Form
  const repetitiveTaskForm = document.getElementById('repetitive-task-form');
  if (repetitiveTaskForm) {
    repetitiveTaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('repetitive-url').value.trim();
      const command = document.getElementById('repetitive-command').value.trim();
      const interval = parseInt(document.getElementById('repetitive-interval').value);
      if (!url || !command || !interval) { showNotification('Please fill in all fields for the repetitive task', 'error'); return; }
      if (interval < 1) { showNotification('Interval must be at least 1 second', 'error'); return; }
      const task = { id: Date.now(), url, command, interval };
      task.intervalId = setInterval(() => executeTaskWithAnimation(url, command, 'repetitive'), interval * 1000);
      addRepetitiveTask(task);
      showNotification('Repetitive task saved and started!', 'success');
    });
    // Run button needs update
    document.getElementById('run-repetitive-task').addEventListener('click', async () => {
      const url = document.getElementById('repetitive-url').value.trim();
      const command = document.getElementById('repetitive-command').value.trim();
      if (!url || !command) { 
        showNotification('Please enter both URL and command', 'error'); 
        return; 
      }
      executeTaskWithAnimation(url, command, 'repetitive');
    });

    updateRepetitiveTasks();
  }
  
  // Scheduled Task Form
  const scheduleTaskForm = document.getElementById('schedule-task-form');
  if (scheduleTaskForm) {
    scheduleTaskForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('schedule-url').value.trim();
      const command = document.getElementById('scheduled-command').value.trim();
      const scheduledTime = document.getElementById('scheduled-time').value;
      if (!url || !command || !scheduledTime) { 
        showNotification('Please fill in all scheduled task fields', 'error'); 
        return; 
      }
      const time = new Date(scheduledTime);
      if (isNaN(time) || time <= new Date()) { 
        showNotification('Please enter a valid future date and time', 'error'); 
        return; 
      }
      const task = { id: Date.now(), url, command, scheduledTime: time.toISOString() };
      scheduleTask(task);
      showNotification(`Task scheduled for ${time.toLocaleString()}`, 'success');
    });

    updateScheduledTasksList();
    checkScheduledTasks();
  }

  // Unified Input Handler
  const unifiedForm = document.getElementById('unified-input-form');
  if (unifiedForm) {
    unifiedForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('unified-input');
      const prompt = input.value.trim();
      if (!prompt) return;
      input.value = '';
      // Optionally show a spinner or disable input here
      try {
        const response = await fetch('/nli', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        const data = await response.json();
        if (data.success) {
          // No need to append manually, timeline will reload
          await loadUnifiedMessageTimeline();
        } else {
          showNotification(data.error || 'Unknown error', 'error');
        }
      } catch (err) {
        showNotification(err.message, 'error');
      }
    });
  }
});

/******************** Helper: Toggle Task Tab ********************/
function toggleTaskTab(taskType) {
  document.querySelectorAll('.task-section').forEach(section => section.classList.remove('active'));
  if (taskType === 'manual') { document.getElementById('manual-section').classList.add('active'); }
  else if (taskType === 'active-tasks') { document.getElementById('active-tasks-section').classList.add('active'); }
  else if (taskType === 'repetitive') { document.getElementById('repetitive-section').classList.add('active'); }
  else if (taskType === 'scheduled') { document.getElementById('scheduled-section').classList.add('active'); }
}

/******************** Task Execution Functions ********************/
async function executeTaskWithAnimation(url, command, taskType) {
  try {
    showNotification("Task started – please wait...", "success");
    
    // Dispatch Events
    document.dispatchEvent(new CustomEvent('taskStateChange', { detail: { running: true } }));
    
    const result = await executeTask(url, command);
    result.taskType = taskType;

    // Initialize resultCard as soon as taskId is available
    initializeResultCard(result.taskId, command);

    await handleTaskResult(result.taskId, result);
    showNotification("Task completed successfully!", "success");
  } catch (error) {
    console.error("Error executing task:", error);
    const errorResult = {
      taskId: Date.now().toString(), // Temporary ID if not provided
      command,
      url,
      output: error.message,
      aiOutput: 'Task failed',
      timestamp: new Date(),
      status: 'error'
    };
    
    // Reset states
    // Dispatch Events
    document.dispatchEvent(new CustomEvent('taskStateChange', { detail: { running: false } }));
    
    await handleTaskResult(errorResult.taskId, errorResult);
    showNotification(`Task execution failed: ${error.message}`, "error");
  }
}

// Enhanced task execution
async function executeTask(url, command) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch('/automate', {
        method: 'POST',
        credentials: 'include', headers: { 'Content-Type': 'application/json','X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ url, command })
      });

      if (!res.ok) {
        // could be a 302→login.html or a 401 JSON
        console.error('Auth failure or network error:', await res.text());
        return []; // or handle logout
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Task execution failed');
      
      const taskId = data.taskId;
      // Initialize the result card immediately.
      initializeResultCard(taskId, command);

      // Establish SSE connection to receive task stream updates.
      const eventSource = new EventSource(`/tasks/${taskId}/stream`);

      eventSource.onmessage = async (event) => {
        const update = JSON.parse(event.data);
        if (update.progress !== undefined) {
          updateTaskProgress(taskId, update.progress, update.status, update.error);
        }
        if (update.done) {
          eventSource.close();
          await loadActiveTasks(); // Refresh active tasks UI.
          if (update.status === 'error') {
            reject(new Error(update.error || 'Task failed'));
            return;
          }
          // Attempt to fetch the final result from history.
          const historyItem = await fetchHistoryItem(taskId);
          if (!historyItem) {
            reject(new Error("Task result not found in history"));
            return;
          }
          const result = {
            taskId: historyItem._id,
            command,
            url,
            output: typeof historyItem.result === 'object' 
              ? JSON.stringify(historyItem.result.raw || historyItem.result, null, 2)
              : historyItem.result,
            aiOutput: historyItem.result.aiPrepared?.summary || 'No AI summary available',
            timestamp: historyItem.timestamp,
            screenshot: historyItem.result.raw?.screenshotPath,
            report: historyItem.result.runReport,
            status: update.status
          };
          const handled = await handleTaskResult(taskId, result);
          if (!handled) {
            reject(new Error("Failed to handle task result"));
            return;
          }
          resolve(result);
        }
      };

      eventSource.onerror = (err) => {
        eventSource.close();
        reject(new Error("Error streaming task updates"));
      };
    } catch (err) {
      reject(err);
    }
  });
}


// Helper to fetch history item
async function fetchHistoryItem(taskId) {
  try {
    const res = await fetch(`/history/${taskId}`, { credentials: 'include', headers: { 'Content-Type': 'application/json','X-Requested-With': 'XMLHttpRequest' }, });
    if (!res.ok) {
      // could be a 302→login.html or a 401 JSON
      console.error('Auth failure or network error:', await res.text());
      return []; // or handle logout
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('Error fetching history item:', err);
    return null;
  }
}

// Helper to handle task result
async function handleTaskResult(taskId, result) {
  try {
    // Add to results section
    addTaskResult(result);
    
    // Add to history
    addToHistory(result.url, result.command, result);
    
    // Update active tasks
    await loadActiveTasks();
    
    // Update UI state
    // Dispatch Events
    document.dispatchEvent(new CustomEvent('taskStateChange', { detail: { running: false } }));
    
    return true;
  } catch (err) {
    console.error('Error handling task result:', err);
    return false;
  }
}

// Helper to update task progress in UI
function updateTaskProgress(taskId, progress, status, error, milestone, subTask) {
  const taskElement = document.querySelector(`.active-task[data-task-id="${taskId}"]`);
  if (taskElement) {
    const progressBar = taskElement.querySelector('.task-progress');
    if (progressBar) progressBar.style.width = `${progress}%`;
    const statusSpan = taskElement.querySelector('.task-status');
    if (statusSpan) {
      statusSpan.textContent = status;
      statusSpan.className = `task-status ${status.toLowerCase()}`;
    }
    if (error) taskElement.innerHTML += `<div class="task-error text-red-500">${error}</div>`;
    if (milestone) {
      const milestoneDisplay = taskElement.querySelector('.task-milestone') || document.createElement('div');
      milestoneDisplay.className = 'task-milestone';
      milestoneDisplay.textContent = milestone;
      if (!taskElement.querySelector('.task-milestone')) taskElement.prepend(milestoneDisplay);
    }

    if (status === 'completed' || status === 'error') {
      loadActiveTasks();
      loadHistory();
    }
  }

  // Display subtask updates in chatbox
  if (subTask && milestone) {    
    const convertedHtml = marked.parse(milestone);
    const nliResults = document.getElementById('');
    const subTaskMessage = document.createElement('div');
    subTaskMessage.className = 'chat-message subtask-message animate-in';
    subTaskMessage.innerHTML = `
      <div class="message-content">
        <p class="summary-text">${convertedHtml}</p>
        <span class="timestamp">${new Date().toLocaleTimeString()}</span>
      </div>
    `;
    nliResults.prepend(subTaskMessage);
    nliResults.scrollTop = 0;
  }
}

function truncateText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

function handleIntermediateResult(taskId, result, subTask, streaming) {
  console.log(`Intermediate result received for task ${taskId}:`, result);

  // Look for the result card for the given task, or create it if it does not exist.
  let resultCard = document.querySelector(`.result-card[data-task-id="${taskId}"]`);
  if (!resultCard) {
    const command = result.command || 'Unknown';
    resultCard = initializeResultCard(taskId, command);
  }

  // Get the dedicated container for intermediate results.
  let intermediateContainer = resultCard.querySelector('.intermediate-results');
  if (!intermediateContainer) {
    intermediateContainer = document.createElement('div');
    intermediateContainer.className = 'intermediate-results';
    resultCard.querySelector('.result-content').prepend(intermediateContainer);
  }

  // If we have intermediate data (screenshotUrl, currentUrl, etc.), render them here.
  if (result.screenshotUrl || result.currentUrl || result.extractedInfo || result.navigableElements) {
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'intermediate-details';
    detailsDiv.style.border = '1px solid #ccc';
    detailsDiv.style.padding = '10px';
    detailsDiv.style.marginBottom = '10px';
    
    if (result.screenshotUrl) {
      const img = document.createElement('img');
      img.src = result.screenshotUrl;
      img.alt = 'Intermediate Screenshot';
      img.style.maxWidth = '100%';
      img.style.marginBottom = '10px';
      detailsDiv.appendChild(img);
    }
    
    if (result.currentUrl) {
      const urlPara = document.createElement('p');
      urlPara.textContent = `Current URL: ${truncateText(result.currentUrl, 80)}`;
      detailsDiv.appendChild(urlPara);
    }
    
    if (result.extractedInfo) {
      const infoPara = document.createElement('p');
      infoPara.textContent = `Extracted Info: ${truncateText(result.extractedInfo, 200)}`;
      detailsDiv.appendChild(infoPara);
    }
    
    if (result.navigableElements) {
      const navElements = Array.isArray(result.navigableElements)
        ? result.navigableElements.join(', ')
        : result.navigableElements;
      const navPara = document.createElement('p');
      navPara.textContent = `Navigable Elements: ${truncateText(navElements, 200)}`;
      detailsDiv.appendChild(navPara);
    }
    
    // Prepend the intermediate details so that the latest appears at the top.
    intermediateContainer.prepend(detailsDiv);
    return; // Do not proceed to any other streaming/subTask updates.
  }
  
  // Otherwise, if handling subTask or streaming updates (if applicable):
  if (subTask) {
    if (result.summary) {
      const summaryDiv = document.createElement('div');
      summaryDiv.className = 'intermediate-result-text';
      summaryDiv.textContent = `Step Result: ${result.summary}`;
      intermediateContainer.prepend(summaryDiv);
    }
    if (result.screenshotPath) {
      const img = document.createElement('img');
      img.src = result.screenshotPath;
      img.alt = 'Intermediate Screenshot';
      img.style.maxWidth = '100%';
      img.style.marginTop = '10px';
      img.style.display = 'block';
      img.onerror = () => {
        console.error('Image load failed:', result.screenshotPath);
        const errorText = document.createElement('p');
        errorText.textContent = 'Failed to load screenshot.';
        errorText.style.color = 'red';
        intermediateContainer.prepend(errorText);
      };
      intermediateContainer.prepend(img);
    }
  } else {
    if (result.chunk !== undefined) {
      let streamMessage = resultCard.querySelector(`.stream-message[data-task-id="${taskId}"]`);
      if (!streamMessage) {
        streamMessage = document.createElement('div');
        streamMessage.className = 'chat-message stream-message animate-in';
        streamMessage.dataset.taskId = taskId;
        streamMessage.innerHTML = `
          <div class="message-content">
            <p class="summary-text"></p>
            <span class="timestamp">${new Date().toLocaleTimeString()}</span>
          </div>
        `;
        intermediateContainer.prepend(streamMessage);
      }
      const summaryText = streamMessage.querySelector('.summary-text');
      summaryText.textContent += result.chunk;
      if (!streaming && result.chunk === 'Stream ended') {
        streamMessage.classList.remove('stream-message');
        streamMessage.classList.add('ai-message');
        const endMessage = document.createElement('div');
        endMessage.className = 'chat-message subtask-end animate-in';
        endMessage.innerHTML = `
          <div class="message-content">
            <p class="summary-text">--- End of Streaming Updates ---</p>
            <span class="timestamp">${new Date().toLocaleTimeString()}</span>
          </div>
        `;
        streamMessage.parentNode.insertBefore(endMessage, streamMessage.nextSibling);
      }
    }
  }
}

function handleTaskCompletion(taskId, status, result = {}) {
  // Force default empty objects to avoid undefined errors
  result.aiPrepared = result.aiPrepared || {};
  result.raw = result.raw || {};
  
  console.log('Task completed:', taskId, status, result);
  
  let resultCard = document.querySelector(`.result-card[data-task-id="${taskId}"]`);
  if (!resultCard) {
    // If no result card exists, use a fallback
    resultCard = initializeResultCard(taskId, result.command || 'Unknown');
  }
  
  const timestamp = new Date();
  const formattedTime = `${timestamp.toLocaleTimeString()} ${timestamp.toLocaleDateString()}`;
  const summary = result.aiPrepared.summary || 'No summary available';
  const urlValue = result.raw.url || 'N/A';
  
  resultCard.querySelector('.result-header').innerHTML = `
    <h4><i class="fas fa-globe"></i> ${urlValue}</h4>
    <p><strong>Command:</strong> ${result.command || 'Unknown'}</p>
    <div class="meta">
      <span>${formattedTime}</span>
    </div>
  `;
  
  const outputsDiv = resultCard.querySelector('.outputs');
  const screenshotsContainer = resultCard.querySelector('.screenshots');
  outputsDiv.innerHTML = `
    <div class="toggle-buttons">
      <button class="toggle-btn active" data-view="ai">AI Prepared</button>
      <button class="toggle-btn" data-view="raw">Raw Output</button>
    </div>
    <div class="ai-output active">${summary}</div>
    <div class="raw-output">${result.raw.pageText || 'No raw output available.'}</div>
    ${result.landingReportUrl ? `<a href="${result.landingReportUrl}" target="_blank" class="btn btn-primary btn-sm mt-2">View Landing Report</a>` : ''}
    ${result.midsceneReportUrl ? `<a href="${result.midsceneReportUrl}" target="_blank" class="btn btn-primary btn-sm mt-2">View Midscene Report</a>` : ''}
  `;
  
  if (result.screenshot) {
    const img = document.createElement('img');
    img.src = result.screenshot;
    img.alt = 'Final Screenshot';
    img.style.cssText = 'max-width: 100%; margin-top: 10px; display: block;';
    screenshotsContainer.prepend(img);
  }
  
  setupToggleButtons(resultCard);
  
  // Also insert a final AI message in the chat box
  const nliResults = document.getElementById('');
  const aiMessage = document.createElement('div');
  aiMessage.className = 'chat-message ai-message animate-in';
  aiMessage.innerHTML = `
    <div class="message-content">
      <p class="summary-text">${summary}</p>
      <span class="timestamp">${formattedTime}</span>
    </div>
  `;
  nliResults.prepend(aiMessage);
  nliResults.scrollTop = 0;
  
  loadActiveTasks();
  loadHistory();
}

function addTaskResult(result) {
  const outputContainer = document.getElementById('output-container');
  if (document.getElementById('no-results')) document.getElementById('no-results').remove();

  const resultCard = document.createElement('div');
  resultCard.className = 'result-card animate-in';
  resultCard.dataset.taskId = result.taskId;

  const timestamp = new Date(result.timestamp);
  const formattedTime = timestamp.toLocaleTimeString() + ' ' + timestamp.toLocaleDateString();

  resultCard.innerHTML = `
    <div class="result-header">
      <h4><i class="fas fa-globe"></i> ${result.url}</h4>
      <p><strong>Command:</strong> ${result.command}</p>
      <div class="meta">
        <span>${formattedTime}</span>
        <div class="share-buttons">
          <a href="#" onclick="copyResult('${result.taskId}')"><i class="fas fa-copy"></i></a>
          <a href="#" onclick="rerunTask('${result.taskId}')"><i class="fas fa-redo"></i></a>
        </div>
      </div>
    </div>
    <div class="result-content">
      <div class="toggle-buttons">
        <button class="toggle-btn active" data-view="ai">AI Prepared</button>
        <button class="toggle-btn" data-view="raw">Raw Output</button>
      </div>
      <div class="ai-output active">${result.aiOutput || 'No AI summary available.'}</div>
      <div class="raw-output">${result.output}</div>
      ${result.screenshot ? `<img src="${result.screenshot}" alt="Task Screenshot" style="max-width: 100%; margin-top: 10px;">` : ''}
      ${result.report ? `<a href="${result.report}" target="_blank" class="btn btn-primary btn-sm mt-2">View Report</a>` : ''}
    </div>
  `;

  outputContainer.prepend(resultCard);

  // Add toggle functionality
  const toggleButtons = resultCard.querySelectorAll('.toggle-btn');
  const aiOutput = resultCard.querySelector('.ai-output');
  const rawOutput = resultCard.querySelector('.raw-output');

  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all buttons and outputs
      toggleButtons.forEach(b => b.classList.remove('active'));
      aiOutput.classList.remove('active');
      rawOutput.classList.remove('active');

      // Add active class to the clicked button and corresponding output
      btn.classList.add('active');
      if (btn.dataset.view === 'ai') {
        aiOutput.classList.add('active');
      } else {
        rawOutput.classList.add('active');
      }
    });
  });

  // Hide both the canvas and its fallback, then show the output container
  outputContainer.style.display = 'block';
  showNotification('Task result added!', 'success');
}

// Enhanced loadActiveTasks function
async function loadActiveTasks() {
  const tasksContainer = document.getElementById('active-tasks-container');
  try {
    const response = await fetch('/tasks/active', { credentials: 'include', headers: { 'Content-Type': 'application/json','X-Requested-With': 'XMLHttpRequest' }, });
    if (!response.ok) {
      // could be a 302→login.html or a 401 JSON
      console.error('Auth failure or network error:', await response.text());
      return []; // or handle logout
    }
    
    const tasks = await response.json();
    activeTasks = tasks || [];
    tasksContainer.innerHTML = '';
    
    if (activeTasks.length === 0) {
      tasksContainer.innerHTML = '<p id="no-active-tasks" class="text-muted">No active tasks. Run a task to see it here.</p>';
    } else {
      activeTasks.forEach(task => {
        const taskElement = createTaskElement(task);
        tasksContainer.prepend(taskElement);
      });
    }
    updateActiveTasksTab();
  } catch (error) {
    console.error('Error loading active tasks:', error);
    tasksContainer.innerHTML = `
      <div class="active-task error">
        <div class="task-header">
          <h4><i class="fas fa-exclamation-triangle"></i> Error Loading Tasks</h4>
          <span class="task-status error">Failed</span>
        </div>
        <div class="task-error">${error.message}</div>
      </div>
    `;
    activeTasks = [];
    updateActiveTasksTab();
    showNotification('Failed to load active tasks. Please try again.', 'error');
  }
}

function updateActiveTasksTab(){
  const tab = document.getElementById('active-tasks-tab');
  if (activeTasks.length > 0) {
    const processing = activeTasks.filter(task => task.status === 'processing');
    tab.innerHTML = processing.length > 0 ?
      `<i class="fas fa-spinner fa-spin"></i> Active Tasks (${processing.length})` :
      `<i class="fas fa-tasks"></i> Active Tasks (${activeTasks.length})`;
  } else {
    tab.innerHTML = '<i class="fas fa-tasks"></i> Active Tasks';
  }
}

function createTaskElement(task) {
  const element = document.createElement('div');
  element.className = 'active-task';
  element.dataset.taskId = task._id;
  let statusClass = 'pending';
  let statusIcon = 'clock';
  switch (task.status) {
      case 'processing':
          statusClass = 'processing';
          statusIcon = 'spinner fa-spin';
          break;
      case 'completed':
          statusClass = 'completed';
          statusIcon = 'check';
          break;
      case 'error':
          statusClass = 'error';
          statusIcon = 'exclamation-triangle';
          break;
  }
  element.innerHTML = `
      <div class="task-header">
          <h4><i class="fas fa-${statusIcon}"></i> ${task.command}</h4>
          <span class="task-status ${statusClass}">${task.status}</span>
          <button class="cancel-task-btn btn btn-danger btn-sm">Cancel</button>
      </div>
      <div class="task-url"><i class="fas fa-link"></i> ${task.url || 'N/A'}</div>
      <div class="task-progress-container">
          <div class="task-progress" style="width: ${task.progress || 0}%"></div>
      </div>
      <div class="task-meta">
          <span class="task-time"><i class="fas fa-play"></i> Started: ${new Date(task.startTime).toLocaleTimeString()}</span>
          ${task.endTime ? `<span class="task-time"><i class="fas fa-flag-checkered"></i> Ended: ${new Date(task.endTime).toLocaleTimeString()}</span>` : ''}
      </div>
      ${task.subTasks && task.subTasks.length > 0 ? `
          <div class="subtasks">
              <h5>Subtasks</h5>
              ${task.subTasks.map(subtask => `
                  <div class="subtask">
                      <p>${subtask.command}</p>
                      <div class="subtask-progress-container">
                          <div class="subtask-progress" style="width: ${subtask.progress || 0}%"></div>
                      </div>
                      <span class="subtask-status ${subtask.status}">${subtask.status}</span>
                  </div>
              `).join('')}
          </div>
      ` : ''}
      ${task.intermediateResults && task.intermediateResults.length > 0 ? `
          <div class="intermediate-results">
              <h5>Intermediate Results</h5>
              ${task.intermediateResults.map(result => `
                  <pre>${JSON.stringify(result, null, 2)}</pre>
              `).join('')}
          </div>
      ` : ''}
      ${task.error ? `<div class="task-error"><i class="fas fa-exclamation-circle"></i> ${task.error}</div>` : ''}
  `;
  if (task.status === 'error') {
    element.querySelector('.remove-task-btn').addEventListener('click', () => {
      element.remove(); // Remove from UI
      loadActiveTasks(); // Refresh to sync with server
    });
  } else {
    element.querySelector('.cancel-task-btn').addEventListener('click', async () => {
      try {
        const response = await fetch(`/tasks/${task._id}/cancel`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json','X-Requested-With': 'XMLHttpRequest' }, });
        if (!response.ok) {
          // could be a 302→login.html or a 401 JSON
          console.error('Auth failure or network error:', await response.text());
          return []; // or handle logout
        }
        const result = await response.json();
        if (result.success) {
          showNotification('Task canceled successfully!');
          element.remove();
          loadActiveTasks();
        } else {
          showNotification(result.error, 'error');
        }
      } catch (err) {
        showNotification('Error canceling task: ' + err.message, 'error');
      }
    });
  }
  return element;
}

/******************** Repetitive Task Functions ********************/
function addRepetitiveTask(task) {
  repetitiveTasks.push(task);
  const container = document.getElementById('repetitive-tasks-container');
  if (document.getElementById('no-repetitive-tasks')) {
    document.getElementById('no-repetitive-tasks').remove();
  }
  const taskElem = document.createElement('div');
  taskElem.classList.add('repetitive-task');
  taskElem.innerHTML = `
    <div>
      <p>${task.command}</p>
      <div class="interval">Interval: ${task.interval} seconds</div>
    </div>
    <div class="actions">
      <button class="btn btn-danger btn-sm btn-icon cancel-repetitive-task"><i class="fas fa-times"></i> Cancel</button>
    </div>
  `;
  container.prepend(taskElem);
  taskElem.querySelector('.cancel-repetitive-task').addEventListener('click', () => {
    clearInterval(task.intervalId);
    repetitiveTasks = repetitiveTasks.filter(t => t.id !== task.id);
    taskElem.remove();
    if (repetitiveTasks.length === 0) {
      container.innerHTML = '<p id="no-repetitive-tasks" class="text-muted">No repetitive tasks.</p>';
    }
    showNotification('Repetitive task cancelled!');
  });
  task.intervalId = setInterval(() => executeTaskWithAnimation(task.url, task.command, 'repetitive'), task.interval * 1000);
}

window.deleteRepetitiveTask = function(taskId) {
  const taskIndex = repetitiveTasks.findIndex(t => t.id === taskId);
  if (taskIndex !== -1) {
    clearInterval(repetitiveTasks[taskIndex].intervalId);
    repetitiveTasks.splice(taskIndex, 1);
    updateRepetitiveTasks(); // Re-render the repetitive task list.
    showNotification('Repetitive task deleted', 'success');
  } else {
    showNotification('Task not found', 'error');
  }
};

function updateRepetitiveTasks() {
  const container = document.getElementById('repetitive-tasks-container');
  if (!container) return;
  const tasks = JSON.parse(localStorage.getItem('repetitiveTasks') || '[]');
  if (tasks.length === 0) {
    container.innerHTML = '<p id="no-repetitive-tasks" class="text-muted">No repetitive tasks. Use the Repetitive Task tab to create one.</p>';
    return;
  }
  container.innerHTML = '';
  tasks.forEach(task => {
    const taskElem = document.createElement('div');
    taskElem.className = 'repetitive-task';
    taskElem.dataset.taskId = task.id;
    taskElem.innerHTML = `
      <div class="task-info">
        <h4>${task.command.length > 30 ? task.command.substring(0, 30) + '...' : task.command}</h4>
        <p><i class="fas fa-link"></i> ${task.url}</p>
      </div>
      <div class="task-actions">
        <button class="btn btn-sm btn-primary" onclick="executeRepetitiveTask(${task.id})"><i class="fas fa-play"></i> Run</button>
        <button class="btn btn-sm btn-danger" onclick="deleteRepetitiveTask(${task.id})"><i class="fas fa-trash"></i></button>
      </div>
    `;
    container.appendChild(taskElem);
  });
}

window.executeRepetitiveTask = async function(taskId) {
  const tasks = JSON.parse(localStorage.getItem('repetitiveTasks') || '[]');
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    showNotification('Task not found', 'error');
    return;
  }
  try {
    showNotification(`Executing repetitive task: ${task.command}`, 'success');
    const result = await executeTask(task.url, task.command);
    result.taskType = 'repetitive';
    addTaskResult(result);
    addToHistory(task.url, task.command, result);
  } catch (error) {
    console.error('Error executing repetitive task:', error);
    showNotification(`Task execution failed: ${error.message}`, 'error');
  }
};

/******************** Scheduled Task Functions ********************/
function scheduleTask(task) {
  scheduledTasks.push(task);
  const container = document.getElementById('scheduled-tasks-container');
  if (document.getElementById('no-scheduled-tasks')) {
    document.getElementById('no-scheduled-tasks').remove();
  }
  const taskElem = document.createElement('div');
  taskElem.classList.add('scheduled-task');
  taskElem.innerHTML = `
    <div>
      <p>${task.command}</p>
      <div class="time">Scheduled for: ${new Date(task.scheduledTime).toLocaleString()}</div>
    </div>
    <div class="actions">
      <button class="btn btn-danger btn-sm btn-icon cancel-scheduled-task"><i class="fas fa-times"></i> Cancel</button>
    </div>
  `;
  container.prepend(taskElem);
  const timeUntil = new Date(task.scheduledTime).getTime() - Date.now();
  if (timeUntil < 2147483647) {
    setTimeout(() => executeScheduledTask(task), timeUntil);
  }
  taskElem.querySelector('.cancel-scheduled-task').addEventListener('click', () => {
    scheduledTasks = scheduledTasks.filter(t => t.id !== task.id);
    taskElem.remove();
    if (scheduledTasks.length === 0) {
      container.innerHTML = '<p id="no-scheduled-tasks" class="text-muted">No scheduled tasks. Use the Scheduled Task tab to create one.</p>';
    }
  });
}

function updateScheduledTasksList() {
  const container = document.getElementById('scheduled-tasks-container');
  if (!container) return;
  if (scheduledTasks.length === 0) {
    container.innerHTML = '<p id="no-scheduled-tasks" class="text-muted">No scheduled tasks. Use the Scheduled Task tab to create one.</p>';
    return;
  }
  container.innerHTML = '';
  scheduledTasks.forEach(task => {
    const taskElem = document.createElement('div');
    taskElem.className = 'scheduled-task';
    taskElem.dataset.taskId = task.id;
    const scheduledTime = new Date(task.scheduledTime);
    const formattedTime = scheduledTime.toLocaleTimeString() + ' ' + scheduledTime.toLocaleDateString();
    taskElem.innerHTML = `
      <div>
        <p>${task.command}</p>
        <p class="time"><i class="fas fa-clock"></i> ${formattedTime}</p>
      </div>
      <div class="actions">
        <button class="btn btn-sm btn-danger cancel-scheduled-task"><i class="fas fa-times"></i></button>
      </div>
    `;
    container.appendChild(taskElem);
    taskElem.querySelector('.cancel-scheduled-task').addEventListener('click', () => {
      scheduledTasks = scheduledTasks.filter(t => t.id !== task.id);
      taskElem.remove();
      if (scheduledTasks.length === 0) {
        container.innerHTML = '<p id="no-scheduled-tasks" class="text-muted">No scheduled tasks. Use the Scheduled Task tab to create one.</p>';
      }
    });
  });
}

async function executeScheduledTask(task) {
  const idx = scheduledTasks.findIndex(t => t.id === task.id);
  if (idx === -1) return;
  scheduledTasks.splice(idx, 1);
  try {
    const result = await executeTask(task.url, task.command);
    result.taskType = 'scheduled';
    addTaskResult(result);
    addToHistory(task.url, task.command, result);
    showNotification('Scheduled task executed successfully!');
  } catch (error) {
    showNotification('Error executing scheduled task', 'error');
    console.error(error);
  }
  updateScheduledTasksList();
}

function checkScheduledTasks() {
  scheduledTasks.forEach(task => {
    const scheduledTime = new Date(task.scheduledTime);
    const timeUntil = scheduledTime.getTime() - Date.now();
    if (timeUntil <= 0) {
      executeScheduledTask(task);
    } else if (timeUntil < 2147483647) {
      setTimeout(() => executeScheduledTask(task), timeUntil);
    }
  });
  updateScheduledTasksList();
}

// Manual Task Handler
document.getElementById('run-manual-task').addEventListener('click', async () => {
  const url = document.getElementById('manual-url').value.trim();
  const command = document.getElementById('manual-command').value.trim();
  
  if (!url || !command) {
    showNotification('Please enter both URL and command.', 'error');
    return;
  }

  // Use executeTaskWithAnimation to ensure proper flow
  await executeTaskWithAnimation(url, command, 'manual');
});

/******************** History Functions ********************/
/******************** History Functions ********************/
let currentPage = 1;
const limit = 20;

// Load history from the server with pagination
async function loadHistory(page = 1) {
  const historyList = document.getElementById('history-list');
  const historyContainer = historyList.parentElement || historyList; // Fallback to historyList if no parent

  // Show loading state
  historyList.innerHTML = '<p class="text-muted">Loading history...</p>';

  try {
    console.log(`Fetching history for page ${page}`); // Debug log
    const response = await fetch(`/history?page=${page}&limit=${limit}`, { credentials: 'include', headers: { 'Content-Type': 'application/json','X-Requested-With': 'XMLHttpRequest' }, });

    if (!response.ok) {
      // could be a 302→login.html or a 401 JSON
      console.error('Auth failure or network error:', await response.text());
      return []; // or handle logout
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    if ((!contentType || !contentType.includes('application/json')) && !window.location.pathname.includes('old.html')) {
      window.location.href = '/login.html';
      return;
    }

    if (!response.ok) {
      throw new Error(`Failed to load history: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('History response:', data); // Debug log
    historyList.innerHTML = ''; // Clear previous content

    if (!data.items || data.items.length === 0) {
      historyList.innerHTML = '<p id="no-history" class="text-muted">No task history. Run a task to start building your history.</p>';
      return;
    }

    // Update currentPage to match the server's response
    currentPage = data.currentPage;

    // Render history items
    data.items.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'output-card';
      historyItem.dataset.taskId = item._id;
      const timestamp = new Date(item.timestamp);
      const formattedTime = `${timestamp.toLocaleTimeString()} ${timestamp.toLocaleDateString()}`;
      const escapedCommand = item.command.replace(/'/g, "\\'");

      historyItem.innerHTML = `
        <h4><i class="fas fa-history"></i> Task: ${item.command.length > 30 ? item.command.substring(0, 30) + '...' : item.command}</h4>
        <p>URL: ${item.url}</p>
        <div class="meta">
          <span>${formattedTime}</span>
          <div class="share-buttons">
            <a href="#" onclick="event.stopPropagation(); rerunHistoryTask('${item._id}', '${item.url}', '${escapedCommand}')">
              <i class="fas fa-redo"></i>
            </a>
            <a href="#" onclick="event.stopPropagation(); deleteHistoryTask('${item._id}')">
              <i class="fas fa-trash"></i>
            </a>
          </div>
        </div>
      `;
      historyItem.addEventListener('click', handleHistoryCardClick); // Use the function directly
      historyList.appendChild(historyItem);
    });

    // Add pagination navigation
    let navDiv = historyContainer.querySelector('.history-navigation');
    if (!navDiv) {
      navDiv = document.createElement('div');
      navDiv.className = 'history-navigation';
      navDiv.style.display = 'flex';
      navDiv.style.justifyContent = 'center';
      navDiv.style.gap = '10px';
      navDiv.style.marginTop = '20px';
      historyContainer.appendChild(navDiv);
    }
    navDiv.innerHTML = ''; // Clear previous navigation

    // Add page indicator
    const pageIndicator = document.createElement('span');
    pageIndicator.textContent = `Page ${data.currentPage} of ${data.totalPages}`;
    pageIndicator.style.alignSelf = 'center';
    navDiv.appendChild(pageIndicator);

    if (data.currentPage > 1) {
      const prevButton = document.createElement('button');
      prevButton.textContent = 'Previous';
      prevButton.className = 'btn btn-sm';
      prevButton.onclick = () => {
        loadHistory(data.currentPage - 1);
      };
      navDiv.appendChild(prevButton);
    }

    if (data.currentPage < data.totalPages) {
      const nextButton = document.createElement('button');
      nextButton.textContent = 'Next';
      nextButton.className = 'btn btn-sm';
      nextButton.onclick = () => {
        loadHistory(data.currentPage + 1);
      };
      navDiv.appendChild(nextButton);
    }
  } catch (error) {
    console.error('Error loading history:', error);
    historyList.innerHTML = '<p class="text-muted">Failed to load history. Please try again.</p>';
    showNotification('Error loading history', 'error');
  }
}

function handleHistoryCardClick(e) {
  if (e.target.tagName === 'A' || e.target.closest('a')) return;

  const taskId = e.currentTarget.dataset.taskId;
  const popup = document.getElementById('history-popup');
  const details = document.getElementById('history-details-content');
  if (!popup || !details) {
    console.error('Popup or details element is missing in the DOM!');
    return;
  }

  fetch(`/history/${taskId}`, { credentials: 'include', headers: { 'Content-Type': 'application/json','X-Requested-With': 'XMLHttpRequest' }, })
    .then(res => {
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/login.html';
          return;
        }
        throw new Error('Failed to fetch history item');
      }
      return res.json();
    })
    .then(item => {
      if (!item) {
        showNotification('History item not found', 'error');
        return;
      }

      const { command, url, timestamp, result = {}, intermediateResults = [], landingReportUrl: topLanding, midsceneReportUrl: topMidscene, runReport: topRun, errorReportUrl } = item;
      console.log('DEBUG: Full fetched history item:', item);
      const { aiPrepared = {}, raw = {}, runReport = topRun } = result;

      // Summaries
      const summary = aiPrepared.summary 
  || (result && result.error ? `<span style='color: var(--danger);'>${result.error}</span>` : 'No summary available');
      const rawOutput = raw.pageText || 'No raw output available.';

      // Screenshots gallery
      let screenshotsHtml = '';
      const allScreenshots = [];
      if (Array.isArray(intermediateResults)) {
        intermediateResults.forEach(r => {
          if (r.screenshotPath) allScreenshots.push(r.screenshotPath);
        });
      }
      [result.finalScreenshotPath, result.screenshot, result.screenshotPath].forEach(p => {
        if (p) allScreenshots.push(p);
      });
      if (allScreenshots.length > 0) {
        screenshotsHtml = `<div class="screenshot-gallery">${allScreenshots.map(src => `<img src="${src}" class="screenshot-thumb" alt="Screenshot">`).join('')}</div>`;
      } else {
        screenshotsHtml = '<p>No screenshots available.</p>';
      }

      // Reports (success or error)
      let reportLinksHtml = '';
      if (topLanding) {
        reportLinksHtml += `
          <a href="${topLanding}" target="_blank" class="btn btn-primary btn-sm">View Landing Report</a>
        `;
      }
      if (topMidscene) {
        reportLinksHtml += `
          <a href="${topMidscene}" target="_blank" class="btn btn-primary btn-sm">View Midscene Report</a>
        `;
      }
      if (topRun) {
        reportLinksHtml += `
          <a href="${topRun}" target="_blank" class="btn btn-primary btn-sm">View Run Report</a>
        `;
      }
      if (errorReportUrl) {
        reportLinksHtml += `
          <a href="${errorReportUrl}" target="_blank" class="btn btn-danger btn-sm">View Error Report</a>
        `;
      }
      if (!reportLinksHtml) {
        reportLinksHtml = '<p>No report available.</p>';
      }

      // Collapsible intermediateResults
      let intermediateHtml = '';
      if (Array.isArray(intermediateResults) && intermediateResults.length) {
        intermediateHtml = `
          <div class="collapsible-section">
            <button class="collapsible-btn">Show Intermediate Results (${intermediateResults.length})</button>
            <div class="collapsible-content" style="display:none;">
              <pre style="white-space: pre-wrap; color: #eee;">${JSON.stringify(intermediateResults, null, 2)}</pre>
            </div>
          </div>`;
      }

      // Status badge
      let statusBadge = '';
      if (item.status === 'completed') {
        statusBadge = '<span class="badge badge-success" style="background: #28a745; color: #fff; padding: 4px 10px; border-radius: 4px;">Success</span>';
      } else if (item.status === 'error' || result.error) {
        statusBadge = '<span class="badge badge-danger" style="background: #dc3545; color: #fff; padding: 4px 10px; border-radius: 4px;">Error</span>';
      } else {
        statusBadge = `<span class="badge badge-secondary" style="background: #6c757d; color: #fff; padding: 4px 10px; border-radius: 4px;">${item.status ? item.status.charAt(0).toUpperCase() + item.status.slice(1) : 'Unknown'}</span>`;
      }

      // Insert into popup
      // Extra error details if present
      let errorSection = '';
      if (item.status === 'error' || result.error) {
        errorSection = `
          <h4 style="color: #ff6b6b; margin-top: 20px; margin-bottom: 10px;">Error Details</h4>
          <div style="color: #ff6b6b; background: #2d1c1c; padding: 10px; border-radius: 5px; margin: 5px 0; white-space: pre-wrap;">
            <strong>Error:</strong> ${item.error || result.error || 'Unknown error'}
          </div>
        `;
      }
      // Subtasks if present
      let subTasksSection = '';
      if (item.subTasks && Array.isArray(item.subTasks) && item.subTasks.length > 0) {
        subTasksSection = `
          <h4 style="color: #e8e8e8; margin-top: 20px; margin-bottom: 10px;">Subtasks</h4>
          <div style="background: #222; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
            <pre style="color: #eee;">${JSON.stringify(item.subTasks, null, 2)}</pre>
          </div>
        `;
      }
      details.innerHTML = `
        <div class="history-popup-header">
          ${statusBadge}
          <h4 style="color: #e8e8e8; margin-bottom: 15px; display:inline-block; margin-left: 12px;">Task Details</h4>
        </div>
        <p style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0;">
          <strong>Command:</strong> ${command}
        </p>
        <p style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0;">
          <strong>URL:</strong> ${url || 'Unknown URL'}
        </p>
        <p style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0;">
          <strong>Timestamp:</strong> ${timestamp ? new Date(timestamp).toLocaleString() : 'N/A'}
        </p>
        ${errorSection}
        <h4 style="color: #e8e8e8; margin-top: 20px; margin-bottom: 15px;">AI Summary</h4>
        <p style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0; white-space: pre-wrap; max-height: 200px; overflow-y: auto;">
          ${summary}
        </p>
        ${subTasksSection}
        <h4 style="color: #e8e8e8; margin-top: 20px; margin-bottom: 15px;">Screenshots</h4>
        <div style="background: #222; padding: 10px; border-radius: 5px;">
          ${screenshotsHtml}
        </div>
        <h4 style="color: #e8e8e8; margin-top: 20px; margin-bottom: 15px;">Raw Output</h4>
        <div style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">
          ${rawOutput}
        </div>
        <h4 style="color: #e8e8e8; margin-top: 20px; margin-bottom: 15px;">Reports</h4>
        <div>
          ${reportLinksHtml}
        </div>
        ${intermediateHtml}
      `;

      // Collapsible logic for intermediateResults
      const collBtn = details.querySelector('.collapsible-btn');
      if (collBtn) {
        collBtn.onclick = function() {
          const content = details.querySelector('.collapsible-content');
          if (content.style.display === 'none') {
            content.style.display = 'block';
            collBtn.textContent = 'Hide Intermediate Results';
          } else {
            content.style.display = 'none';
            collBtn.textContent = `Show Intermediate Results (${intermediateResults.length})`;
          }
        };
      }

      // Screenshot gallery click to expand
      details.querySelectorAll('.screenshot-thumb').forEach(img => {
        img.onclick = function() {
          const src = img.src;
          const overlay = document.createElement('div');
          overlay.className = 'screenshot-overlay';
          overlay.style = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
          overlay.innerHTML = `<img src='${src}' style='max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 8px 32px #000;'>`;
          overlay.onclick = () => document.body.removeChild(overlay);
          document.body.appendChild(overlay);
        };
      });

      popup.classList.add('active');

      // Hook up close button
      document.getElementById('close-history-popup').onclick = () => {
        popup.classList.remove('active');
      };

      // Close on background click
      popup.onclick = (ev) => {
        if (ev.target === popup) {
          popup.classList.remove('active');
        }
      };

      // Close on Escape
      const escapeHandler = (ev) => {
        if (ev.key === 'Escape') {
          popup.classList.remove('active');
          document.removeEventListener('keydown', escapeHandler);
        }
      };
      document.addEventListener('keydown', escapeHandler);
    })
    .catch(err => {
      console.error('Error fetching history details:', err);
      showNotification('Error loading task details', 'error');
    });
}

function addToHistory(url, command, result) {
  if (!result || !result.taskId) return;
  const taskId = result.taskId;
  const historyList = document.getElementById('history-list');
  const noHistory = document.getElementById('no-history');
  if (noHistory) noHistory.remove();

  const historyItem = document.createElement('div');
  historyItem.className = 'output-card animate-in';
  historyItem.dataset.taskId = taskId;
  const timestamp = new Date(result.timestamp);
  const formattedTime = timestamp.toLocaleTimeString() + ' ' + timestamp.toLocaleDateString();
  const escapedCommand = command.replace(/'/g, "\\'");

  historyItem.innerHTML = `
      <h4><i class="fas fa-history"></i> Task: ${command.length > 30 ? command.substring(0, 30) + '...' : command}</h4>
      <p>URL: ${url || result.url || 'N/A'}</p>
      <div class="meta">
          <span>${formattedTime}</span>
          <div class="share-buttons">
              <a href="#" onclick="event.stopPropagation(); rerunHistoryTask('${taskId}', '${url || result.url || 'N/A'}', '${escapedCommand}')">
                  <i class="fas fa-redo"></i>
              </a>
              <a href="#" onclick="event.stopPropagation(); deleteHistoryTask('${taskId}')">
                  <i class="fas fa-trash"></i>
              </a>
          </div>
      </div>
  `;
  historyList.prepend(historyItem);
  historyItem.addEventListener('click', handleHistoryCardClick);
}

document.addEventListener('DOMContentLoaded', () => {

  // Clear history button handler
  const clearHistoryButton = document.getElementById('clear-history');
  if (clearHistoryButton) {
    clearHistoryButton.addEventListener('click', async () => {
      try {
        const response = await fetch('/history', {
          method: 'DELETE',
          credentials: 'include', headers: { 'Content-Type': 'application/json','X-Requested-With': 'XMLHttpRequest' },
        });
        
        if (!response.ok) {
          // could be a 302→login.html or a 401 JSON
          console.error('Auth failure or network error:', await response.text());
          return []; // or handle logout
        }
        
        // Clear loaded history IDs
        loadedHistoryIds.clear();
        
        // Update UI
        document.getElementById('history-list').innerHTML = 
          '<p id="no-history" class="text-muted">No task history. Run a task to start building your history.</p>';
        
        showNotification('History cleared successfully!');
      } catch (error) {
        showNotification('Error clearing history', 'error');
        console.error(error);
      }
    });
  }
});

/**************************** Notification Function ****************************/
function showNotification(message, type = 'success') {
  const notification = document.getElementById('notification');
  const messageEl = document.getElementById('notification-message');
  messageEl.textContent = message;
  notification.className = 'notification';
  notification.classList.add(type === 'error' ? 'danger' : 'success');
  notification.classList.add('show');
  setTimeout(() => { notification.classList.remove('show'); }, 3000);
}

/**************************** Global Helpers ****************************/
window.copyResult = function(taskId) {
  const resultCard = document.querySelector(`#raw-results .output-card[data-task-id="${taskId}"]`);
  const output = resultCard ? resultCard.querySelector('pre').textContent : '';
  navigator.clipboard.writeText(output)
    .then(() => { showNotification('Result copied to clipboard!'); })
    .catch(() => { showNotification('Failed to copy result', 'error'); });
};

window.rerunTask = function(taskId) {
  const result = taskResults.find(r => r.taskId === taskId);
  if (!result) return;
  document.getElementById('manual-url').value = result.url;
  document.getElementById('manual-command').value = result.command;
  document.querySelectorAll('.tab-btn').forEach(tab => tab.classList.remove('active'));
  document.getElementById('manual-tab').classList.add('active');
  document.querySelectorAll('.task-section').forEach(section => section.classList.remove('active'));
  document.getElementById('manual-section').classList.add('active');
};

window.rerunHistoryTask = function(taskId, url, command) {
  document.getElementById('manual-url').value = url;
  document.getElementById('manual-command').value = command;
  document.querySelectorAll('.tab-btn').forEach(tab => tab.classList.remove('active'));
  document.getElementById('manual-tab').classList.add('active');
  document.querySelectorAll('.task-section').forEach(section => section.classList.remove('active'));
  document.getElementById('manual-section').classList.add('active');
};

window.deleteHistoryTask = async function(taskId) {
  try {
    await fetch(`/history/${taskId}`, { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json','X-Requested-With': 'XMLHttpRequest' }, });
    const item = document.querySelector(`.output-card[data-task-id="${taskId}"]`);
    if (item) item.remove();
    if (document.getElementById('history-list').children.length === 0) {
      document.getElementById('history-list').innerHTML = '<p id="no-history" class="text-muted">No task history. Run a task to start building your history.</p>';
    }
    showNotification('History item deleted!');
  } catch (error) {
    showNotification('Error deleting history item', 'error');
    console.error(error);
  }
};
