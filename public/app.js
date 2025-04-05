import { init, startAnimations, updateTaskState, updateSentinelState, handleResize, cleanup } from './animations.js';

// Global state
let taskResults = [];
let activeTasks = [];
let scheduledTasks = [];
let repetitiveTasks = [];

// WebSocket setup
const ws = new WebSocket(`ws://localhost:3400`);
ws.onopen = () => console.log('Connected');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.event === 'taskUpdate') {
    updateTaskProgress(data.taskId, data.progress, data.status, data.error);
  } else if (data.event === 'intermediateResult') {
    handleIntermediateResult(data.taskId, data.result);
  } else if (data.event === 'taskComplete') {
    handleTaskCompletion(data.taskId, data.status, data.result);
  }
};

/**************************** Utility Functions ****************************/

// Check WebGL availability
function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

/**************************** Initialization ****************************/

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize animations
  init();
  handleResize();
  const webGLSupported = isWebGLAvailable();
  if (webGLSupported) {
    startAnimations();
    document.getElementById('sentinel-canvas').style.display = 'block';
    document.getElementById('sentinel-fallback').style.display = 'none';
  } else {
    console.warn('WebGL not supported. Using fallback.');
    document.getElementById('sentinel-canvas').style.display = 'none';
    document.getElementById('sentinel-fallback').style.display = 'block';
  }

  // Load initial data and set animation state
  await loadActiveTasks();
  loadHistory();
  setInterval(() => { loadActiveTasks(); loadHistory(); }, 120000);

  // Splash screen animation
  const loadingProgress = document.getElementById('loading-progress');
  let progress = 0;
  const interval = setInterval(() => {
    progress += 5;
    loadingProgress.style.width = `${progress}%`;
    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        const splashScreen = document.getElementById('splash-screen');
        splashScreen.style.opacity = '0';
        setTimeout(() => {
          splashScreen.style.display = 'none';
          if (!localStorage.getItem('operatorIntroShown')) {
            document.getElementById('intro-overlay').style.display = 'flex';
          }
        }, 500);
      }, 500);
    }
  }, 100);

});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanup();
});

