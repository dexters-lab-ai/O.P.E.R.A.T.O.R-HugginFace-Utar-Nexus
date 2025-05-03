/**
 * GuideOverlay.jsx - Enhanced Guide Component for Nexus
 * A comprehensive and user-friendly guide with tabbed interface
 */

import { eventBus } from '../utils/events.js';

// Create a singleton instance
let guideOverlayInstance = null;

// Factory function to get or create the instance
export function getGuideOverlay() {
  if (!guideOverlayInstance) {
    guideOverlayInstance = new GuideOverlay();
  }
  return guideOverlayInstance;
}

class GuideOverlay {
  constructor() {
    this.isVisible = false;
    this.activeTab = 'main';
    this.containerId = 'guide-overlay';
    this.overlay = null;
    this.container = null;
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initialize());
    } else {
      this.initialize();
    }
  }
  
  initialize() {
    // Create container if it doesn't exist
    this.container = document.createElement('div');
    this.container.id = this.containerId + '-container';
    
    // Create overlay container
    this.overlay = document.createElement('div');
    this.overlay.className = 'guide-overlay';
    this.overlay.id = this.containerId;
    
    // Create main content
    const content = this.createContent();
    this.overlay.appendChild(content);
    
    // Add to DOM
    this.container.appendChild(this.overlay);
    document.body.appendChild(this.container);
    
    // Setup event listeners
    this.setupEventListeners();
  }
  
  createContent() {
    const content = document.createElement('div');
    content.className = 'guide-content';
    
    // Header with close button
    const header = document.createElement('div');
    header.className = 'guide-header';
    header.innerHTML = `
      <h2>Nexus Guide</h2>
      <button class="close-btn"><i class="fas fa-times"></i></button>
    `;
    
    // Tabs navigation
    const tabsNav = document.createElement('div');
    tabsNav.className = 'guide-tabs-nav';
    tabsNav.innerHTML = `
      <button class="tab-btn active" data-tab="main">Main</button>
      <button class="tab-btn" data-tab="getting-started">Getting Started</button>
      <button class="tab-btn" data-tab="tasks">Task Management</button>
      <button class="tab-btn" data-tab="llm">LLM Engines</button>
      <button class="tab-btn" data-tab="advanced">Advanced Features</button>
      <button class="tab-btn" data-tab="tips">Tips & Tricks</button>
    `;
    
    // Tabs content container
    const tabsContent = document.createElement('div');
    tabsContent.className = 'guide-tabs-content';
    
    // Create each tab content
    const mainTab = this.createMainTab();
    const gettingStartedTab = this.createGettingStartedTab();
    const tasksTab = this.createTasksTab();
    const llmTab = this.createLLMTab();
    const advancedTab = this.createAdvancedTab();
    const tipsTab = this.createTipsTab();
    
    // Set active tab
    mainTab.classList.add('active');
    
    // Add tabs to content
    tabsContent.appendChild(mainTab);
    tabsContent.appendChild(gettingStartedTab);
    tabsContent.appendChild(tasksTab);
    tabsContent.appendChild(llmTab);
    tabsContent.appendChild(advancedTab);
    tabsContent.appendChild(tipsTab);
    
    // Assemble content
    content.appendChild(header);
    content.appendChild(tabsNav);
    content.appendChild(tabsContent);
    
    return content;
  }
  
  createMainTab() {
    const tab = document.createElement('div');
    tab.className = 'guide-tab';
    tab.dataset.tab = 'main';
    
    tab.innerHTML = `
      <div class="guide-section">
        <h3>Welcome to Nexus</h3>
        <p>Nexus is your intelligent task management and automation platform powered by advanced language models.</p>
        
        <div class="video-container">
          <div class="video-placeholder">
            <i class="fas fa-play-circle"></i>
            <p>Watch Demo Video</p>
          </div>
        </div>
        
        <div class="guide-highlights">
          <div class="highlight-item">
            <i class="fas fa-brain"></i>
            <h4>AI-Powered</h4>
            <p>Harness the power of advanced language models to complete complex tasks</p>
          </div>
          <div class="highlight-item">
            <i class="fas fa-tasks"></i>
            <h4>Task Management</h4>
            <p>Efficiently track and manage all your tasks in one place</p>
          </div>
          <div class="highlight-item">
            <i class="fas fa-chart-line"></i>
            <h4>Insights</h4>
            <p>Gain valuable insights from detailed reports and analytics</p>
          </div>
          <div class="highlight-item">
            <i class="fas fa-cogs"></i>
            <h4>Customizable</h4>
            <p>Configure Nexus to work exactly how you need it</p>
          </div>
        </div>
      </div>
      
      <div class="guide-section">
        <h3>Quick Start</h3>
        <ol class="quick-start-steps">
          <li>
            <h4>Enter a task in the Command Center</h4>
            <p>Type what you want Nexus to help you with in the input field at the bottom of the screen.</p>
          </li>
          <li>
            <h4>Submit your task</h4>
            <p>Press Enter or click the Submit button to start processing your task.</p>
          </li>
          <li>
            <h4>Review results</h4>
            <p>Nexus will process your task and provide detailed results in the timeline.</p>
          </li>
          <li>
            <h4>Access history</h4>
            <p>View all your past tasks and results in the History section for future reference.</p>
          </li>
        </ol>
        
        <div class="guide-cta">
          <button class="tab-link-btn" data-tab="getting-started">Explore Detailed Guide</button>
        </div>
      </div>
    `;
    
    return tab;
  }
  
  createGettingStartedTab() {
    const tab = document.createElement('div');
    tab.className = 'guide-tab';
    tab.dataset.tab = 'getting-started';
    
    tab.innerHTML = `
      <div class="guide-section">
        <h3>Getting Started with Nexus</h3>
        <p>Nexus is designed to be intuitive and powerful, helping you automate tasks with AI assistance.</p>
        
        <div class="guide-subsection">
          <h4>The Nexus Interface</h4>
          <div class="guide-image-container">
            <div class="guide-image-placeholder">
              <i class="fas fa-desktop"></i>
              <p>Interface Overview</p>
            </div>
          </div>
          <p>The Nexus interface consists of several key components:</p>
          <ul>
            <li><strong>Command Center</strong> - Located at the bottom of the screen, this is where you enter your tasks and queries.</li>
            <li><strong>Message Timeline</strong> - The central area displays the conversation history and task results.</li>
            <li><strong>Navigation Bar</strong> - Access settings, history, and this guide from the top navigation.</li>
            <li><strong>Task Bar</strong> - Monitor active and recently completed tasks.</li>
          </ul>
        </div>
        
        <div class="guide-subsection">
          <h4>Your First Task</h4>
          <p>Let's walk through creating your first task in Nexus:</p>
          <ol>
            <li><strong>Navigate to the Command Center</strong> at the bottom of the screen</li>
            <li><strong>Enter a clear, specific request</strong>, such as "Research the latest developments in renewable energy"</li>
            <li><strong>Submit your task</strong> by pressing Enter or clicking the Send button</li>
            <li><strong>Watch as Nexus processes</strong> your request, showing real-time progress</li>
            <li><strong>Review the results</strong> in the Message Timeline</li>
            <li><strong>Save or reference</strong> the output for future use</li>
          </ol>
        </div>
      </div>
      
      <div class="guide-section">
        <h3>Interacting with the AI</h3>
        <p>Nexus uses advanced language models to understand and process your requests. Here are some tips for effective communication:</p>
        
        <div class="guide-tips-grid">
          <div class="guide-tip-card">
            <i class="fas fa-bullseye"></i>
            <h4>Be Specific</h4>
            <p>Clearly state what you need and provide relevant details for better results.</p>
          </div>
          <div class="guide-tip-card">
            <i class="fas fa-list-ol"></i>
            <h4>Structure Complex Requests</h4>
            <p>Break down complex tasks into steps or bullet points for clarity.</p>
          </div>
          <div class="guide-tip-card">
            <i class="fas fa-comment-dots"></i>
            <h4>Follow-up is Welcome</h4>
            <p>You can ask clarifying questions or request adjustments to the results.</p>
          </div>
          <div class="guide-tip-card">
            <i class="fas fa-lightbulb"></i>
            <h4>Provide Context</h4>
            <p>Include relevant background information or preferences when appropriate.</p>
          </div>
        </div>
      </div>
    `;
    
    return tab;
  }
  
  createTasksTab() {
    const tab = document.createElement('div');
    tab.className = 'guide-tab';
    tab.dataset.tab = 'tasks';
    
    tab.innerHTML = `
      <div class="guide-section">
        <h3>Task Management</h3>
        <p>Nexus provides powerful tools for managing, tracking, and analyzing your tasks.</p>
        
        <div class="guide-subsection">
          <h4>Task Lifecycle</h4>
          <div class="task-lifecycle">
            <div class="lifecycle-step">
              <div class="step-number">1</div>
              <h5>Creation</h5>
              <p>Enter task in Command Center</p>
            </div>
            <div class="lifecycle-connector"><i class="fas fa-arrow-right"></i></div>
            <div class="lifecycle-step">
              <div class="step-number">2</div>
              <h5>Processing</h5>
              <p>AI analyzes and works on your task</p>
            </div>
            <div class="lifecycle-connector"><i class="fas fa-arrow-right"></i></div>
            <div class="lifecycle-step">
              <div class="step-number">3</div>
              <h5>Completion</h5>
              <p>Results are displayed in timeline</p>
            </div>
            <div class="lifecycle-connector"><i class="fas fa-arrow-right"></i></div>
            <div class="lifecycle-step">
              <div class="step-number">4</div>
              <h5>Storage</h5>
              <p>Task saved to history for later reference</p>
            </div>
          </div>
        </div>
        
        <div class="guide-subsection">
          <h4>Progress Tracking</h4>
          <p>Monitor the progress of your active tasks through:</p>
          <ul>
            <li><strong>Task Bar</strong> - Shows active tasks with progress indicators</li>
            <li><strong>Timeline Updates</strong> - Real-time updates appear as your task progresses</li>
            <li><strong>Notifications</strong> - Receive alerts when tasks are completed or need attention</li>
          </ul>
        </div>
      </div>
      
      <div class="guide-section">
        <h3>History and Reporting</h3>
        <p>Access comprehensive reports and historical data to gain insights from your tasks.</p>
        
        <div class="guide-subsection">
          <h4>Accessing History</h4>
          <p>Open the History modal from the navigation bar to view all past tasks. From there, you can:</p>
          <ul>
            <li>Filter tasks by date, type, or status</li>
            <li>Search for specific keywords across all tasks</li>
            <li>View detailed reports for each completed task</li>
            <li>Delete tasks that are no longer needed</li>
          </ul>
        </div>
        
        <div class="guide-subsection">
          <h4>Reports and Analytics</h4>
          <p>Each completed task generates a detailed report that includes:</p>
          <ul>
            <li><strong>Task Summary</strong> - Overview of the task and results</li>
            <li><strong>Process Details</strong> - Step-by-step breakdown of how the task was completed</li>
            <li><strong>Resource Usage</strong> - Information about the AI models and resources used</li>
            <li><strong>Performance Metrics</strong> - Time taken, efficiency insights, and other metrics</li>
          </ul>
          <p>These reports help you understand how Nexus approaches different tasks and can inform your future requests.</p>
        </div>
      </div>
    `;
    
    return tab;
  }
  
  createLLMTab() {
    const tab = document.createElement('div');
    tab.className = 'guide-tab';
    tab.dataset.tab = 'llm';
    
    tab.innerHTML = `
      <div class="guide-section">
        <h3>Language Model Engines</h3>
        <p>Nexus provides access to multiple state-of-the-art language models, each with unique capabilities and strengths.</p>
        
        <div class="guide-subsection">
          <h4>Available Models</h4>
          <div class="llm-models-grid">
            <div class="llm-model-card">
              <div class="model-header gpt4">
                <h5>GPT-4</h5>
                <span class="model-provider">OpenAI</span>
              </div>
              <div class="model-body">
                <p class="model-description">Advanced reasoning and problem-solving capabilities for complex tasks.</p>
                <div class="model-strengths">
                  <div class="strength-item"><i class="fas fa-check"></i> Complex reasoning</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Long context handling</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Advanced task planning</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Nuanced instruction following</div>
                </div>
                <p class="model-best-for">Best for: Research, planning, creative tasks, and complex problem-solving</p>
              </div>
            </div>
            
            <div class="llm-model-card">
              <div class="model-header gpt3">
                <h5>GPT-3.5 Turbo</h5>
                <span class="model-provider">OpenAI</span>
              </div>
              <div class="model-body">
                <p class="model-description">Fast, efficient processing for straightforward tasks with good performance.</p>
                <div class="model-strengths">
                  <div class="strength-item"><i class="fas fa-check"></i> Quick responses</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Efficient processing</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Good general knowledge</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Lower resource usage</div>
                </div>
                <p class="model-best-for">Best for: Quick questions, summaries, content generation, and simpler tasks</p>
              </div>
            </div>
            
            <div class="llm-model-card">
              <div class="model-header claude-opus">
                <h5>Claude 3 Opus</h5>
                <span class="model-provider">Anthropic</span>
              </div>
              <div class="model-body">
                <p class="model-description">Exceptional reasoning and thoughtful analysis with strong accuracy.</p>
                <div class="model-strengths">
                  <div class="strength-item"><i class="fas fa-check"></i> Deep reasoning</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Nuanced analysis</div>
                  <div class="strength-item"><i class="fas fa-check"></i> High ethical awareness</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Detailed explanations</div>
                </div>
                <p class="model-best-for">Best for: Detailed analysis, academic content, ethical reasoning, and complex explanations</p>
              </div>
            </div>
            
            <div class="llm-model-card">
              <div class="model-header claude-sonnet">
                <h5>Claude 3 Sonnet</h5>
                <span class="model-provider">Anthropic</span>
              </div>
              <div class="model-body">
                <p class="model-description">Balance of performance and quality with strong general capabilities.</p>
                <div class="model-strengths">
                  <div class="strength-item"><i class="fas fa-check"></i> Balanced performance</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Good reasoning</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Efficient processing</div>
                  <div class="strength-item"><i class="fas fa-check"></i> Clear communication</div>
                </div>
                <p class="model-best-for">Best for: Day-to-day tasks, balanced workloads, content generation, and general assistance</p>
              </div>
            </div>
          </div>
        </div>
        
        <div class="guide-subsection">
          <h4>Configuring Model Preferences</h4>
          <p>You can configure which models Nexus uses for different types of tasks in the Settings menu:</p>
          <ol>
            <li>Open the <strong>Settings</strong> from the navigation bar</li>
            <li>Navigate to the <strong>LLM Engines</strong> tab</li>
            <li>Set your <strong>Default Model</strong> for general tasks</li>
            <li>Optionally configure specific models for different task types:
              <ul>
                <li><strong>Code Generation</strong> - For programming and technical tasks</li>
                <li><strong>Content Creation</strong> - For writing and creative tasks</li>
                <li><strong>Research & Analysis</strong> - For data analysis and research tasks</li>
              </ul>
            </li>
            <li>Save your preferences</li>
          </ol>
          <p>Nexus will automatically use your preferred models for different types of tasks, optimizing for both quality and efficiency.</p>
        </div>
      </div>
    `;
    
    return tab;
  }
  
  createAdvancedTab() {
    const tab = document.createElement('div');
    tab.className = 'guide-tab';
    tab.dataset.tab = 'advanced';
    
    tab.innerHTML = `
      <div class="guide-section">
        <h3>Advanced Features</h3>
        <p>Nexus offers a range of advanced capabilities for power users and specialized workflows.</p>
        
        <div class="guide-subsection">
          <h4>API Integration</h4>
          <p>Configure API keys in Settings to enable Nexus to interact with external services:</p>
          <ul>
            <li><strong>OpenAI API</strong> - For GPT model access</li>
            <li><strong>Anthropic API</strong> - For Claude model access</li>
            <li><strong>Google API</strong> - For search and other Google services</li>
            <li><strong>Midscene API</strong> - For integrated web browsing and automation</li>
          </ul>
          <p>With these integrations, Nexus can perform research, access external data, and automate web-based tasks.</p>
        </div>
        
        <div class="guide-subsection">
          <h4>Custom Workflows</h4>
          <p>Create specialized workflows for repeated tasks by:</p>
          <ol>
            <li>Developing a clear task template with specific parameters</li>
            <li>Saving successful tasks as templates in the History view</li>
            <li>Using structured prompts with consistent formatting</li>
            <li>Creating workflow sequences by linking multiple tasks</li>
          </ol>
          <p>This allows you to streamline recurring processes and ensure consistent results.</p>
        </div>
      </div>
      
      <div class="guide-section">
        <h3>Export and Sharing</h3>
        <p>Share your Nexus results and task outputs in various formats:</p>
        
        <div class="export-options-grid">
          <div class="export-option">
            <i class="fas fa-file-pdf"></i>
            <h4>PDF Reports</h4>
            <p>Export comprehensive reports with all task details, steps, and results.</p>
          </div>
          <div class="export-option">
            <i class="fas fa-file-code"></i>
            <h4>Code Files</h4>
            <p>Extract and save generated code with proper formatting and syntax highlighting.</p>
          </div>
          <div class="export-option">
            <i class="fas fa-file-alt"></i>
            <h4>Text Content</h4>
            <p>Copy or export text content for use in other applications.</p>
          </div>
          <div class="export-option">
            <i class="fas fa-share-alt"></i>
            <h4>Direct Sharing</h4>
            <p>Share task results via email or direct links to collaborative workspaces.</p>
          </div>
        </div>
        
        <p class="note"><i class="fas fa-info-circle"></i> Access export options from the task menu in the Message Timeline or from detailed views in the History section.</p>
      </div>
    `;
    
    return tab;
  }
  
  createTipsTab() {
    const tab = document.createElement('div');
    tab.className = 'guide-tab';
    tab.dataset.tab = 'tips';
    
    tab.innerHTML = `
      <div class="guide-section">
        <h3>Tips & Best Practices</h3>
        <p>Get the most out of Nexus with these expert tips and strategies.</p>
        
        <div class="guide-tips-list">
          <div class="guide-tip">
            <div class="tip-number">01</div>
            <div class="tip-content">
              <h4>Craft Clear Instructions</h4>
              <p>Be specific about your requirements, including format preferences, level of detail, and any constraints. The more precise your instructions, the better the results.</p>
              <div class="tip-example">
                <strong>Instead of:</strong> "Write about renewable energy"<br>
                <strong>Try:</strong> "Create a 500-word summary of recent advances in solar panel efficiency for a technical audience, focusing on breakthroughs from the last 2 years."
              </div>
            </div>
          </div>
          
          <div class="guide-tip">
            <div class="tip-number">02</div>
            <div class="tip-content">
              <h4>Iterate and Refine</h4>
              <p>Don't expect perfect results on the first try. Use follow-up requests to refine outputs, provide additional context, or ask for specific changes.</p>
              <div class="tip-example">
                <strong>Follow-up example:</strong> "That's great. Now could you expand on the section about perovskite solar cells, particularly their durability challenges?"
              </div>
            </div>
          </div>
          
          <div class="guide-tip">
            <div class="tip-number">03</div>
            <div class="tip-content">
              <h4>Choose the Right Model</h4>
              <p>Match the language model to your task type. Use more powerful models (GPT-4, Claude 3 Opus) for complex reasoning tasks, and faster models for simpler tasks.</p>
            </div>
          </div>
          
          <div class="guide-tip">
            <div class="tip-number">04</div>
            <div class="tip-content">
              <h4>Break Down Complex Tasks</h4>
              <p>Split complex projects into smaller, more manageable subtasks. This helps maintain focus and allows for more specific instructions.</p>
            </div>
          </div>
          
          <div class="guide-tip">
            <div class="tip-number">05</div>
            <div class="tip-content">
              <h4>Use Templates for Consistency</h4>
              <p>Develop templates for recurring tasks to ensure consistent formatting and completeness in the results.</p>
            </div>
          </div>
        </div>
      </div>
      
      <div class="guide-section">
        <h3>Common Use Cases</h3>
        <p>Explore some of the most popular ways to leverage Nexus in your workflow:</p>
        
        <div class="use-cases-grid">
          <div class="use-case-card">
            <div class="use-case-icon"><i class="fas fa-search"></i></div>
            <h4>Research Assistant</h4>
            <p>Generate summaries of complex topics, literature reviews, and synthesize information from multiple sources.</p>
            <div class="use-case-example">
              "Research the latest treatments for type 2 diabetes and summarize the most promising approaches from clinical trials published in the last year."
            </div>
          </div>
          
          <div class="use-case-card">
            <div class="use-case-icon"><i class="fas fa-code"></i></div>
            <h4>Code Generation</h4>
            <p>Create code snippets, debug existing code, and get help with programming tasks across multiple languages.</p>
            <div class="use-case-example">
              "Help me create a React component that displays a sortable table with pagination and filtering options."
            </div>
          </div>
          
          <div class="use-case-card">
            <div class="use-case-icon"><i class="fas fa-edit"></i></div>
            <h4>Content Creation</h4>
            <p>Draft articles, reports, emails, and other written content with specific tones, formats, and purposes.</p>
            <div class="use-case-example">
              "Draft a professional email announcing our new product launch to our customer base, highlighting the key features and early access options."
            </div>
          </div>
          
          <div class="use-case-card">
            <div class="use-case-icon"><i class="fas fa-chart-bar"></i></div>
            <h4>Data Analysis</h4>
            <p>Interpret data, generate insights, and create data processing scripts or visualization code.</p>
            <div class="use-case-example">
              "Analyze this CSV data of monthly sales figures and help me identify seasonal trends and anomalies."
            </div>
          </div>
        </div>
      </div>
    `;
    
    return tab;
  }
  
  // Setting up event listeners
  setupEventListeners() {
    // Close on overlay click (outside content)
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });
    
    // Close button
    const closeBtn = this.overlay.querySelector('.close-btn');
    closeBtn.addEventListener('click', () => this.hide());
    
    // Tab switching
    const tabBtns = this.overlay.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });
    
    // Tab links within content
    const tabLinkBtns = this.overlay.querySelectorAll('.tab-link-btn');
    tabLinkBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      });
    });
    
    // Video placeholder click
    const videoPlaceholder = this.overlay.querySelector('.video-placeholder');
    if (videoPlaceholder) {
      videoPlaceholder.addEventListener('click', () => {
        // Replace with actual video embed
        const videoContainer = this.overlay.querySelector('.video-container');
        videoContainer.innerHTML = `
          <iframe width="100%" height="315" 
            src="https://www.youtube.com/embed/placeholder" 
            title="Nexus Demo Video" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen>
          </iframe>
        `;
      });
    }
  }
  
  switchTab(tabId) {
    // Update active tab
    this.activeTab = tabId;
    
    // Update tab buttons
    const tabBtns = this.overlay.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      if (btn.dataset.tab === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    // Update tab content
    const tabContents = this.overlay.querySelectorAll('.guide-tab');
    tabContents.forEach(tab => {
      if (tab.dataset.tab === tabId) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }
  
  show() {
    if (!this.isVisible) {
      this.overlay.classList.add('visible');
      this.isVisible = true;
    }
  }
  
  hide() {
    if (this.isVisible) {
      this.overlay.classList.remove('visible');
      this.isVisible = false;
    }
  }
  
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
}

// Export the factory function
export default getGuideOverlay;
