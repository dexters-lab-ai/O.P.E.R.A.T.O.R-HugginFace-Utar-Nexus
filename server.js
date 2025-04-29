// ======================================
// 1) ENV & CORE LIBRARIES
// ======================================
import dotenv from 'dotenv';
dotenv.config();

import path             from 'path';
import fs               from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import express          from 'express';
import { createServer } from 'http';
import session          from 'express-session';
import MongoStore       from 'connect-mongo';
import mongoose         from 'mongoose';
import winston          from 'winston';
import { WebSocketServer, WebSocket } from 'ws';
import pRetry           from 'p-retry';
import { v4 as uuidv4 } from 'uuid';
import { Semaphore }    from 'async-mutex';
import cors             from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';

// Puppeteer extras
import puppeteerExtra   from 'puppeteer-extra';
import StealthPlugin    from 'puppeteer-extra-plugin-stealth';
import { PuppeteerAgent } from '@midscene/web/puppeteer';

// OpenAI SDK
import OpenAI from 'openai';

// ======================================
// 3) MODEL IMPORTS
// ======================================
import User        from './src/models/User.js';
import Message     from './src/models/Message.js';
import Task        from './src/models/Task.js';
import ChatHistory from './src/models/ChatHistory.js';

// ======================================
// 4) UTILS & REPORT GENERATORS
// ======================================
import { stripLargeFields }         from './src/utils/stripLargeFields.js';
import { generateReport }           from './src/utils/reportGenerator.js';
import { editMidsceneReport }       from './src/utils/midsceneReportEditor.js';

// ======================================
// 5) GLOBAL CONFIGURATION
// ======================================
mongoose.set('strictQuery', true);

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const OPENAI_API_KAIL = process.env.OPENAI_API_KAIL;

// Puppeteer concurrency limiter
puppeteerExtra.use(StealthPlugin());
const browserSemaphore = new Semaphore(5);

// OpenAI “fallback” client (used for non‑user‑key operations)
// Use either OPENAI_API_KEY or fallback to OPENAI_API_KAIL
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KAIL });

// Ensure run/report directories exist
const MIDSCENE_RUN_DIR = path.join(__dirname, 'midscene_run');
fs.mkdirSync(MIDSCENE_RUN_DIR, { recursive: true });
const REPORT_DIR = path.join(MIDSCENE_RUN_DIR, 'report');
fs.mkdirSync(REPORT_DIR, { recursive: true });

// ======================================
// 6) EXPRESS + HTTP SERVER
// ======================================
const app    = express();
const server = createServer(app);

// ======================================
// 7) MIDDLEWARE (ORDER MATTERS)
// ======================================
// 7.1 Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 7.2 Session store (must come before any route that reads/writes req.session)
const MONGO_URI = process.env.MONGO_URI;
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI, collectionName: 'sessions' }),
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// 7.3 Debug logger for sessions
app.use((req, res, next) => {
  console.log('👉 Session:', req.sessionID, req.session);
  next();
});

// Proxy middleware for Vite development server
const viteProxy = createProxyMiddleware({
  target: 'http://localhost:3000',
  changeOrigin: true,
  ws: true,
  logLevel: 'debug'
});

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    const originIsWhitelisted = origin && origin.startsWith('http://localhost');
    callback(null, originIsWhitelisted);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin.startsWith('http://localhost')) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendors', express.static(path.join(__dirname, 'public', 'vendors'), {
  setHeaders: (res, path) => {
    if (path.match(/\.(woff2?|ttf|otf|eot)$/)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }
}));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/images', express.static(path.join(__dirname, 'public', 'assets', 'images')));
app.use('/midscene_run', express.static(MIDSCENE_RUN_DIR));
app.use('/models', express.static('public/models'));
app.use('/draco', express.static('public/draco'));

// Proxy requests to Vite development server in development mode
if (process.env.NODE_ENV === 'development') {
  app.use(viteProxy);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
}

// Serve default favicon
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/assets/images/dail-fav.png'));
});

// ======================================
// 8) ROUTES & MIDDLEWARE IMPORTS
// ======================================
import authRouter       from './src/routes/auth.js';
import historyRouter    from './src/routes/history.js';
import tasksRouter      from './src/routes/tasks.js';
import customUrlsRouter from './src/routes/customUrls.js';
import settingsRouter   from './src/routes/settings.js';
import { requireAuth }  from './src/middleware/requireAuth.js';
import serveStaticAssets from './src/middleware/staticAssets.js';

// Serve /login for SPA compatibility (redirects /login → /login.html)
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Root route - serve appropriate interface
app.get('/', (req, res) => {
  if (req.session.user) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    res.redirect('/login.html');
  }
});

// ======================================
// 9) ROUTERS (after session middleware)
// ======================================
app.use('/auth', authRouter);
app.use('/settings', settingsRouter);

app.use('/history',    requireAuth, historyRouter);
import messagesRouter from './src/routes/messages.js';
app.use('/messages', requireAuth, messagesRouter);
app.use('/tasks',      requireAuth, tasksRouter);
app.use('/custom-urls', requireAuth, customUrlsRouter);

// Support legacy /logout path
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('Logout error:', err);
    res.redirect('/login.html');
  });
});

// Serve PWA static assets
serveStaticAssets(app);

// ======================================
// 10) HTML ENDPOINTS & FALLBACK
// ======================================

// -) protect your SPA “shell” routes
const guard = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login.html')
  next()
}

// Loop over the other .html endpoints
const pages = ['history', 'guide', 'settings'];
pages.forEach(page => {
  app.get(`/${page}.html`, guard, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', `${page}.html`));
  });
});

// Old interface should be accessible without auth
app.get('/old.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'old.html'));
});

// the app shell
app.get('/', guard, (req, res) => {
  // note: index.html is now in dist/
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// ======================================
// 11) WEBSOCKET SETUP
// ======================================
const userConnections = new Map();
const unsentMessages  = new Map();
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  let userIdParam = req.url.split('userId=')[1]?.split('&')[0];
  const userId = decodeURIComponent(userIdParam || '');
  console.debug('[DEBUG] WebSocket connection received for userId:', userId);
  if (!userId) {
    console.error('[WebSocket] Connection rejected: Missing userId');
    ws.send(JSON.stringify({ event: 'error', message: 'Missing userId' }));
    ws.close();
    return;
  }
  ws.userId = userId;
  const userWsSet = userConnections.get(userId) || new Set();
  userWsSet.add(ws);
  userConnections.set(userId, userWsSet);
  console.log(`[WebSocket] Connected: userId=${userId}, total connections=${userWsSet.size}`);

  if (unsentMessages.has(userId)) {
    const queuedMessages = unsentMessages.get(userId);
    queuedMessages.forEach(message => {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error(`[WebSocket] Failed to send queued message to userId=${userId}:`, error);
      }
    });
    unsentMessages.delete(userId);
  }

  ws.on('close', () => {
    const userWsSet = userConnections.get(userId);
    if (userWsSet) {
      userWsSet.delete(ws);
      if (userWsSet.size === 0) {
        userConnections.delete(userId);
      }
      console.log(`[WebSocket] Disconnected: userId=${userId}, remaining connections=${userWsSet.size}`);
    }
  });

  ws.on('error', (error) => {
    console.error(`[WebSocket] Error for userId=${userId}:`, error);
  });
});

// ======================================
// 12) LOGGER
// ======================================
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

// ======================================
// 13) STARTUP: DB CONNECT & SERVER LISTEN
// ======================================
async function startApp() {
  try {
    await pRetry(connectToMongoDB, {
      retries: 5,
      minTimeout: 2000,
      onFailedAttempt: error => {
        console.log(`MongoDB connection attempt ${error.attemptNumber} failed. Retrying...`);
      }
    });
    console.log('✅ MongoDB connected');
    //await clearDatabaseOnce();
    //await ensureIndexes();
    
    const PORT = process.env.PORT || 3420;
    server.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
    console.log('✅ Application started successfully');
  } catch (err) {
    console.error('Failed to start application:', err);
    process.exit(1);
  }
}

await startApp();

// Graceful shutdown on SIGINT.
process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  try {
    server.close(() => {
      console.log('HTTP server closed.');
    });
    await mongoose.connection.close();
    console.log('Mongoose connection closed.');
  } catch (error) {
    console.error('Error during shutdown:', error);
  } finally {
    process.exit(0);
  }
});

process.on('uncaughtException', (err) => { 
  console.error('Uncaught Exception:', err); 
  process.exit(1); 
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Utility sleep function.
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendWebSocketUpdate(userId, data) {
  console.debug('[DEBUG] sendWebSocketUpdate: userId', userId, 'connections', userConnections.get(userId) ? userConnections.get(userId).size : 0);
  const connections = userConnections.get(userId);
  if (connections && connections.size > 0) {
    connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(data));
        } catch (error) {
          console.error(`[WebSocket] Failed to send to userId=${userId}:`, error);
        }
      } else {
        console.warn(`[WebSocket] Skipping closed connection for userId=${userId}`);
      }
    });
  } else {
    console.debug(`[WebSocket] No active connections for userId=${userId}. Queuing message.`);
    if (!unsentMessages.has(userId)) {
      unsentMessages.set(userId, []);
    }
    unsentMessages.get(userId).push(data);
  }
}

/**
 * Clear the database once.
 */
async function clearDatabaseOnce() {
  const flagFile = path.join(__dirname, 'db_cleared.flag');
  if (fs.existsSync(flagFile)) {
    console.log('Database already cleared, skipping clear operation.');
    return;
  }
  try {
    //await User.deleteMany({});
    await ChatHistory.deleteMany({});
    await Task.deleteMany({});
    console.log('Successfully cleared User, ChatHistory, and Task collections.');
    fs.writeFileSync(flagFile, 'Database cleared on ' + new Date().toISOString());
    console.log('Created db_cleared.flag to mark database clear completion.');
  } catch (err) {
    console.error('Error clearing database:', err);
  }
}

async function connectToMongoDB() {
  const startTime = Date.now();
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });
    console.log(`Connected to MongoDB in ${Date.now() - startTime}ms`);
  } catch (err) {
    console.error('Mongoose connection error:', err);
    throw new pRetry.AbortError('MongoDB connection failed after retries');
  }
}