// Load chat history on page load
async function loadChatHistory() {
  try {
    const response = await fetch('/chat-history', { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to load chat history');
    const data = await response.json();
    const nliResults = document.getElementById('nli-results');
    nliResults.innerHTML = ''; // Clear any existing messages

    // Reverse the messages array to show newest first
    const reversedMessages = data.messages.reverse();

    // Add each message to the chat container
    reversedMessages.forEach(message => {
      const messageDiv = document.createElement('div');
      messageDiv.className = `chat-message ${message.role}-message animate-in`;
      messageDiv.innerHTML = `
        <div class="message-content">
          <p class="summary-text ${message.role === 'assistant' && message.content.startsWith('Error:') ? 'error' : ''}">
            ${message.content}
          </p>
          <span class="timestamp">${new Date(message.timestamp).toLocaleTimeString()}</span>
        </div>
      `;
      nliResults.appendChild(messageDiv);
    });

    // Scroll to the top to show the newest messages
    nliResults.scrollTop = 0;
  } catch (err) {
    console.error('Error loading chat history:', err);
    // Fallback to localStorage if the server fetch fails
    const savedMessages = JSON.parse(localStorage.getItem('chatHistory') || '[]');
    const nliResults = document.getElementById('nli-results');
    nliResults.innerHTML = '';

    // Reverse the saved messages too
    const reversedSavedMessages = savedMessages.reverse();
    reversedSavedMessages.forEach(message => {
      const messageDiv = document.createElement('div');
      messageDiv.className = `chat-message ${message.role}-message animate-in`;
      messageDiv.innerHTML = `
        <div class="message-content">
          <p class="summary-text ${message.role === 'assistant' && message.content.startsWith('Error:') ? 'error' : ''}">
            ${message.content}
          </p>
          <span class="timestamp">${new Date(message.timestamp).toLocaleTimeString()}</span>
        </div>
      `;
      nliResults.appendChild(messageDiv);
    });
    // Scroll to the top
    nliResults.scrollTop = 0;
  }
}

// Add to chat history in localStorage (as a fallback)
function saveChatMessage(role, content) {
  const savedMessages = JSON.parse(localStorage.getItem('chatHistory') || '[]');
  savedMessages.push({ role, content, timestamp: new Date() });
  localStorage.setItem('chatHistory', JSON.stringify(savedMessages));
}

// Main - Chat nliForm submit handler
document.addEventListener('DOMContentLoaded', () => {
  loadChatHistory(); // Load chat history on page load

  const nliForm = document.getElementById('nli-form');
  if (nliForm) {
    nliForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = document.getElementById('nli-prompt').value.trim();
      if (!prompt) {
        showNotification('Please enter a command', 'error');
        return;
      }
      nliForm.querySelector('button[type="submit"]').disabled = true;

      const nliResults = document.getElementById('nli-results');
      const userMessage = document.createElement('div');
      userMessage.className = 'chat-message user-message animate-in';
      userMessage.innerHTML = `
        <div class="message-content">
          <p>${prompt}</p>
          <span class="timestamp">${new Date().toLocaleTimeString()}</span>
        </div>
      `;
      nliResults.prepend(userMessage);
      nliResults.scrollTop = 0;

      saveChatMessage('user', prompt);
      showNotification('Executing command...', 'success');
      updateTaskState(true);
      updateSentinelState('tasking');
      if (isWebGLAvailable()) {
        //sentinelCanvas.style.display = 'block';
      }

      let taskId = Date.now().toString();
      let url = null;

      try {
        const res = await fetch('/nli', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ prompt, url }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Command failed');

        if (data.taskId) {
          taskId = data.taskId;
          const runId = data.runId;

          // Call loadActiveTasks immediately to show the task in active-tasks-container
          await loadActiveTasks();

          const outputContainer = document.getElementById('output-container');
          if (document.getElementById('no-results')) document.getElementById('no-results').remove();

          // Create resultCard with separate outputs and screenshots containers
          const resultCard = document.createElement('div');
          resultCard.className = 'result-card animate-in';
          resultCard.dataset.taskId = taskId;
          resultCard.innerHTML = `
            <div class="result-header">
              <h4><i class="fas fa-globe"></i> Processing...</h4>
              <p><strong>Command:</strong> ${prompt}</p>
              <div class="meta">
                <span>${new Date().toLocaleTimeString()}</span>
              </div>
            </div>
            <div class="result-content">
              <div class="outputs"></div>
              <div class="screenshots"></div>
            </div>
          `;
          outputContainer.prepend(resultCard);
          outputContainer.style.display = 'block';

          // Set up EventSource with corrected intermediate results handling
          const eventSource = new EventSource(`/tasks/${taskId}/stream`);
          eventSource.onmessage = (event) => {
            const update = JSON.parse(event.data);
            console.log('Event received for taskId:', taskId, 'Update:', update);

            // Handle progress and status updates
            if (update.progress !== undefined) {
              updateTaskProgress(taskId, update.progress, update.status, update.error);
            }

            // Handle intermediate results
            if (update.intermediateResults && Array.isArray(update.intermediateResults)) {
              update.intermediateResults.forEach(result => {
                if (result.screenshotPath) {
                  console.log('Appending intermediate screenshot for taskId:', taskId, 'Path:', result.screenshotPath);
                  const screenshotsContainer = resultCard.querySelector('.screenshots');
                  if (screenshotsContainer) {
                    const img = document.createElement('img');
                    img.src = result.screenshotPath;
                    img.alt = 'Live Screenshot';
                    img.style.maxWidth = '100%';
                    img.style.marginTop = '10px';
                    img.style.display = 'block';
                    img.onerror = () => console.error('Image load failed:', result.screenshotPath);
                    img.onload = () => console.log('Image loaded:', result.screenshotPath);
                    screenshotsContainer.appendChild(img);
                  } else {
                    console.error('Screenshots container not found for taskId:', taskId);
                  }
                }
              });
            }

            // Handle subtask updates
            if (update.subTasks && Array.isArray(update.subTasks)) {
              update.subTasks.forEach((subTask, index) => {
                const taskElement = document.querySelector(`.active-task[data-task-id="${taskId}"]`);
                if (taskElement) {
                  const subProgressBar = taskElement.querySelector(`.subtask-progress-bar-${index}`);
                  if (subProgressBar) {
                    subProgressBar.style.width = `${subTask.progress || 0}%`;
                  }
                  const subStatusSpan = taskElement.querySelector(`.subtask-status-${index}`);
                  if (subStatusSpan) {
                    subStatusSpan.textContent = subTask.status;
                    subStatusSpan.className = `subtask-status ${subTask.status.toLowerCase()}`;
                  }
                }
              });
            }

            // Handle task completion
            if (update.done) {
              eventSource.close();
              const { status, result, error } = update;
              const summary = result?.aiPrepared?.summary || error || 'No summary available';
              const reportLink = result?.runReport
                ? `<a href="${result.runReport}" target="_blank" class="btn btn-primary btn-sm mt-2">View Report</a>`
                : '';

              console.log('Task execution done.......', result);
              if (!result) {
                loadChatHistory();
              }

              const aiMessage = document.createElement('div');
              aiMessage.className = 'chat-message ai-message animate-in';
              aiMessage.innerHTML = `
                <div class="message-content">
                  <p class="summary-text">${summary}</p>
                  <span class="timestamp">${new Date().toLocaleTimeString()}</span>
                </div>
              `;
              nliResults.prepend(aiMessage);
              nliResults.scrollTop = 0;
              saveChatMessage('assistant', summary);

              resultCard.querySelector('.result-header h4').innerHTML = `<i class="fas fa-globe"></i> ${result?.raw?.url || 'N/A'}`;

              // Update only the outputs div, preserving screenshots
              const outputsDiv = resultCard.querySelector('.outputs');
              outputsDiv.innerHTML = `
                <div class="toggle-buttons">
                  <button class="toggle-btn active" data-view="ai">AI Prepared</button>
                  <button class="toggle-btn" data-view="raw">Raw Output</button>
                </div>
                <div class="ai-output active">${result?.aiPrepared?.summary || 'No AI summary available.'}</div>
                <div class="raw-output">${result?.raw?.pageText || 'No raw output available.'}</div>
                ${reportLink}
              `;

              // Append final screenshot to the existing screenshots container
              const screenshotsContainer = resultCard.querySelector('.screenshots');
              if (result?.screenshotPath) {
                console.log('Appending final screenshot for taskId:', taskId, 'Path:', result.screenshotPath);
                const img = document.createElement('img');
                img.src = result.screenshotPath;
                img.alt = 'Final Screenshot';
                img.style.maxWidth = '100%';
                img.style.marginTop = '10px';
                img.style.display = 'block';
                img.onerror = () => console.error('Final image load failed:', result.screenshotPath);
                img.onload = () => console.log('Final image loaded:', result.screenshotPath);
                screenshotsContainer.appendChild(img);
              }

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

              const chatResult = {
                taskId,
                command: prompt,
                url: result?.raw?.url || 'N/A',
                output: result?.raw?.pageText || 'No raw output available.',
                aiOutput: result?.aiPrepared?.summary || 'No AI summary available.',
                timestamp: new Date(),
                screenshot: result?.screenshotPath,
                report: result?.runReport,
                status: status === 'error' ? 'error' : 'completed',
              };
              addToHistory(chatResult.url, chatResult.command, chatResult);

              updateTaskState(false);
              updateSentinelState('normal');

              // Refresh active tasks and history after completion
              loadActiveTasks();
              loadHistory();
            }
          };

          eventSource.onerror = () => {
            console.error('EventSource error for task:', taskId);
            eventSource.close();
            resultCard.querySelector('.result-header h4').innerHTML = `<i class="fas fa-globe"></i> Error`;
            resultCard.querySelector('.outputs').innerHTML = `<div class="error">Streaming failed</div>`;
            throw new Error('Error streaming task updates');
          };
        } else {
          // Chat response
          const summary = data.result.aiPrepared?.summary || 'No summary available';
          const aiMessage = document.createElement('div');
          aiMessage.className = 'chat-message ai-message animate-in';
          aiMessage.innerHTML = `
            <div class="message-content">
              <p class="summary-text">${summary}</p>
              <span class="timestamp">${new Date().toLocaleTimeString()}</span>
            </div>
          `;
          nliResults.prepend(aiMessage);
          nliResults.scrollTop = 0;

          saveChatMessage('assistant', summary);

          const chatResult = {
            taskId,
            command: prompt,
            url: 'N/A',
            output: summary,
            aiOutput: summary,
            timestamp: new Date(),
            screenshot: null,
            report: data.result.runReport || null,
            status: 'completed',
          };
          addToHistory(chatResult.url, chatResult.command, chatResult);

          updateTaskState(false);
          updateSentinelState('normal');
        }
      } catch (err) {
        showNotification(err.message, 'error');
        const errorMessage = document.createElement('div');
        errorMessage.className = 'chat-message ai-message animate-in';
        errorMessage.innerHTML = `
          <div class="message-content">
            <p class="summary-text error">Error: ${err.message}</p>
            <span class="timestamp">${new Date().toLocaleTimeString()}</span>
          </div>
        `;
        nliResults.prepend(errorMessage);
        nliResults.scrollTop = 0;

        saveChatMessage('assistant', `Error: ${err.message}`);

        const existingCard = document.querySelector(`.result-card[data-task-id="${taskId}"]`);
        if (existingCard) {
          existingCard.querySelector('.result-header h4').innerHTML = `<i class="fas fa-globe"></i> Error`;
          existingCard.querySelector('.outputs').innerHTML = `
            <div class="error">${err.message}</div>
          `;
        } else {
          const chatResult = {
            taskId,
            command: prompt,
            url: 'N/A',
            output: err.message,
            aiOutput: `Error: ${err.message}`,
            timestamp: new Date(),
            screenshot: null,
            report: null,
            status: 'error',
          };
          addToHistory(chatResult.url, chatResult.command, chatResult);
        }

        updateTaskState(false);
        updateSentinelState('normal');
      } finally {
        nliForm.querySelector('button[type="submit"]').disabled = false;
      }
    });
  }
});