async function ensureIndexes() {
  try {
    await User.ensureIndexes();
    console.log('User indexes ensured');

    await Task.ensureIndexes();
    console.log('Task indexes ensured');
  } catch (err) {
    console.error('Error ensuring indexes:', err);
  }
}

/**
 * Update task in database and notify clients.
 * @param {string} taskId - Task ID
 * @param {Object} updates - Updates to apply
 */
async function updateTaskInDatabase(taskId, updates) {
  if (typeof updates !== 'object' || updates === null) {
    console.error(`[Database] Invalid updates parameter: expected an object, received ${typeof updates}`);
    return;
  }
  console.log(`[Database] Updating task ${taskId}:`, updates);
  try {
    // Atomically update task and retrieve the modified document
    const task = await Task.findByIdAndUpdate(
      new mongoose.Types.ObjectId(taskId),
      { $set: updates },
      { new: true }
    );
    if (!task) {
      console.error(`[Database] Task ${taskId} not found`);
      return;
    }
    let eventName;
    if (updates.status === 'pending') eventName = 'taskStart';
    else if (updates.status === 'completed') eventName = 'taskComplete';
    else if (updates.status === 'error') eventName = 'taskError';
    else if ('progress' in updates) eventName = 'stepProgress';
    else if ('intermediateResults' in updates) eventName = 'intermediateResult';
    else eventName = 'taskUpdate';
    sendWebSocketUpdate(task.userId.toString(), { event: eventName, payload: { taskId, ...updates } });
  } catch (error) {
    console.error(`[Database] Error updating task:`, error);
  }
}

/**
 * Process task completion and generate reports.
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {Array} intermediateResults - Intermediate results
 * @param {string} originalPrompt - Original user prompt
 * @param {string} runDir - Run directory
 * @param {string} runId - Run ID
 * @returns {Object} - Final result
 */
async function processTaskCompletion(userId, taskId, intermediateResults, originalPrompt, runDir, runId) {
  console.log(`[TaskCompletion] Processing completion for task ${taskId}`);
  try {
    let finalScreenshot = null;
    let lastTaskId = null;
    let agent = null;
    if (intermediateResults.length > 0) {
      const lastResult = intermediateResults[intermediateResults.length - 1];
      if (lastResult.task_id && activeBrowsers.has(lastResult.task_id)) {
        lastTaskId = lastResult.task_id;
        const { page, agent: activeAgent } = activeBrowsers.get(lastTaskId);
        finalScreenshot = await page.screenshot({ encoding: 'base64' });
        agent = activeAgent;
      }
      if (lastResult.screenshot) finalScreenshot = lastResult.screenshot;
    }
    let finalScreenshotUrl = null;
    if (finalScreenshot) {
      const finalScreenshotPath = path.join(runDir, `final-screenshot-${Date.now()}.png`);
      fs.writeFileSync(finalScreenshotPath, Buffer.from(finalScreenshot, 'base64'));
      console.log(`[TaskCompletion] Saved final screenshot to ${finalScreenshotPath}`);
      finalScreenshotUrl = `/midscene_run/${runId}/${path.basename(finalScreenshotPath)}`;
    }

    const landingReportPath = await generateReport(
      originalPrompt,
      intermediateResults,
      finalScreenshotUrl,
      runId,
      REPORT_DIR
    );
    let midsceneReportPath = null;
    let midsceneReportUrl = null;
    if (agent) {
      await agent.writeOutActionDumps();
      midsceneReportPath = agent.reportFile;
      if (midsceneReportPath && fs.existsSync(midsceneReportPath)) {
        midsceneReportPath = await editMidsceneReport(midsceneReportPath);
        midsceneReportUrl = `/midscene_run/report/${path.basename(midsceneReportPath)}`;
      }
    }

    const rawPageText = intermediateResults
      .map(step => (step && step.result && step.result.extractedInfo) || '')
      .join('\n');

    const currentUrl = (intermediateResults[intermediateResults.length - 1]?.result?.currentUrl) || 'N/A';
    const summary = intermediateResults[intermediateResults.length - 1]?.result?.actionOutput ||
      `Task execution completed for: ${originalPrompt}`;

    // Compose a full result object for success (all fields, nulls for missing)
    const finalResult = {
      success: true,
      taskId,
      raw: {
        pageText: rawPageText,
        url: currentUrl
      },
      aiPrepared: {
        summary: summary
      },
      screenshot: finalScreenshotUrl,
      steps: intermediateResults.map(step => step.getSummary ? step.getSummary() : step),
      landingReportUrl: landingReportPath ? `/midscene_run/report/${path.basename(landingReportPath)}` : null,
      midsceneReportUrl: midsceneReportUrl || null,
      runReport: landingReportPath ? `/midscene_run/report/${path.basename(landingReportPath)}` : null, // alias for frontend
      intermediateResults: intermediateResults || [],
      error: null,
      reportUrl: null // for error compatibility
    };

    return finalResult;
  } catch (error) {
    console.error(`[TaskCompletion] Error:`, error);
    const errorReportFile = `error-report-${Date.now()}.html`;
    const errorReportPath = path.join(REPORT_DIR, errorReportFile);
    fs.writeFileSync(errorReportPath, `Error Report: ${error.message}`);
    // Compose a full result object for error (all fields, nulls for missing, error fields set)
    return {
      success: false,
      taskId,
      raw: { pageText: null, url: null },
      aiPrepared: { summary: null },
      screenshot: null,
      steps: [],
      landingReportUrl: null,
      midsceneReportUrl: null,
      runReport: null,
      intermediateResults: [],
      error: error.message,
      reportUrl: `/midscene_run/report/${errorReportFile}`
    };
  } finally {
    if (activeBrowsers.size > 0) {
      for (const [id, session] of activeBrowsers.entries()) {
        if (!session.closed) {
          try {
            await session.browser.close();
            if (typeof session.release === 'function') {
              try {
                session.release();
              } catch (e) {
                console.debug(`[TaskCompletion] Error releasing semaphore for session ${id}:`, e);
              }
            } else {
              console.error(`[TaskCompletion] release is not a function for session ${id}, skipping release`);
            }
            session.closed = true;
            activeBrowsers.delete(id);
            console.log(`[TaskCompletion] Closed browser session ${id}`);
          } catch (error) {
            console.error(`[TaskCompletion] Error closing browser session ${id}:`, error);
          }
        }
      }
    }
  }
}

// Sessions map - shared across the application
const activeBrowsers = new Map();

/**
 * TaskPlan - Class to manage the execution plan for a browser task
 */
class TaskPlan {
  constructor(userId, taskId, prompt, initialUrl, runDir, runId, maxSteps = 10) {
    this.userId = userId;
    this.taskId = taskId;
    this.prompt = prompt;
    this.initialUrl = initialUrl;
    this.runDir = runDir;
    this.runId = runId;
    this.steps = [];
    this.currentStepIndex = -1;
    this.maxSteps = maxSteps;
    this.currentState = [];          // Array to store all state objects (assertions, page states, etc.)
    this.extractedInfo = [];         // Array to keep a history of extracted info
    this.navigatableElements = [];   // Array to hold navigable elements (can be cumulative)
    this.planLog = [];
    this.completed = false;
    this.summary = null;    
    this.currentUrl = initialUrl || 'Not specified';
    // Store the user's OpenAI API key for use in PuppeteerAgent initialization.
    this.userOpenaiKey = null; 
  }

  log(message, metadata = {}) {
    const entry = { timestamp: new Date().toISOString(), message, ...metadata };
    this.planLog.push(entry);
    console.log(`[Task ${this.taskId}] ${message}`, metadata);
  }

  /**
   * Create a new step in the plan.
   * After execution, a short step summary is generated and stored in step.stepSummary.
   * @param {string} type - 'action' or 'query'
   * @param {string} instruction - Instruction for the step
   * @param {Object} args - Associated arguments
   * @returns {PlanStep} - The created step.
   */
  createStep(type, instruction, args) {
    const step = {
      index: this.steps.length,
      type,
      instruction,
      args,
      status: 'pending',
      result: null,
      error: null,
      execute: async (plan) => {
        try {
          step.status = 'running';
          plan.log(`Executing step ${step.index + 1}: ${step.type} - ${step.instruction}`);
          let result;
          if (step.type === 'action') {
            result = await plan.executeBrowserAction(step.args, step.index);
          } else {
            result = await plan.executeBrowserQuery(step.args, step.index);
          }
          step.result = result;
          step.status = result.success ? 'completed' : 'failed';
          plan.currentUrl = result.currentUrl || plan.currentUrl;
          if (result.state) {
            plan.updateGlobalState(result);
          }
          plan.log(`Step ${step.index + 1} ${step.status}`);
          return result;
        } catch (error) {
          step.status = 'failed';
          step.error = error.message;
          plan.log(`Step ${step.index + 1} failed: ${error.message}`, { stack: error.stack });
          return { success: false, error: error.message, currentUrl: plan.currentUrl };
        }
      },
      getSummary: () => ({
        index: step.index,
        type: step.type,
        instruction: step.instruction,
        status: step.status,
        success: step.result?.success || false,
        stepSummary: step.stepSummary || 'No summary'
      })
    };
    this.steps.push(step);
    this.currentStepIndex = this.steps.length - 1;
    return step;
  }

  getCurrentStep() {
    if (this.currentStepIndex >= 0 && this.currentStepIndex < this.steps.length) {
      return this.steps[this.currentStepIndex];
    }
    return null;
  }

  markCompleted(summary) {
    this.completed = true;
    this.summary = summary;
    this.log(`Task marked as completed: ${summary}`);
  }

   /**
   * Helper method to update globals when a result is received.
   */
   updateGlobalState(result) {
    if (result.state && result.state.assertion) {
      this.currentState.push({ assertion: result.state.assertion });
    } else if (this.currentState.length === 0) {
      this.currentState.push({ assertion: 'No assertion available' });
    }
    
    let extracted = 'No extracted info available';
    if (result.extractedInfo) {
      if (typeof result.extractedInfo === 'object' && result.extractedInfo.pageContent) {
        extracted = result.extractedInfo.pageContent;
      } else if (typeof result.extractedInfo === 'string') {
        extracted = result.extractedInfo;
      }
    }
    this.extractedInfo.push(extracted);
    
    if (result.navigableElements && Array.isArray(result.navigableElements)) {
      this.navigatableElements = this.navigatableElements.concat(result.navigableElements);
    } else if (this.navigatableElements.length === 0) {
      this.navigatableElements = [];
    }
  }

  /**
   * Generate a system prompt that includes progress and state details.
   * @returns {string} - The generated system prompt.
   */
  generateSystemPrompt() {
    const latestState = (Array.isArray(this.currentState) && this.currentState.length)
      ? this.currentState[this.currentState.length - 1]
      : { assertion: 'No assertion available' };
    const assertionSummary = latestState.assertion || 'No assertion available';

    const latestExtracted = (Array.isArray(this.extractedInfo) && this.extractedInfo.length)
      ? this.extractedInfo[this.extractedInfo.length - 1]
      : 'No extracted info available';
    const extractedSummary = latestExtracted
      ? latestExtracted.substring(0, 700) + '...'
      : 'No extracted info available';

    const progressSummary = this.steps.length > 0
      ? this.steps.map(step => 
          `- Step ${step.index + 1}: ${step.type.toUpperCase()} - ${step.instruction} (${step.status})`
        ).join('\n')
      : 'No steps executed yet';

    const lastStepSummary = (this.steps.length > 0 && this.steps[this.steps.length - 1].stepSummary)
      ? this.steps[this.steps.length - 1].stepSummary
      : 'No summary available';

    const recentFailures = this.steps.slice(-3)
      .filter(step => step.status === 'failed')
      .map(step => 
        `- Step ${step.index + 1}: ${step.instruction} failed (${step.error || 'Unknown error'})`
      ).join('\n') || 'No recent failures';

    return `
You are an AI assistant automating browser tasks with resilience and adaptability. 
You never fail to accomplish the task and reason all steps until you accomplish it. 
You always instruct towards achieving the "Main Task".

GUIDELINES:
1. PERSISTENCE: Never give up on a task. If one approach fails, try alternative methods.
2. AUTONOMY: You must determine steps needed without user input after initial request.
3. PLANNING: You can take in a plan and execute it, or create a step-by-step plan based on previous results.
4. ADAPTABILITY: Adjust your plan based on new information.
5. COMMUNICATION: Clearly explain your actions and reasoning.
6. PROGRESS TRACKING: Indicate task progress and status.
7. EXTRACTING DATA: Always provide instructions to extract all necessary page data.
8. NAVIGATION EFFICIENCY: Check the current page before navigating.
9. NEXT STEP PRECISION: Plan incremental steps based on the latest state and data.
CURRENT TASK: "${this.prompt}"
Starting URL: ${this.initialUrl || 'Not specified'}
Current Step: ${this.currentStepIndex + 1} of ${this.maxSteps}
Current URL: ${this.currentUrl || 'Not yet navigated'}

PROGRESS SUMMARY (based on previous step): ${lastStepSummary}
FULL STEP SUMMARY:
${progressSummary}
Recent Failures:
${recentFailures}
Extracted Information:
- ${extractedSummary}
Assertion (Page State):
- ${assertionSummary}

[END OF SUMMARY]

Proceed with actions toward the Main Task: "${this.prompt}".
    `.trim();
  }

  getSummary() {
    return {
      taskId: this.taskId,
      prompt: this.prompt,
      initialUrl: this.initialUrl,
      currentUrl: this.currentUrl,
      steps: this.steps.map(step => step.getSummary()),
      completed: this.completed,
      summary: this.summary,
      planLog: this.planLog,
      currentStepIndex: this.currentStepIndex,
      maxSteps: this.maxSteps
    };
  }

  async executeBrowserAction(args, stepIndex) {
    return await handleBrowserAction(
      args,
      this.userId,
      this.taskId,
      this.runId,
      this.runDir,
      stepIndex,
      this.browserSession
    );
  }

  async executeBrowserQuery(args, stepIndex) {
    return await handleBrowserQuery(
      args,
      this.userId,
      this.taskId,
      this.runId,
      this.runDir,
      stepIndex,
      this.browserSession
    );
  }

  updateBrowserSession(session) {
    this.browserSession = session;
    if (session && session.currentUrl) {
      this.currentUrl = session.currentUrl;
    }
    this.log(`Updated browser session, current URL: ${this.currentUrl}`);
  }
}

/**
 * PlanStep - Class to manage an individual step in the execution plan
 */
class PlanStep {
  constructor(index, type, instruction, args, userId, taskId, runDir) {
    this.index = index;
    this.type = type;
    this.instruction = instruction;
    this.args = args;
    this.userId = userId;
    this.taskId = taskId;
    this.runDir = runDir;
    this.status = 'pending';
    this.result = null;
    this.startTime = new Date();
    this.endTime = null;
    this.logs = [];
    this.error = null;
    this.stepSummary = null; 
  }

  log(message, data = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      step: this.index,
      message,
      data: data ? (typeof data === 'object' ? JSON.stringify(data) : data) : null
    };
    this.logs.push(logEntry);
    console.log(`[PlanStep:${this.index}] ${message}`);
  }

  async generateStepSummary() {
    if (this.stepSummary) return this.stepSummary;
    try {
      const summaryResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'Summarize the following step result in at most 5 tokens:' },
          { role: 'user', content: JSON.stringify(this.getSummary()) }
        ],
        temperature: 0,
        max_tokens: 5
      });
      const summary = summaryResponse.choices[0].message.content.trim();
      this.stepSummary = summary;
      return summary;
    } catch (error) {
      console.error(`Error generating step summary: ${error.message}`);
      this.stepSummary = 'No summary';
      return this.stepSummary;
    }
  }

  async execute(plan) {
    this.log(`Starting execution: ${this.type} - ${this.instruction}`);
    this.status = 'running';
    
    try {
      const trimmedStepLogs = this.logs.map(entry => {
        const shortMsg = entry.message.length > 150 ? entry.message.substring(0, 150) + '...' : entry.message;
        return { ...entry, message: shortMsg };
      });
      sendWebSocketUpdate(this.userId, { 
        event: 'stepProgress', 
        taskId: this.taskId, 
        stepIndex: this.index, 
        progress: 10, 
        message: `Starting: ${this.instruction}`,
        log: trimmedStepLogs
      });
  
      let result;
      if (this.type === 'action') {
        result = await plan.executeBrowserAction(this.args, this.index);
      } else {
        result = await plan.executeBrowserQuery(this.args, this.index);
      }
      this.result = result;
      this.status = result.success ? 'completed' : 'failed';
      this.endTime = new Date();
      
      // Update the plan’s global state.
      plan.updateGlobalState(result);
      plan.extractedInfo = result.extractedInfo || 'No content extracted';
      plan.updateBrowserSession({ currentUrl: result.currentUrl });
      if (result.state) {
        plan.currentState = result.state;
      } else {
        plan.currentState = {
          pageDescription: 'No content extracted',
          navigableElements: [],
          currentUrl: result.currentUrl || plan.currentUrl
        };
      }
  
      const trimmedActionLogs = (result.actionLog || []).map(entry => {
        const shortMsg = entry.message.length > 150 ? entry.message.substring(0, 150) + '...' : entry.message;
        return { ...entry, message: shortMsg };
      });
  
      const finalTrimmedStepLogs = this.logs.map(entry => {
        const shortMsg = entry.message.length > 150 ? entry.message.substring(0, 150) + '...' : entry.message;
        return { ...entry, message: shortMsg };
      });
  
      sendWebSocketUpdate(this.userId, { 
        event: 'stepProgress', 
        taskId: this.taskId, 
        stepIndex: this.index, 
        progress: 100, 
        message: this.status === 'completed' ? 'Step completed' : 'Step failed',
        log: [...finalTrimmedStepLogs, ...trimmedActionLogs]
      });
  
      console.log(`[Task ${this.taskId}] Step ${this.index} completed`, {
        status: this.status,
        type: this.type,
        url: result.currentUrl
      });
      
      await this.generateStepSummary();
  
      return result;
    } catch (error) {
      this.log(`Error executing step: ${error.message}`);
      this.status = 'failed';
      this.endTime = new Date();
      this.error = error.message;
      
      const trimmedLogs = this.logs.map(entry => {
        const shortMsg = entry.message.length > 150 ? entry.message.substring(0, 150) + '...' : entry.message;
        return { ...entry, message: shortMsg };
      });
  
      sendWebSocketUpdate(this.userId, { 
        event: 'stepProgress', 
        taskId: this.taskId, 
        stepIndex: this.index, 
        progress: 100, 
        message: `Error: ${error.message}`,
        log: trimmedLogs
      });
      
      console.log(`[Task ${this.taskId}] Step ${this.index} failed`, { error: error.message });
      
      return {
        success: false,
        error: error.message,
        actionLog: trimmedLogs,
        currentUrl: plan.currentUrl,
        task_id: this.taskId,
        stepIndex: this.index
      };
    }
  }

  getSummary() {
    return {
      index: this.index,
      type: this.type,
      instruction: this.instruction,
      args: this.args,
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.endTime ? (this.endTime - this.startTime) : null,
      resultSummary: this.result ? {
        success: this.result.success,
        currentUrl: this.result.currentUrl,
        error: this.result.error,
        extractedInfo: this.result.extractedInfo,
        navigableElements: this.result.navigableElements
      } : null,
      logs: this.logs,
      error: this.error,
      stepSummary: this.stepSummary
    };
  }
}

/**
 * Get an OpenAI client for this user, falling back to DEFAULT_OPENAI if
 * they haven't yet saved their own key.
 */
async function getUserOpenAiClient(userId) {
  const DEFAULT_OPENAI_API_KEY = process.env.OPENAI_API_KAIL;
  const user = await User
    .findById(userId)
    .select('openaiApiKey')
    .lean();

  // Use their key if present and non‑empty, otherwise our hard‑coded fallback.
  const apiKey = (user?.openaiApiKey && user.openaiApiKey.trim().length > 0)
    ? user.openaiApiKey.trim()
    : DEFAULT_OPENAI_API_KEY;

  return new OpenAI({ apiKey });
}

/**
 * Enhanced browser action handler with comprehensive logging and obstacle management
 * @param {Object} args - Action arguments
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID
 * @param {string} runDir - Run directory
 * @param {number} currentStep - Current step number
 * @param {Object} existingSession - Existing browser session
 * @returns {Object} - Result of the action
 */