document.getElementById('clear-results').addEventListener('click', clearTaskResults);

// Update clearTaskResults to reset animation state
function clearTaskResults() {
  taskResults = [];
  const outputContainer = document.getElementById('output-container');
  const aiResults = document.getElementById('ai-results');
  const rawResults = document.getElementById('raw-results');
  const sentinelCanvas = document.getElementById('sentinel-canvas');
  const sentinelFallback = document.getElementById('sentinel-fallback');

  if (aiResults) aiResults.innerHTML = '';
  if (rawResults) rawResults.innerHTML = '';
  if (outputContainer) {
    outputContainer.innerHTML = '<p id="no-results" class="text-muted">No results yet. Run a task to see output here.</p>';
    outputContainer.style.display = 'block';
  }

  if (sentinelCanvas) {
    if (isWebGLAvailable()) {
      //sentinelCanvas.style.display = 'block';
      //sentinelFallback.style.display = 'none';
      updateTaskState(false);
      updateSentinelState('idle'); // Reset to idle when results are cleared
    } else {
      //sentinelCanvas.style.display = 'none';
      //sentinelFallback.style.display = 'block';
    }
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
  
  loadActiveTasks();
  loadHistory();
  setInterval(() => { loadActiveTasks(); loadHistory(); }, 120000);
  
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
});