async function handleBrowserAction(args, userId, taskId, runId, runDir, currentStep = 0, existingSession) {
  console.log(`[BrowserAction] Received currentStep: ${currentStep}`); // Debug log
  const openaiClient = await getUserOpenAiClient(userId);
  const { command, url: providedUrl } = args;
  let browser, agent, page, release;

  const actionLog = [];
  const logAction = (message, data = null) => {
    actionLog.push({ timestamp: new Date().toISOString(), step: currentStep, message, data: data ? JSON.stringify(data) : null });
    console.log(`[BrowserAction][Step ${currentStep}] ${message}`, data || '');
  };

  try {
    logAction(`Starting action with command: "${command}", URL: "${providedUrl || 'none provided'}"`);

    // Determine if it's a navigation command and set effective URL.
    const isNavigationCommand = command.toLowerCase().startsWith('navigate to ');
    let effectiveUrl;
    if (isNavigationCommand) {
      const navigateMatch = command.match(/navigate to (\S+)/i);
      if (navigateMatch) {
        effectiveUrl = navigateMatch[1];
        logAction(`Extracted URL from command: ${effectiveUrl}`);
      } else {
        throw new Error("Invalid navigate to command: no URL found");
      }
    } else {
      effectiveUrl = providedUrl;
    }

    // Validate URL for new tasks.
    if (!existingSession && !effectiveUrl) {
      throw new Error("URL required for new tasks");
    }

    // Override session using taskId to ensure unique session per task
    args.task_id = taskId;
    existingSession = activeBrowsers.get(taskId);

    // Browser session management.
    if (existingSession) {
      logAction("Using existing browser session");
      ({ browser, agent, page, release } = existingSession);
      
      // If the page is invalid or closed, create a new one.
      if (!page || page.isClosed()) {
        logAction("Page is invalid or closed, creating a new one");
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
        agent = new PuppeteerAgent(page, { 
          provider: 'huggingface', 
          apiKey: process.env.HF_API_KEY, 
          model: 'bytedance/ui-tars-72b'
        });
        activeBrowsers.set(taskId, { browser, agent, page, release, closed: false, hasReleased: false });
      }

      // Force navigation if a navigation command is provided and the current URL differs from the target.
      const currentPageUrl = await page.url();
      if (isNavigationCommand && effectiveUrl && currentPageUrl !== effectiveUrl) {
        logAction(`Navigating from ${currentPageUrl} to new URL: ${effectiveUrl}`);
        await page.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
        logAction("Navigation completed successfully");
      }
    } else if (taskId && activeBrowsers.has(taskId)) {
      logAction("Retrieving existing browser session from active browsers");
      ({ browser, agent, page, release } = activeBrowsers.get(taskId));
      if (!page || page.isClosed()) {
        logAction("Page is invalid or closed, creating a new one");
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
        agent = new PuppeteerAgent(page, {
          provider: 'huggingface',
          apiKey: process.env.HF_API_KEY,
          model: 'bytedance/ui-tars-72b'
        });
        activeBrowsers.set(taskId, { browser, agent, page, release, closed: false, hasReleased: false });
      }
    } else {
      // Create new session and navigate.
      logAction(`Creating new browser session and navigating to URL: ${effectiveUrl}`);
      release = await browserSemaphore.acquire();
      logAction("Acquired browser semaphore");
      
      process.env.OPENAI_API_KEY = OPENAI_API_KAIL;
      browser = await puppeteerExtra.launch({ 
        headless: false, 
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
        defaultViewport: { width: 1280, height: 720 }
      });
      logAction("Browser launched successfully");
      page = await browser.newPage();
      logAction("New page created");
      await page.setDefaultNavigationTimeout(300000); // 60 seconds
      
      // Set up listeners.
      page.on('console', msg => {
        debugLog(`Console: ${msg.text().substring(0, 150)}`);
      });
      page.on('pageerror', err => {
        debugLog(`Page error: ${err.message}`);
      });
      page.on('request', req => {
        if (['document', 'script', 'xhr', 'fetch'].includes(req.resourceType()) &&
            !req.url().includes("challenges.cloudflare.com")) {
          debugLog(`Request: ${req.method()} ${req.url().substring(0, 100)}`);
        }
      });
      page.on('response', res => {
        if (['document', 'script', 'xhr', 'fetch'].includes(res.request().resourceType()) &&
            !res.url().includes("challenges.cloudflare.com")) {
          debugLog(`Response: ${res.status()} ${res.url().substring(0, 100)}`);
        }
      });
      
      logAction(`Navigating to URL: ${effectiveUrl}`);
      await page.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
      logAction("Navigation completed successfully");
      
      agent = new PuppeteerAgent(page, { 
        provider: 'huggingface', 
        apiKey: process.env.HF_API_KEY, 
        model: 'bytedance/ui-tars-72b'
      });
      logAction("PuppeteerAgent initialized");
      activeBrowsers.set(taskId, { browser, agent, page, release, closed: false, hasReleased: false });
      logAction("Browser session stored in active browsers");
    }

    // Progress update.
    sendWebSocketUpdate(userId, { 
      event: 'stepProgress', 
      taskId, 
      stepIndex: currentStep, 
      progress: 30, 
      message: `Executing: ${command}`,
      log: actionLog
    });

    // Set viewport.
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    logAction("Set viewport to 1280x720");

    // Handle page obstacles.
    logAction("Checking for page obstacles");
    const obstacleResults = await handlePageObstacles(page, agent);
    logAction("Obstacle check results", obstacleResults);

    // Execute action (only for non-navigation commands).
    logAction(`Executing action: "${command}"`);
    await agent.aiAction(command);

    logAction("Action executed successfully");

    // Check for popups.
    const popupCheck = await page.evaluate(() => {
      return {
        url: window.location.href,
        popupOpened: window.opener !== null,
        numFrames: window.frames.length,
        alerts: document.querySelectorAll('[role="alert"]').length
      };
    });
    logAction("Post-action popup check", popupCheck);

    if (popupCheck.popupOpened) {
      logAction("Popup detected - checking for new pages");
      const pages = await browser.pages();
      if (pages.length > 1) {
        logAction(`Found ${pages.length} pages, switching to newest`);
        const newPage = pages[pages.length - 1];
        if (newPage !== page) {
          page = newPage;
          agent = new PuppeteerAgent(page);
          logAction("Switched to new page and reinitialized agent");
        }
      }
    }

    // Extract rich context (extractedInfo remains separate).
    logAction("Extracting rich page context");
    const { pageContent: extractedInfo, navigableElements } = await extractRichPageContext(
      agent, 
      page, 
      command,
      "Read, scan and observe the page. Then state - What information is now visible on the page? What can be clicked or interacted with?"
    );
    logAction("Rich context extraction complete", { 
      contentLength: typeof extractedInfo === 'string' ? extractedInfo.length : 'object',
      navigableElements: navigableElements.length
    });

    // Capture screenshot.
    const screenshotFilename = `screenshot-${Date.now()}.png`;
    const screenshotPath = path.join(runDir, screenshotFilename);
    const screenshot = await page.screenshot({ encoding: 'base64' });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
    const screenshotUrl = `/midscene_run/${runId}/${screenshotFilename}`;
    logAction("Screenshot captured and saved", { path: screenshotPath });

    const currentUrl = await page.url();
    logAction(`Current URL: ${currentUrl}`);

    console.log('[Server] Preparing to send intermediateResult for taskId:', taskId);
    // Send intermediate result update to the front end.
    sendWebSocketUpdate(userId, {
      event: 'intermediateResult',
      taskId,
      result: {
        screenshotUrl,   
        currentUrl,
        extractedInfo,    // Raw extracted info.
        navigableElements
      }
    });
    console.log('[Server] Sent intermediateResult for taskId:', taskId);

    // Final progress update.
    sendWebSocketUpdate(userId, { 
      event: 'stepProgress', 
      taskId, 
      stepIndex: currentStep, 
      progress: 100, 
      message: 'Action completed',
      log: actionLog
    });

    // Trim action log before returning.
    const trimmedActionLog = actionLog.map(entry => {
      const truncatedMessage = entry.message.length > 700 
        ? entry.message.substring(0, 700) + '...'
        : entry.message;
      return { ...entry, message: truncatedMessage };
    });

    // Return full results.
    // Note: "state" contains only the assertion result.
    return {
      success: true,
      error: null,
      task_id: taskId,
      closed: false,
      currentUrl,
      stepIndex: currentStep,
      actionOutput: `Completed: ${command}`,
      pageTitle: await page.title(),
      extractedInfo,        // Full extraction data.
      navigableElements,      // Navigable elements.
      actionLog: trimmedActionLog,
      screenshotPath: screenshotUrl,
      state: {
        assertion: extractedInfo && extractedInfo.pageContent 
        ? extractedInfo.pageContent 
        : 'No content extracted'
      }
    };

  } catch (error) {
    logAction(`Error in browser action: ${error.message}`, { stack: error.stack });
    if (typeof release === 'function') release();

    // Trim action log on error.
    const trimmedActionLog = actionLog.map(entry => {
      const shortMsg = entry.message.length > 150 
        ? entry.message.substring(0, 150) + '...'
        : entry.message;
      return { ...entry, message: shortMsg };
    });

    return {
      success: false,
      error: error.message,
      actionLog: trimmedActionLog,
      currentUrl: page ? await page.url() : null,
      task_id: taskId,
      stepIndex: currentStep
    };
  }
}

/**
 * Enhanced browser query handler with improved logging, obstacle management,
 * and inclusion of a "state" property that holds a concise assertion of the page.
 * @param {Object} args - Query arguments
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID 
 * @param {string} runDir - Run directory
 * @param {number} currentStep - Current step number
 * @param {Object} existingSession - Existing browser session
 * @returns {Object} - Result of the query including state.
 */
async function handleBrowserQuery(args, userId, taskId, runId, runDir, currentStep = 0, existingSession) {
  console.log(`[BrowserQuery] Received currentStep: ${currentStep}`);
  const openaiClient = await getUserOpenAiClient(userId);
  const { query, url: providedUrl } = args;
  let browser, agent, page, release;

  const actionLog = [];
  const logQuery = (message, data = null) => {
    actionLog.push({ timestamp: new Date().toISOString(), step: currentStep, message, data: data ? JSON.stringify(data) : null });
    console.log(`[BrowserQuery][Step ${currentStep}] ${message}`);
  };

  await updateTaskInDatabase(taskId, {
    status: 'processing',
    progress: 50,
    lastAction: query
  });

  try {
    logQuery(`Starting query: "${query}"`);

    const taskKey = taskId;

    if (existingSession) {
      logQuery("Using existing browser session");
      ({ browser, agent, page, release } = existingSession);
      if (!page || page.isClosed()) {
        logQuery("Page is invalid or closed, creating a new one");
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
        agent = new PuppeteerAgent(page, {
          provider: 'huggingface',
          apiKey: process.env.HF_API_KEY,
          model: 'bytedance/ui-tars-72b'
        });
        activeBrowsers.set(taskId, { browser, agent, page, release, closed: false, hasReleased: false });
      }
    } else if (taskKey && activeBrowsers.has(taskKey)) {
      const session = activeBrowsers.get(taskKey);
      if (!session || !session.browser) {
        logQuery("Browser session not valid, creating a new one.");
        process.env.OPENAI_API_KEY = OPENAI_API_KAIL;
        browser = await puppeteerExtra.launch({ 
          headless: false,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
          defaultViewport: { width: 1280, height: 720 }
        });
        logQuery("Browser launched successfully");
        page = await browser.newPage();
        logQuery("New page created");
        await page.setDefaultNavigationTimeout(60000); // 60 seconds
        agent = new PuppeteerAgent(page, {
          provider: 'huggingface',
          apiKey: process.env.HF_API_KEY,
          model: 'bytedance/ui-tars-72b'
        });
        release = null;
        activeBrowsers.set(taskKey, { browser, agent, page, release, closed: false, hasReleased: false });
      } else {
        ({ browser, agent, page, release } = session);
      }
    } else {
      if (!providedUrl) throw new Error("URL required for new tasks");
      logQuery(`Creating new browser session for URL: ${providedUrl}`);
      release = await browserSemaphore.acquire();
      logQuery("Acquired browser semaphore");
      process.env.OPENAI_API_KEY = OPENAI_API_KAIL;
      browser = await puppeteerExtra.launch({ 
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
        defaultViewport: { width: 1280, height: 720 }
      });
      logQuery("Browser launched successfully");
      page = await browser.newPage();
      logQuery("New page created");
      await page.setDefaultNavigationTimeout(60000); // 60 seconds
      // Set up event listeners.
      page.on('console', msg => {
        debugLog(`Console: ${msg.text().substring(0, 150)}`);
      });
      page.on('pageerror', err => {
        debugLog(`Page error: ${err.message}`);
      });
      page.on('request', req => {
        if (['document', 'script', 'xhr', 'fetch'].includes(req.resourceType()) &&
            !req.url().includes("challenges.cloudflare.com")) {
          debugLog(`Request: ${req.method()} ${req.url().substring(0, 100)}`);
        }
      });
      page.on('response', res => {
        if (['document', 'script', 'xhr', 'fetch'].includes(res.request().resourceType()) &&
            !res.url().includes("challenges.cloudflare.com")) {
          debugLog(`Response: ${res.status()} ${res.url().substring(0, 100)}`);
        }
      });
      
      logQuery(`Navigating to URL: ${providedUrl}`);
      await page.goto(providedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      logQuery("Navigation completed successfully");
      agent = new PuppeteerAgent(page, {
        provider: 'huggingface',
        apiKey: process.env.HF_API_KEY,
        model: 'bytedance/ui-tars-72b'
      });
      logQuery("PuppeteerAgent initialized");
      activeBrowsers.set(taskKey, { browser, agent, page, release, closed: false, hasReleased: false });
      logQuery("Browser session stored in active browsers");
    }

    sendWebSocketUpdate(userId, { 
      event: 'stepProgress', 
      taskId, 
      stepIndex: currentStep, 
      progress: 30, 
      message: `Querying: ${query}`,
      log: actionLog
    });
    
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    logQuery("Set viewport to 1280x720");
    
    //logQuery("Checking for page obstacles");
    //const obstacleResults = await handlePageObstacles(page, agent);
    //logQuery("Obstacle check results", obstacleResults);
    
    logQuery(`Executing query: "${query}"`);
    // Perform extraction only once.
    const { pageContent: extractedInfo, navigableElements } = await extractRichPageContext(
      agent, 
      page, 
      "read, scan, extract, and observe",
      query
    );
    logQuery("Query executed successfully");
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const stateCheck = await page.evaluate(() => ({
      url: window.location.href,
      popupOpened: window.opener !== null,
      numFrames: window.frames.length,
      alerts: document.querySelectorAll('[role="alert"]').length
    }));
    logQuery("Post-query state check", stateCheck);
    
    if (stateCheck.popupOpened) {
      logQuery("Popup detected - checking for new pages");
      const pages = await browser.pages();
      if (pages.length > 1) {
        logQuery(`Found ${pages.length} pages, switching to newest`);
        const newPage = pages[pages.length - 1];
        if (newPage !== page) {
          page = newPage;
          agent = new PuppeteerAgent(page, {
            provider: 'huggingface',
            apiKey: process.env.HF_API_KEY,
            model: 'bytedance/ui-tars-72b'
          });
          logQuery("Switched to new page and reinitialized agent");
        }
      }
    }
    
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotFilename = `screenshot-${Date.now()}.png`;
    const screenshotPath = path.join(runDir, screenshotFilename);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
    const screenshotUrl = `/midscene_run/${runId}/${screenshotFilename}`;
    logQuery("Screenshot captured and saved", { path: screenshotPath });

    const currentUrl = await page.url();
    logQuery(`Current URL: ${currentUrl}`);
    
    sendWebSocketUpdate(userId, {
      event: 'intermediateResult',
      taskId,
      result: {
        screenshotUrl,
        currentUrl,
        extractedInfo: cleanForPrompt(extractedInfo),
        navigableElements: Array.isArray(navigableElements) 
          ? navigableElements.map(el => cleanForPrompt(el))
          : cleanForPrompt(navigableElements)
      }
    });

    sendWebSocketUpdate(userId, { 
      event: 'stepProgress', 
      taskId, 
      stepIndex: currentStep, 
      progress: 100, 
      message: 'Query completed',
      log: actionLog
    });

    const trimmedActionLog = actionLog.map(entry => {
      const truncatedMessage = entry.message.length > 700 
        ? entry.message.substring(0, 700) + '...'
        : entry.message;
      return { ...entry, message: truncatedMessage };
    });

    // Run a single assertion based on the extracted information.
    /*
    const assertion = await agent.aiWaitFor(
      `Based on the extracted information: "${extractedInfo}", provide a concise summary of the page's state.`,
      {
        timeoutMs: 30000,
        checkIntervalMs: 5000
      }
    );
    await new Promise(resolve => setTimeout(resolve, 2000));
    logQuery("Assertion for query completed", { assertion });
    */
   const assertion = 'After execution, this is whats now visible: ' + extractedInfo.substring(0, 150) + '...';
   logQuery("Assertion for query completed", { assertion });

    // Return full results with state holding the assertion.
    return {
      success: true,
      error: null,
      task_id: taskId,
      closed: false,
      currentUrl,
      stepIndex: currentStep,
      actionOutput: `Completed: ${query}`,
      pageTitle: await page.title(),
      extractedInfo,
      navigableElements,
      actionLog: trimmedActionLog,
      screenshotPath: screenshotUrl,
      state: {
        assertion // The state now holds the concise summary of the page.
      }
    };
  } catch (error) {
    logQuery(`Error in browser query: ${error.message}`, { stack: error.stack });
    if (typeof release === 'function') release();

    const trimmedActionLog = actionLog.map(entry => {
      const shortMsg = entry.message.length > 150 
        ? entry.message.substring(0, 150) + '...'
        : entry.message;
      return { ...entry, message: shortMsg };
    });

    return {
      success: false,
      error: error.message,
      actionLog: trimmedActionLog,
      currentUrl: page ? await page.url() : null,
      task_id: taskId,
      stepIndex: currentStep
    };
  }
}

// Helper function to conditionally log debug messages.
const debugLog = (msg, data = null) => {
  if (process.env.DEBUG_PUPPETEER_LOGS === "true") {
    console.log(msg, data || '');
  }
};

// ===========================
// MAIN CHAT LOGIC & route entry
// ===========================

/**
 * Quick Classifier that calls your LLM to see if the user wants “chat” or “task”.
 * 
 */
async function openaiClassifyPrompt(prompt, userId) {
  const openaiClient = await getUserOpenAiClient(userId);
  const resp = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You classify user messages as "task" or "chat". Respond ONLY with "task" or "chat".' },
      { role: 'user',   content: prompt }
    ],
    temperature: 0,
    max_tokens: 5
  });
  const c = resp.choices?.[0]?.message?.content?.toLowerCase() || '';
  return c.includes('task') ? 'task' : 'chat';
}

/**
 * Unified NLI endpoint:
 * - If we detect it's a “task,” do your existing logic.
 * - If we detect it's “chat,” stream partial output from the LLM directly.
 */