/******************** Helper: Toggle Task Tab ********************/
function toggleTaskTab(taskType) {
  document.querySelectorAll('.task-section').forEach(section => section.classList.remove('active'));
  if (taskType === 'nli') { document.getElementById('nli-section').classList.add('active'); }
  else if (taskType === 'manual') { document.getElementById('manual-section').classList.add('active'); }
  else if (taskType === 'active-tasks') { document.getElementById('active-tasks-section').classList.add('active'); }
  else if (taskType === 'repetitive') { document.getElementById('repetitive-section').classList.add('active'); }
  else if (taskType === 'scheduled') { document.getElementById('scheduled-section').classList.add('active'); }
  else if (taskType === 'sonic') { document.getElementById('sonic-section').classList.add('active'); }
}

/******************** Task Execution Functions ********************/
async function executeTaskWithAnimation(url, command, taskType) {
  try {
    showNotification("Task started – please wait...", "success");
    updateTaskState(true);
    const result = await executeTask(url, command);
    result.taskType = taskType;
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
    updateTaskState(false);
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
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url, command })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Task execution failed');
      
      const taskId = data.taskId;
      const eventSource = new EventSource(`/tasks/${taskId}/stream`);
      
      eventSource.onmessage = async (event) => {
        const update = JSON.parse(event.data);
        
        // Update progress
        if (update.progress) {
          updateTaskProgress(taskId, update.progress);
        }
      
        if (update.done) {
          eventSource.close();
          await loadActiveTasks(); // Refresh UI
          
          if (update.status === 'error') {
            reject(new Error(update.error || 'Task failed'));
            return;
          }
      
          // Fetch final result from history
          const historyItem = await fetchHistoryItem(taskId);
          if (!historyItem) {
            reject(new Error("Task result not found in history"));
            return;
          }
      
          // Structure the result
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
      
          // Handle task completion
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
    const res = await fetch(`/history/${taskId}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Failed to fetch history item');
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
    updateSentinelState('normal');
    updateTaskState(false);
    
    return true;
  } catch (err) {
    console.error('Error handling task result:', err);
    return false;
  }
}

// Helper to update task progress in UI
function updateTaskProgress(taskId, progress, status, error) {
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
    
    // Update subtasks if available in the DOM
    const subTasksContainer = taskElement.querySelector('.subtasks');
    if (subTasksContainer) {
      const subTaskElements = subTasksContainer.querySelectorAll('.subtask');
      subTaskElements.forEach((subElement, index) => {
        const subProgressBar = subElement.querySelector('.subtask-progress');
        if (subProgressBar) subProgressBar.style.width = `${progress / subTaskElements.length}%`; // Distribute overall progress
        const subStatusSpan = subElement.querySelector('.subtask-status');
        if (subStatusSpan) subStatusSpan.textContent = status;
      });
    }

    if (status === 'completed' || status === 'error') {
      loadActiveTasks();
      loadHistory();
    }
  }
}

function handleIntermediateResult(taskId, result) {
  const resultCard = document.querySelector(`.result-card[data-task-id="${taskId}"]`);
  if (resultCard && result.screenshotPath) {
    const screenshotsContainer = resultCard.querySelector('.screenshots');
    const img = document.createElement('img');
    img.src = result.screenshotPath;
    img.alt = 'Live Screenshot';
    img.style.maxWidth = '100%';
    img.style.marginTop = '10px';
    screenshotsContainer.appendChild(img);
  }
}

function handleTaskCompletion(taskId, status, result) {
  const outputContainer = document.getElementById('output-container');
  if (document.getElementById('no-results')) document.getElementById('no-results').remove();

  const resultCard = document.createElement('div');
  resultCard.className = 'result-card animate-in';
  console.log('Result card created with taskId:', taskId);
  resultCard.dataset.taskId = taskId;
  const timestamp = new Date();
  const formattedTime = timestamp.toLocaleTimeString() + ' ' + timestamp.toLocaleDateString();

  resultCard.innerHTML = `
    <div class="result-header">
      <h4><i class="fas fa-globe"></i> ${result.url || 'N/A'}</h4>
      <p><strong>Command:</strong> ${result.command || 'Unknown'}</p>
      <div class="meta">
        <span>${formattedTime}</span>
      </div>
    </div>
    <div class="result-content">
      <div class="toggle-buttons">
        <button class="toggle-btn active" data-view="ai">AI Prepared</button>
        <button class="toggle-btn" data-view="raw">Raw Output</button>
      </div>
      <div class="ai-output active">${result.aiPrepared?.summary || 'No summary available'}</div>
      <div class="raw-output">${result.raw?.pageText || 'No raw output'}</div>
      ${result.raw?.screenshotPath ? `<img src="${result.raw.screenshotPath}" alt="Final Screenshot" style="max-width: 100%; margin-top: 10px;">` : ''}
      ${result.runReport ? `<a href="${result.runReport}" target="_blank" class="btn btn-primary btn-sm mt-2">View Report</a>` : ''}
    </div>
  `;
  outputContainer.prepend(resultCard);
  outputContainer.style.display = 'block';
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
  document.getElementById('sentinel-canvas').style.display = 'none';
  document.getElementById('sentinel-fallback').style.display = 'none';
  outputContainer.style.display = 'block';
  showNotification('Task result added!', 'success');
}

// Enhanced loadActiveTasks function
async function loadActiveTasks() {
  try {
    const response = await fetch('/tasks/active', { credentials: 'same-origin' });
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = '/login.html';
        return;
      }
      throw new Error(`Failed to load active tasks: ${response.statusText}`);
    }

    const tasks = await response.json();
    activeTasks = tasks;
    const tasksContainer = document.getElementById('active-tasks-container');

    if (!tasks || tasks.length === 0) {
      tasksContainer.innerHTML = '<p id="no-active-tasks" class="text-muted">No active tasks. Run a task to see it here.</p>';
      updateActiveTasksTab();
      return;
    }

    tasksContainer.innerHTML = '';
    tasks.forEach(task => {
      const taskElement = createTaskElement(task);
      tasksContainer.appendChild(taskElement);
    });

    updateActiveTasksTab();
  } catch (error) {
    console.error('Error loading active tasks:', error);
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
    <div class="task-url"><i class="fas fa-link"></i> ${task.url}</div>
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
  element.querySelector('.cancel-task-btn').addEventListener('click', async () => {
    try {
      const response = await fetch(`/tasks/${task._id}/cancel`, { method: 'POST', credentials: 'same-origin' });
      const result = await response.json();
      if (result.success) {
        showNotification('Task canceled successfully!');
        element.remove();
      } else {
        showNotification(result.error, 'error');
      }
    } catch (err) {
      showNotification('Error canceling task: ' + err.message, 'error');
    }
  });
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
    const response = await fetch(`/history?page=${page}&limit=${limit}`, { credentials: 'include' });

    // Handle redirects (e.g., to login page)
    if (response.redirected || response.status === 401) {
      window.location.href = '/login.html';
      return;
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
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

  const taskId = e.currentTarget.dataset.taskId; // Use e.currentTarget instead of this
  const popup = document.getElementById('history-popup');
  const details = document.getElementById('history-details-content');

  fetch(`/history/${taskId}`, { credentials: 'include' })
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
      if (item) {
        const result = item.result || {};
        const aiPrepared = result.aiPrepared || {};
        const raw = result.raw || {};

        // Prepare AI Summary
        let aiSummary = 'No summary available';
        if (typeof aiPrepared.summary === 'string') {
          aiSummary = aiPrepared.summary;
        } else if (aiPrepared.summary && typeof aiPrepared.summary === 'object') {
          if (aiPrepared.summary.summary && typeof aiPrepared.summary.summary === 'string') {
            aiSummary = aiPrepared.summary.summary;
          } else {
            aiSummary = JSON.stringify(aiPrepared.summary, null, 2);
          }
        } else if (aiPrepared.subtasks && aiPrepared.subtasks.length > 0) {
          const subtaskSummaries = aiPrepared.subtasks
            .map((subtask, i) => subtask.summary ? `Subtask ${i + 1}: ${subtask.summary}` : null)
            .filter(Boolean);
          if (subtaskSummaries.length > 0) {
            aiSummary = subtaskSummaries.join('\n');
          }
        } else if (aiPrepared && Object.keys(aiPrepared).length > 0) {
          aiSummary = JSON.stringify(aiPrepared, null, 2);
        }

        details.innerHTML = `
          <h4 style="color: #e8e8e8; margin-bottom: 15px;">Task Details</h4>
          <p style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0;">
            <strong>Command:</strong> ${item.command}
          </p>
          <p style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0;">
            <strong>URL:</strong> ${item.url}
          </p>
          <p style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0;">
            <strong>Timestamp:</strong> ${new Date(item.timestamp).toLocaleString()}
          </p>
          <h4 style="color: #e8e8e8; margin-top: 20px; margin-bottom: 15px;">AI Summary</h4>
          <p style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0; white-space: pre-wrap; max-height: 200px; overflow-y: auto;">
            ${aiSummary}
          </p>
          ${aiPrepared.subtasks && Array.isArray(aiPrepared.subtasks) ? `
            <h4 style="color: #e8e8e8; margin-top: 20px; margin-bottom: 15px;">Subtasks</h4>
            ${aiPrepared.subtasks.map((subtask, i) => `
              <div class="ai-result" style="margin-bottom: 15px;">
                <h5 style="color: #e8e8e8; margin-bottom: 10px;">Subtask ${i + 1}</h5>
                <p style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0; white-space: pre-wrap;">
                  ${subtask.summary || 'No summary'}
                </p>
                ${subtask.data ? `
                  <pre style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">
                    ${typeof subtask.data === 'object' ? JSON.stringify(subtask.data, null, 2) : subtask.data}
                  </pre>
                ` : ''}
              </div>
            `).join('')}
          ` : ''}
          <h4 style="color: #e8e8e8; margin-top: 20px; margin-bottom: 15px;">Raw Output</h4>
          ${Array.isArray(raw) ? raw.map(r => `
            ${r.screenshotPath ? `<img src="${r.screenshotPath}" alt="Screenshot" style="max-width: 100%; border-radius: 5px; margin: 10px 0;">` : ''}
            <pre style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">
              ${r.pageText || 'No text'}
            </pre>
          `).join('') : `
            ${raw.screenshotPath ? `<img src="${raw.screenshotPath}" alt="Screenshot" style="max-width: 100%; border-radius: 5px; margin: 10px 0;">` : ''}
            <pre style="color: #e8e8e8; background: #222; padding: 10px; border-radius: 5px; margin: 5px 0; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">
              ${raw.pageText || 'No text'}
            </pre>
          `}
          ${result.runReport ? `
            <a href="${result.runReport}" target="_blank" class="btn btn-primary btn-sm" style="display: inline-block; margin-top: 10px; padding: 8px 16px; background: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">
              Read Report
            </a>
          ` : ''}
        `;

        popup.classList.add('active');

        // Add close button event listener
        document.getElementById('close-history-popup').onclick = () => {
          popup.classList.remove('active');
        };

        // Close on background click
        popup.onclick = (e) => {
          if (e.target === popup) {
            popup.classList.remove('active');
          }
        };

        // Close on escape key
        const escapeHandler = (e) => {
          if (e.key === 'Escape') {
            popup.classList.remove('active');
            document.removeEventListener('keydown', escapeHandler);
          }
        };
        document.addEventListener('keydown', escapeHandler);
      } else {
        showNotification('History item not found', 'error');
      }
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
    <p>URL: ${url}</p>
    <div class="meta">
      <span>${formattedTime}</span>
      <div class="share-buttons">
        <a href="#" onclick="event.stopPropagation(); rerunHistoryTask('${taskId}', '${url}', '${escapedCommand}')">
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
  loadHistory();
  
  // Clear history button handler
  const clearHistoryButton = document.getElementById('clear-history');
  if (clearHistoryButton) {
    clearHistoryButton.addEventListener('click', async () => {
      try {
        const response = await fetch('/history', {
          method: 'DELETE',
          credentials: 'include',
        });
        
        if (!response.ok) throw new Error('Failed to clear history');
        
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
    await fetch(`/history/${taskId}`, { method: 'DELETE', credentials: 'include' });
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