app.post('/nli', requireAuth, async (req, res) => {
  // Accept both { prompt } and legacy { inputText }
  let prompt = req.body.prompt;
  if (!prompt && req.body.inputText) {
    prompt = req.body.inputText;
    console.debug('[DEBUG] /nli: Using legacy inputText as prompt:', prompt);
  }
  if (typeof prompt !== 'string') {
    console.error('[ERROR] /nli: Prompt must be a string. Got:', typeof prompt, prompt);
    return res.status(400).json({ success: false, error: 'Prompt must be a string.' });
  }

  const userId = req.session.user;
  const user   = await User.findById(userId).select('email openaiApiKey').lean();
  if (!user) return res.status(400).json({ success: false, error: 'User not found' });

  let classification;
  try {
    classification = await openaiClassifyPrompt(prompt, userId);
  } catch (err) {
    console.error('Classification error', err);
    classification = 'task';
  }

  if (classification === 'task') {
    // … exactly your existing "task" branch …
    let chatHistory = await ChatHistory.findOne({ userId }) || new ChatHistory({ userId, messages: [] });
    chatHistory.messages.push({ role: 'user', content: prompt, timestamp: new Date() });
    await chatHistory.save();

    const taskId = new mongoose.Types.ObjectId();
    const runId  = uuidv4();
    const runDir = path.join(MIDSCENE_RUN_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    // … save Task + push to User.activeTasks …
    await new Task({ _id: taskId, userId, command: prompt, status: 'pending', progress: 0, startTime: new Date(), runId }).save();
    await User.updateOne({ _id: userId }, { $push: { activeTasks: { _id: taskId.toString(), command: prompt, status: 'pending', startTime: new Date() } } });

    sendWebSocketUpdate(userId, { event: 'taskStart', payload: { taskId: taskId.toString(), command: prompt, startTime: new Date() } });
    processTask(userId, user.email, taskId.toString(), runId, runDir, prompt, null);
    return res.json({ success: true, taskId: taskId.toString(), runId });
  } else {
    // --- Chat branch (non-streaming) ---
    // Save user message to the unified Message collection
    await new Message({
      userId,
      role: 'user',
      type: 'chat',
      content: prompt,
      timestamp: new Date()
    }).save();

    // Get last 20 messages for context
    const lastMessages = await Message.find({ userId, role: { $in: ['user', 'assistant'] } }).sort({ timestamp: -1 }).limit(20).lean();
    const openaiClient = await getUserOpenAiClient(userId);

    try {
      const completion = await openaiClient.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: lastMessages.map(m=>({ role:m.role, content:m.content })),
        temperature: 0.7
      });
      const assistantReply = completion.choices[0].message.content;
      await Message.create({ userId, role: 'assistant', type: 'chat', content: assistantReply, timestamp: new Date() });

      sendWebSocketUpdate(userId, { event: 'chat_response_stream', payload: { assistantReply } });
      return res.json({ success: true, assistantReply }); // Message already saved above.
    } catch (err) {
      console.error('Chat error', err);
      // Save error as assistant message for continuity
      await Message.create({ userId, role: 'assistant', type: 'chat', content: `Error: ${err.message}`, timestamp: new Date(), meta: { error: err.message } });
      return res.status(500).json({ success:false, error: err.message });
    }
  }
});

// --- Unified Message Retrieval Endpoint (backward compatible) ---
app.get('/messages', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user;
    const limit = parseInt(req.query.limit, 10) || 20;
    // New schema: unified Message collection
    let messages = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    // Backward compatibility: if empty, try ChatHistory
    if (!messages.length) {
      const chatHistory = await ChatHistory.findOne({ userId });
      if (chatHistory && chatHistory.messages) {
        messages = chatHistory.messages.slice(-limit).reverse().map(m => ({
          userId,
          role: m.role,
          type: 'chat',
          content: m.content,
          timestamp: m.timestamp || null,
          legacy: true
        }));
      }
    }
    return res.json({ success: true, messages: messages.reverse() }); // oldest first
  } catch (err) {
    console.error('[GET /messages] Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Refactored processTask function using the grand plan approach
 * @param {string} userId - User ID
 * @param {string} userEmail - User email
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID 
 * @param {string} runDir - Run directory
 * @param {string} prompt - Task prompt
 * @param {string} url - Starting URL
 */
async function processTask(userId, userEmail, taskId, runId, runDir, prompt, url) {
  // --- Unified message persistence: save user command as message ---
  await Message.create({ userId, role: 'user', type: 'command', content: prompt, taskId, timestamp: new Date() });
  console.log(`[ProcessTask] Starting ${taskId}: "${prompt}"`);
  const openaiClient = await getUserOpenAiClient(userId);

  const plan = new TaskPlan(userId, taskId, prompt, url, runDir, runId);
  plan.log("Plan created.");

  // Clean up any existing browser session for this task
  if (activeBrowsers.has(taskId)) {
    console.log(`[ProcessTask] Cleaning up stale session for task ${taskId}`);
    await cleanupBrowserSession(taskId);
  }

  try {
    await Task.updateOne({ _id: taskId }, { status:'processing', progress:5 });
    sendWebSocketUpdate(userId, { event:'taskStart', taskId, prompt, url });
    plan.log("taskStart → frontend");

    let taskCompleted = false, consecutiveFailures = 0;

    while (!taskCompleted && plan.currentStepIndex < plan.maxSteps - 1) {
      const systemPrompt = plan.generateSystemPrompt();
      plan.log("SYSTEM PROMPT generated");
      
      let messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ];
      
      if (plan.steps.length > 0) {
        plan.steps.slice(-3).forEach(step => {
          if (step.result) {
            const toolCallId = `call_${step.index}`;
            messages.push({
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: toolCallId,
                  type: "function",
                  function: {
                    name: step.type === 'action' ? 'browser_action' : 'browser_query',
                    arguments: JSON.stringify({
                      [step.type === 'action' ? 'command' : 'query']: step.instruction,
                      task_id: taskId,
                      url: plan.currentUrl
                    })
                  }
                }
              ]
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              name: step.type === 'action' ? 'browser_action' : 'browser_query',
              content: JSON.stringify({
                success: step.result.success,
                currentUrl: step.result.currentUrl,
                extractedInfo: typeof step.result.extractedInfo === 'string'
                  ? step.result.extractedInfo.substring(0, 1500) + '...'
                  : "No extraction",
                navigableElements: Array.isArray(step.result.navigableElements) 
                  ? step.result.navigableElements.slice(0, 30) 
                  : []
              })
            });
          }
        });
      }
      
      if (plan.currentState && plan.currentState.pageDescription) {
        let descriptionText = (typeof plan.currentState.pageDescription === 'string')
          ? plan.currentState.pageDescription.substring(0, 300) + '...'
          : JSON.stringify(plan.currentState.pageDescription).substring(0, 300) + '...';
        messages.push({
          role: "system",
          content: `Current page state: ${descriptionText}`
        });
      }
      
      // Extracted data logged thorough
      if (plan.steps.length > 0) {
        const lastStep = plan.steps[plan.steps.length - 1];
        plan.log("Using extraction from last step", {
          extractedInfo: cleanForPrompt(lastStep.result?.extractedInfo),
          navigableElements: lastStep.result?.navigableElements
        });
      } else {
        plan.log("No intermediate extraction data available.");
      }
      
      plan.log("Sending function call request to AI", { messages });
      
      const stream = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        stream: true,
        temperature: 0.3,
        max_tokens: 700,
        tools: [
          {
            type: "function",
            function: {
              name: "browser_action",
              description: "Executes a browser action by specifying a complete natural language instruction, e.g., 'navigate to https://example.com', 'type Sony Wireless headphones into the search bar', or 'click the search button'. The 'command' parameter must include both the verb and the target details.",
              parameters: {
                type: "object",
                properties: {
                  command: { type: "string", description: "Natural language instruction for the browser action, including verb and target" },
                  url: { type: "string", description: "The page URL on which to perform the action" },
                  task_id: { type: "string", description: "Identifier for the current task" }
                },
                required: ["command"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "browser_query",
              description: "Extracts information from the webpage by performing the specified query, e.g., 'list all clickable elements on the page'. The 'query' parameter must clearly state what to extract.",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Natural language query describing what information to extract from the page" },
                  url: { type: "string", description: "The page URL from which to extract information" },
                  task_id: { type: "string", description: "Identifier for the current task" }
                },
                required: ["query"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "task_complete",
              description: "Signals that the task is complete with a final summary.",
              parameters: {
                type: "object",
                properties: { summary: { type: "string" } },
                required: []
              }
            }
          }
        ],
        tool_choice: "auto"
      });
      
      let currentFunctionCall = null;
      let accumulatedArgs = '';
      let functionCallReceived = false;
      let thoughtBuffer = '';
      
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (delta?.content) {
          thoughtBuffer += delta.content;
          sendWebSocketUpdate(userId, { event: 'thoughtUpdate', taskId, thought: delta.content });
        }
        
        if (delta?.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            if (toolCallDelta.index === 0) {
              if (toolCallDelta.function.name && !currentFunctionCall) {
                currentFunctionCall = { name: toolCallDelta.function.name };
                accumulatedArgs = '';
                if (thoughtBuffer) {
                  sendWebSocketUpdate(userId, { event: 'thoughtComplete', taskId, thought: thoughtBuffer });
                  thoughtBuffer = '';
                }
                plan.log(`New tool call started: ${currentFunctionCall.name}`);
              }
              if (toolCallDelta.function.arguments) {
                accumulatedArgs += toolCallDelta.function.arguments;
                sendWebSocketUpdate(userId, {
                  event: 'functionCallPartial',
                  taskId,
                  functionName: currentFunctionCall?.name,
                  partialArgs: accumulatedArgs
                });
                try {
                  const parsedArgs = JSON.parse(accumulatedArgs);
                  plan.log("Complete tool call received", { function: currentFunctionCall.name, args: parsedArgs });
                  parsedArgs.task_id = taskId;
                  parsedArgs.url = parsedArgs.url || url || plan.currentUrl;
                  if (currentFunctionCall.name === "browser_action") {
                    const step = plan.createStep('action', parsedArgs.command, parsedArgs);
                    const result = await step.execute(plan);
                    await addIntermediateResult(userId, taskId, result);
                    consecutiveFailures = result.success ? 0 : consecutiveFailures + 1;
                    if (consecutiveFailures >= 3) {
                      plan.log("Triggering recovery due to consecutive failures");
                      const recoveryStep = plan.createStep('query', 'Suggest a new approach to achieve the Main Task', {
                        query: 'Suggest a new approach to achieve the Main Task',
                        task_id: taskId,
                        url: plan.currentUrl
                      });
                      await recoveryStep.execute(plan);
                      consecutiveFailures = 0;
                    }
                    functionCallReceived = true;
                    break;
                  } else if (currentFunctionCall.name === "browser_query") {
                    const step = plan.createStep('query', parsedArgs.query, parsedArgs);
                    const result = await step.execute(plan);
                    await addIntermediateResult(userId, taskId, result);
                    consecutiveFailures = 0;
                    functionCallReceived = true;
                    break;
                  } else if (currentFunctionCall.name === "task_complete") {
                    const summary = parsedArgs.summary || `Task completed: ${prompt}`;
                    plan.markCompleted(summary);
                    const finalResult = await processTaskCompletion(
                      userId,
                      taskId,
                      plan.steps.map(step => step.result || { success: false }),
                      prompt,
                      runDir,
                      runId
                    );
                    const finalExtracted = (finalResult.raw && finalResult.raw.pageText && 
                                            cleanForPrompt(finalResult.raw.pageText).length > 0)
                      ? cleanForPrompt(finalResult.raw.pageText)
                      : (finalResult.aiPrepared && finalResult.aiPrepared.summary && 
                         cleanForPrompt(finalResult.aiPrepared.summary).length > 0)
                        ? cleanForPrompt(finalResult.aiPrepared.summary)
                        : `Task completed: ${prompt}`;
                    const cleanedFinal = {
                      success: finalResult.success,
                      currentUrl: finalResult.raw?.url || finalResult.currentUrl,
                      extractedInfo: finalExtracted,
                      screenshotPath: finalResult.screenshot || finalResult.screenshotPath,
                      timestamp: new Date()
                    };

                    await Task.updateOne(
                      { _id: taskId },
                      { 
                        $set: { status: 'completed', progress: 100, result: cleanedFinal, endTime: new Date() } 
                      }
                    );

                    let taskChatHistory = await ChatHistory.findOne({ userId });
                    if (!taskChatHistory) {
                      taskChatHistory = new ChatHistory({ userId, messages: [] });
                    }
                    taskChatHistory.messages.push({
                      role: 'assistant',
                      content: finalExtracted,
                      timestamp: new Date()
                    });
                    await taskChatHistory.save();

                    await Message.create({
                      userId,
                      role: 'assistant',
                      type: 'command',
                      content: finalExtracted,
                      taskId,
                      timestamp: new Date(),
                      meta: { summary }
                    });

                    sendWebSocketUpdate(userId, {
                      event: 'taskComplete',
                      taskId,
                      status: 'completed',
                      result: finalResult
                    });
                    taskCompleted = true;
                    break;
                  }
                } catch (e) {
                  // Continue accumulating if JSON is incomplete
                }
              }
            }
          }
        }}
      
        if (thoughtBuffer) {
          sendWebSocketUpdate(userId, { event: 'thoughtComplete', taskId, thought: thoughtBuffer });
          thoughtBuffer = "";
        }
      
        if (taskCompleted) {
          plan.log(`Task completed after ${plan.currentStepIndex + 1} steps.`);
          break;
        }
      
        if (!functionCallReceived) {
          plan.log(`No tool call received for step ${plan.currentStepIndex + 1}`);
          const recoveryStep = plan.createStep('query', 'Describe the current page state and available actions', {
            query: 'Describe the current page state and available actions',
            task_id: taskId,
            url: plan.currentUrl
          });
          await recoveryStep.execute(plan);
          consecutiveFailures = 0;
        }
      
        const progress = Math.min(95, Math.floor((plan.currentStepIndex + 1) / plan.maxSteps * 100));
        await Task.updateOne(
          { _id: taskId },
          { $set: { status: 'running', progress, currentStepIndex: plan.currentStepIndex, currentUrl: plan.currentUrl } }
        );
        plan.log(`Task progress updated in DB: ${progress}%`);
    }
    
    if (!taskCompleted) {
      const summary = `Task reached maximum steps (${plan.maxSteps}) without explicit completion. Current URL: ${plan.currentUrl}`;
      plan.markCompleted(summary);
      const finalResult = await processTaskCompletion(
        userId,
        taskId,
        plan.steps.map(step => step.result || { success: false }),
        prompt,
        runDir,
        runId
      );
      
      await Task.updateOne(
        { _id: taskId },
        { $set: { status: 'completed', progress: 100, result: finalResult, endTime: new Date(), summary } }
      );
      
      // --- Save final assistant message to both ChatHistory and Message ---
      let taskChatHistory = await ChatHistory.findOne({ userId });
      if (!taskChatHistory) taskChatHistory = new ChatHistory({ userId, messages: [] });
      taskChatHistory.messages.push({
        role: 'assistant',
        content: summary,
        timestamp: new Date()
      });
      await taskChatHistory.save();
      await Message.create({
        userId,
        role: 'assistant',
        type: 'command',
        content: summary,
        taskId,
        timestamp: new Date(),
        meta: { summary }
      });
      // ---------------------------------------------------------------
      sendWebSocketUpdate(userId, {
        event: 'taskComplete',
        taskId,
        status: 'completed',
        result: finalResult
      });
      plan.log("Sent taskComplete update for max-steps reached.");
    }
  } catch (error) {
    console.error(`[ProcessTask] Error in task ${taskId}:`, error);
    plan.log(`Error encountered: ${error.message}`, { stack: error.stack });
    sendWebSocketUpdate(userId, {
      event: 'taskError',
      taskId,
      error: error.message,
      log: plan.planLog.slice(-10)
    });
    await Task.updateOne(
      { _id: taskId },
      { $set: { status: 'error', error: error.message, endTime: new Date() } }
    );
    // --- Save error message as assistant message to both ChatHistory and Message ---
    let taskChatHistory = await ChatHistory.findOne({ userId });
    if (!taskChatHistory) taskChatHistory = new ChatHistory({ userId, messages: [] });
    taskChatHistory.messages.push({
      role: 'assistant',
      content: `Error: ${error.message}`,
      timestamp: new Date()
    });
    await taskChatHistory.save();
    await Message.create({
      userId,
      role: 'assistant',
      type: 'command',
      content: `Error: ${error.message}`,
      taskId,
      timestamp: new Date(),
      meta: { error: error.message }
    });
    // -------------------------------------------------------------
  } finally {
    console.log(`[ProcessTask] Cleaning up browser session for task ${taskId}`);
    await cleanupBrowserSession(taskId);

    console.log(`[ProcessTask] Task ${taskId} finished with ${plan.steps.length} steps executed.`);
    
    try {
      await Task.updateOne(
        { _id: taskId },
        { $set: { planSummary: plan.getSummary(), stepsExecuted: plan.steps.length } }
      );
      plan.log("Plan summary saved to database.");
    } catch (dbError) {
      console.error(`[ProcessTask] Error saving plan summary:`, dbError);
    }
  }
}

function cleanForPrompt(data) {
  if (data == null) return "";
  let str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  // Remove known placeholder text
  if (str.trim() === "Structured data") return "";
  return str.trim();
}

/**
 * Helper function to add intermediate results to a task
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {Object} result - Result to add
 */
async function addIntermediateResult(userId, taskId, result) {
  try {
    // Only keep fields you care about, truncating any large text.
    const cleanedResult = {
      success: result.success,
      currentUrl: result.currentUrl,
      extractedInfo: typeof result.extractedInfo === 'string'
        ? result.extractedInfo.substring(0, 1500) + '...'
        : 'Complex data omitted',
      navigableElements: Array.isArray(result.navigableElements) 
        ? result.navigableElements.slice(0, 30) 
        : [],
      screenshotPath: result.screenshotPath,  // Only store path/URL, not raw base64
      timestamp: new Date()
    };

    await Task.updateOne(
      { _id: taskId },
      { 
        $push: { intermediateResults: cleanedResult },
        $set: {
          currentUrl: result.currentUrl,
          lastUpdate: new Date()
        }
      }
    );
  } catch (error) {
    console.error(`[addIntermediateResult] Error:`, error);
  }
}

async function extractRichPageContext(agent, page, command, query) {
  const currentUrl = await page.url();
  const domainType = detectDomainType(currentUrl);
  const domainSpecificPrompt = generateDomainSpecificPrompt(domainType);
  
  const combinedQuery = `
After executing "${command}", thoroughly analyze the page and return a JSON object with the following structure:
{
  "main_content": "Describe the main content visible on the page (prices, titles, important information).",
  "navigable_elements": [
    "List ALL clickable and navigable elements with their EXACT text as shown on screen."
  ],
  "interactive_controls": [
    "List ALL interactive controls (sliders, toggles, filters, etc.) with their EXACT labels if visible."
  ],
  "data_visualization": [
    "List ALL chart controls, time selectors, indicator buttons with their EXACT labels. Detail chart type (line or graph)"
  ],
  "product_filters": [
    "List ALL product filtering options with their EXACT labels."
  ],
  "search_fields": [
    "List any search fields or input areas with their placeholder text."
  ],
  "pagination": "Describe any pagination controls."
}

${domainSpecificPrompt}

IGNORE ALL IMAGES of phones, laptops, devices, billboards, or any marketing images simulating data presentation.
Detail charts or graphs including chart type (line/bar/candlestick)
Ensure you return valid JSON. If any field is not present, return an empty string or an empty array as appropriate.
[END OF INSTRUCTION]
${query}
  `;
 
  try {
    let extractedInfo = await agent.aiQuery(combinedQuery);
    if (typeof extractedInfo !== 'string') {
      if (extractedInfo && typeof extractedInfo === 'object') {
        const pageContent = extractedInfo.main_content || "No content extracted";
        const navigableElements = [
          ...(Array.isArray(extractedInfo.navigable_elements) ? extractedInfo.navigable_elements : []),
          ...(Array.isArray(extractedInfo.interactive_controls) ? extractedInfo.interactive_controls : []),
          ...(Array.isArray(extractedInfo.data_visualization) ? extractedInfo.data_visualization : []),
          ...(Array.isArray(extractedInfo.product_filters) ? extractedInfo.product_filters : [])
        ];
        return { pageContent, navigableElements };
      }
      return { pageContent: "No content extracted", navigableElements: [] };
    }
    
    let pageContent = extractedInfo;
    let navigableElements = [];
    try {
      const sections = extractedInfo.split(/(?:\r?\n){1,}/);
      const elementKeywords = [
        "clickable", "navigable", "button", "link", "menu", "filter", "toggle", 
        "checkbox", "select", "dropdown", "chart", "control", "tab", "icon",
        "slider", "candlestick", "time frame", "period", "indicator"
      ];
      
      for (const section of sections) {
        if (elementKeywords.some(keyword => section.toLowerCase().includes(keyword))) {
          const newElements = section.split(/\r?\n/)
                                    .filter(line => line.trim())
                                    .map(line => line.trim());
          navigableElements = [...navigableElements, ...newElements];
        }
      }
      navigableElements = [...new Set(navigableElements)];
    } catch (parseError) {
      console.log("[Rich Context] Error parsing navigable elements:", parseError);
    }
   
    return { 
      pageContent: pageContent || "No content extracted", 
      navigableElements 
    };
  } catch (queryError) {
    console.error(`[Rich Context] Error in AI query:`, queryError);
    return { pageContent: "Error extracting page content: " + queryError.message, navigableElements: [] };
  }
}

function detectDomainType(url) {
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('dextools') || urlLower.includes('dexscreener') ||
      urlLower.includes('coinbase') || urlLower.includes('coingecko') ||
      urlLower.includes('coinmarketcap') || urlLower.includes('binance') ||
      urlLower.includes('jupiexchange')) {
    return 'cryptoSpecial';
  }
  if (urlLower.includes('amazon') || urlLower.includes('ebay') || 
      urlLower.includes('walmart') || urlLower.includes('etsy')) {
    return 'ecommerce';
  }
  if (urlLower.includes('twitter') || urlLower.includes('facebook') ||
      urlLower.includes('instagram') || urlLower.includes('tiktok')) {
    return 'social';
  }
  return 'general';
}

function generateDomainSpecificPrompt(domainType) {
  if (domainType === 'cryptoSpecial') {
    return `
CRYPTO SPECIAL INTERFACE DETECTED (e.g., Dextools, Dexscreener, Coinbase, Coingecko, Jupiter Exchange):
- Note the side menus, top navigation bars, and dashboard sections.
- Identify buttons such as "Trade", "Charts", "Market", "Analysis".
- Include any filtering dropdowns, time frame selectors, and graph toggles.
- List any visible labels of clickable links or tabs.
    `;
  } else if (domainType === 'ecommerce') {
    return `
ECOMMERCE SITE DETECTED: Focus on product filters, sort options, "Add to cart" buttons, and product variations.
    `;
  } else if (domainType === 'social') {
    return `
SOCIAL MEDIA SITE DETECTED: Focus on post creation, reply/comment buttons, and timeline navigation controls.
    `;
  } else {
    return `
GENERAL SITE DETECTED: Be comprehensive in finding all interactive elements to navigate this type of website. Emphasize clickable links, menus, and controls.
    `;
  }
}

/**
 * Advanced popup and obstacle handler for web browsing
 * @param {Object} page - Puppeteer page object
 * @param {Object} agent - Browser agent
 * @returns {Object} - Result of the preparation
 */
async function handlePageObstacles(page, agent) {
  console.log(`🔍 [Obstacles] Checking for page obstacles...`);
  const results = {
    obstacles: [],
    actionsAttempted: [],
    success: false
  };

  try {
    // Listen for any dialogs (alerts, confirms, prompts) and auto-accept them.
    page.on('dialog', async (dialog) => {
      console.log(`🔔 [Obstacles] Dialog detected: ${dialog.type()} - ${dialog.message()}`);
      results.obstacles.push(`Dialog: ${dialog.type()} - ${dialog.message()}`);
      await dialog.accept();
      results.actionsAttempted.push(`Accepted ${dialog.type()} dialog`);
    });

    // Prepare a text instruction prompt for obstacles.
    const obstacleCheckPrompt = `
      Analyze the current page for common obstacles such as:
      1. Cookie consent banners,
      2. Newsletter signup modals,
      3. Login walls,
      4. Captcha or Turnstile challenges,
      5. Overlays or popups blocking content.
      
      For each obstacle, list any dismiss button text visible (e.g., "Accept", "Close", "No thanks"). If no obstacles or popups are found, return "no obstacles" or "none detected" only.
      Return a structured answer.
    `;
    
    // Execute the obstacle detection query.
    let obstacles = await agent.aiQuery(obstacleCheckPrompt);
    // Normalize obstacles to text regardless of whether it comes as a string or object.
    let obstaclesText = '';
    if (typeof obstacles === 'string') {
      obstaclesText = obstacles;
    } else if (typeof obstacles === 'object') {
      obstaclesText = JSON.stringify(obstacles, null, 2);
    } else {
      obstaclesText = String(obstacles);
    }
    
    // If no obstacles are detected in text, mark success.
    if (typeof obstaclesText === 'string' &&
        (obstaclesText.toLowerCase().includes('no obstacles') ||
         obstaclesText.toLowerCase().includes('none detected'))) {
      console.log(`✅ [Obstacles] No obstacles detected.`);
      results.success = true;
      return results;
    }
    
    // Otherwise, log the detected obstacles.
    console.log(`⚠️ [Obstacles] Detected: ${obstaclesText.slice(0, 150)}...`);
    results.obstacles.push(obstaclesText);
    
    // Define a list of dismissal actions to attempt.
    const dismissActions = [
      "Find and click 'Accept', 'Accept All', 'I Accept', 'I Agree', or 'Agree'",
      "Find and click 'Continue', 'Close', 'Got it', 'I understand', or 'OK'",
      "Look for and click 'X', 'Close', 'Skip', 'No thanks', or 'Maybe later'",
      "If a CAPTCHA is present, attempt to solve or reload the challenge",
      "Try pressing the 'Escape' key or clicking outside a modal"
    ];
    
    let attemptCount = 0;
    const maxAttempts = 3; // Limit the number of times to retry a single dismiss action.
    
    // Iterate over each dismissal action.
    for (const action of dismissActions) {
      attemptCount = 0;
      let cleared = false;
      while (attemptCount < maxAttempts) {
        try {
          console.log(`🔧 [Obstacles] Attempting dismissal: ${action}`);
          results.actionsAttempted.push(action);
          // Use the agent's action function. Ideally, replace a raw text string with a dedicated method.
          // For example: await agent.scroll({ startBox: [0, 0, 1280, 720], direction: 'down' })
          // For now, we assume aiAction accepts this text.
          await agent.aiAction(action);
          // Wait for a moment to let the page update.
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Check if obstacles are still present.
          const recheck = await agent.aiQuery("Are there any popups, overlays, or banners blocking the main content?");
          if (typeof recheck === 'string' && 
              (recheck.toLowerCase().includes('no') || 
               recheck.toLowerCase().includes('cleared') ||
               recheck.toLowerCase().includes('gone'))) {
            console.log(`✅ [Obstacles] Cleared with action: ${action}`);
            results.success = true;
            cleared = true;
            break;
          }
        } catch (dismissError) {
          console.log(`❌ [Obstacles] Dismissal error on attempt ${attemptCount + 1} for action "${action}": ${dismissError.message}`);
        }
        attemptCount++;
      }
      if (cleared) break;
    }
    
    if (!results.success) {
      console.log(`⚠️ [Obstacles] Unable to clear obstacles after ${maxAttempts * dismissActions.length} attempts.`);
    }
    
    return results;
  } catch (error) {
    console.error(`❌ [Obstacles] Error during obstacle handling: ${error.message}`);
    results.obstacles.push(`Error: ${error.message}`);
    return results;
  }
}

// Browser session cleanup utilities

async function cleanupBrowserSession(taskId) {
  try {
    if (!activeBrowsers.has(taskId)) return;
    
    const { browser, page, release } = activeBrowsers.get(taskId);
    
    // Close browser resources
    if (page && !page.isClosed()) await page.close();
    if (browser) await browser.close();
    if (release) release();
    
    // Remove from tracking
    activeBrowsers.delete(taskId);
    
    console.log(`Successfully cleaned up browser session for task ${taskId}`);
    return true;
  } catch (err) {
    console.error(`Failed to cleanup browser session for task ${taskId}:`, err);
    return false;
  }
}

// Add cleanup handler to process termination events
process.on('SIGTERM', async () => {
  console.log('SIGTERM received - cleaning up browser sessions');
  for (const [taskId] of activeBrowsers) {
    await cleanupBrowserSession(taskId);
  }
});

process.on('SIGINT', async () => {
  console.log('SIGINT received - cleaning up browser sessions');
  for (const [taskId] of activeBrowsers) {
    await cleanupBrowserSession(taskId);
  }
  process.exit(0);
});

// --- Helper: Ensure userId is present in session, generate guest if needed ---
function ensureUserId(req, res, next) {
  if (!req.session.user) {
    req.session.user = 'guest_' + Date.now() + '_' + Math.floor(Math.random()*100000);
    console.debug('[DEBUG] ensureUserId: Generated guest userId', req.session.user);
  } else {
    console.debug('[DEBUG] ensureUserId: Found userId in session', req.session.user);
  }
  next();
}

// --- API: Who Am I (userId sync endpoint) ---
app.get('/api/whoami', (req, res) => {
  try {
    let userId = null;
    if (req.session && req.session.user) {
      userId = req.session.user;
      console.debug('[whoami] Returning userId from session:', userId);
    } else if (req.session) {
      userId = 'guest_' + Date.now() + '_' + Math.floor(Math.random()*100000);
      req.session.user = userId;
      console.debug('[whoami] Generated new guest userId:', userId);
    } else {
      // Session middleware is broken or not present
      userId = 'guest_' + Date.now() + '_' + Math.floor(Math.random()*100000);
      console.warn('[whoami] WARNING: req.session missing, returning fallback guest userId:', userId);
    }
    res.json({ userId });
  } catch (err) {
    console.error('[whoami] ERROR:', err);
    res.status(500).json({ error: 'Failed to get userId', detail: err.message });
  }
});

// --- Robust API: Who Am I (no /api prefix, for proxy rewrite) ---
app.get('/whoami', (req, res) => {
  try {
    let userId = null;
    if (req.session && req.session.user) {
      userId = req.session.user;
      console.debug('[whoami] Returning userId from session:', userId);
    } else if (req.session) {
      userId = 'guest_' + Date.now() + '_' + Math.floor(Math.random()*100000);
      req.session.user = userId;
      console.debug('[whoami] Generated new guest userId:', userId);
    } else {
      userId = 'guest_' + Date.now() + '_' + Math.floor(Math.random()*100000);
      console.warn('[whoami] WARNING: req.session missing, returning fallback guest userId:', userId);
    }
    res.json({ userId });
  } catch (err) {
    console.error('[whoami] ERROR:', err);
    res.status(500).json({ error: 'Failed to get userId', detail: err.message });
  }
});
