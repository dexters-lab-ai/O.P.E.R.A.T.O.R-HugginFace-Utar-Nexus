// server.js (ESM version)
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import puppeteer from 'puppeteer';
import { PuppeteerAgent } from '@midscene/web/puppeteer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import winston from 'winston';
import pRetry from 'p-retry';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
mongoose.set('strictQuery', true);

// File paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure stealth plugin for puppeteer
puppeteerExtra.use(StealthPlugin());

// Nut.js for desktop automation
import { keyboard, Key } from '@nut-tree-fork/nut-js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Set up directories
const MIDSCENE_RUN_DIR = path.join(__dirname, 'midscene_run');
if (!fs.existsSync(MIDSCENE_RUN_DIR)) fs.mkdirSync(MIDSCENE_RUN_DIR, { recursive: true });

const REPORT_DIR = path.join(MIDSCENE_RUN_DIR, 'report');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

// Express app and HTTP server
const app = express();
const server = createServer(app);

// WebSocket server setup
const userConnections = new Map();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const userId = req.url.split('userId=')[1]?.split('&')[0];

  if (!userId) {
    console.log('[WebSocket] Connection rejected: Missing userId');
    ws.close();
    return;
  }

  ws.userId = userId;

  if (!userConnections.has(userId)) userConnections.set(userId, new Set());
  userConnections.get(userId).add(ws);
  console.log(`[WebSocket] Client connected: userId=${userId}`);

  ws.on('close', () => {
    if (userConnections.has(userId)) {
      userConnections.get(userId).delete(ws);
      if (userConnections.get(userId).size === 0) userConnections.delete(userId);
    }
    console.log(`[WebSocket] Client disconnected: userId=${userId}`);
  });
});

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/public', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));
app.use('/midscene_run', express.static(MIDSCENE_RUN_DIR));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dailAdmin:ua5^bRNFCkU*--c@operator.smeax.mongodb.net/dail?retryWrites=true&w=majority&appName=OPERATOR";

// Robust MongoDB session store setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    dbName: 'dail',
    collectionName: 'sessions',
    ttl: 24 * 60 * 60, // 24 hours in seconds
    autoRemove: 'native', // Use MongoDB's native TTL cleanup
    touchAfter: 24 * 3600 // Only update session if older than 24 hours
  }),
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours in milliseconds
}));

// Session logging middleware
app.use((req, res, next) => {
  console.log('Session ID:', req.sessionID);
  console.log('Session Data:', req.session);
  next();
});

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

// Authentication middleware
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ success: false, error: 'Not logged in' });
  next();
}

// Mongoose connection with retry logic and timing
async function connectToMongoDB() {
  const startTime = Date.now();
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // Timeout for server selection
      connectTimeoutMS: 10000,       // Timeout for initial connection
    });
    console.log(`Connected to MongoDB in ${Date.now() - startTime}ms`);
  } catch (err) {
    console.error('Mongoose connection error:', err);
    logger.error('MongoDB connection failed', { error: err.message });
    // Retry logic: wait 2 seconds and try again (up to 5 attempts)
    throw new pRetry.AbortError('MongoDB connection failed after retries');
  }
}

// Mongoose schemas with indexes
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  customUrls: [{ type: String }],
  history: [{
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    url: String,
    command: String,
    result: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now }
  }],
  activeTasks: [{
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    url: String,
    command: String,
    status: { type: String, enum: ['pending', 'processing', 'completed', 'error'], default: 'pending' },
    progress: { type: Number, default: 0 },
    startTime: { type: Date, default: Date.now },
    isDone: { type: Boolean, default: false },
    endTime: Date,
    error: String,
    isComplex: { type: Boolean, default: false },
    subTasks: [{
      id: { type: String },
      command: String,
      status: { type: String, enum: ['pending', 'processing', 'completed', 'error'], default: 'pending' },
      result: mongoose.Schema.Types.Mixed,
      progress: { type: Number, default: 0 },
      error: String
    }],
    intermediateResults: [mongoose.Schema.Types.Mixed]
  }]
});

// Define indexes for User schema
userSchema.index({ email: 1 }, { unique: true }); // Email index
userSchema.index({ "history.timestamp": -1 }); // History timestamp index (descending)

const User = mongoose.model('User', userSchema);

const chatHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }]
});

// Define index for ChatHistory schema
chatHistorySchema.index({ userId: 1 });

const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);

// Ensure indexes are created on startup
async function ensureIndexes() {
  try {
    // Ensure User indexes
    await User.ensureIndexes();
    console.log('User indexes ensured');

    // Ensure ChatHistory indexes
    await ChatHistory.ensureIndexes();
    console.log('ChatHistory indexes ensured');
  } catch (err) {
    console.error('Error ensuring indexes:', err);
    logger.error('Index creation failed', { error: err.message });
  }
}

// Startup function with robust MongoDB connection and index creation
async function startApp() {
  try {
    await pRetry(connectToMongoDB, {
      retries: 5,
      minTimeout: 2000,
      onFailedAttempt: error => {
        console.log(`MongoDB connection attempt ${error.attemptNumber} failed. Retrying...`);
      }
    });
    await ensureIndexes();
    console.log('Application started successfully');
  } catch (err) {
    console.error('Failed to start application:', err);
    process.exit(1); // Exit process if startup fails
  }
}
// Run Once to ensure index creation
await startApp();

// Routes
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) throw new Error('Email already exists');
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ email, password: hashedPassword, history: [], activeTasks: [], customUrls: [] });
    req.session.user = newUser._id;
    res.json({ success: true, userId: email });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) throw new Error('Invalid email or password');
    req.session.user = user._id;
    res.json({ success: true, userId: email });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/login.html');
  });
});

app.get('/history', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const user = await User.findById(req.session.user).lean();
    if (!user) return res.status(401).json({ error: 'User not found' });

    const totalItems = user.history.length;
    const sortedHistory = user.history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const paginatedHistory = sortedHistory.slice(skip, skip + limit);

    res.json({
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
      items: paginatedHistory.map(item => ({
        _id: item._id,
        url: item.url || 'Unknown URL',
        command: item.command,
        timestamp: item.timestamp,
        result: { raw: item.result?.raw || null, aiPrepared: item.result?.aiPrepared || null, runReport: item.result?.runReport || null },
      })),
    });
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.get('/history/:id', requireAuth, async (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/json');
    const user = await User.findById(req.session.user);
    const historyItem = user.history.find(h => h._id.toString() === req.params.id);
    if (!historyItem) return res.status(404).json({ error: 'History item not found' });
    res.json({
      _id: historyItem._id,
      url: historyItem.url || 'Unknown URL',
      command: historyItem.command,
      timestamp: historyItem.timestamp,
      result: { raw: historyItem.result?.raw || null, aiPrepared: historyItem.result?.aiPrepared || null, runReport: historyItem.result?.runReport || null },
    });
  } catch (err) {
    console.error('Error fetching history item:', err);
    res.status(500).json({ error: 'Failed to fetch history item' });
  }
});

app.delete('/history/:id', requireAuth, async (req, res) => {
  try {
    await User.updateOne({ _id: req.session.user }, { $pull: { history: { _id: req.params.id } } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/history', requireAuth, async (req, res) => {
  try {
    await User.updateOne({ _id: req.session.user }, { $set: { history: [] } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/chat-history', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database not connected');
    }
    const chatHistory = await ChatHistory.findOne({ userId: req.session.user }).lean();
    if (!chatHistory) {
      return res.status(404).json({ error: 'Chat history not found' });
    }
    res.json(chatHistory);
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

app.put('/tasks/:id/progress', requireAuth, async (req, res) => {
  const { progress } = req.body;
  try {
    await User.updateOne({ _id: req.session.user, 'activeTasks._id': req.params.id }, { $set: { 'activeTasks.$.progress': progress } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/tasks/active', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user).lean();
    const activeTasks = user.activeTasks.filter(task => ['pending', 'processing', 'canceled'].includes(task.status));
    res.json(activeTasks);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/tasks/:id/stream', requireAuth, async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const sendUpdate = async () => {
      const user = await User.findById(req.session.user).lean();
      const task = user.activeTasks.find(t => t._id.toString() === req.params.id);
      if (!task) {
        const historyItem = user.history.find(h => h._id.toString() === req.params.id);
        res.write(`data: ${JSON.stringify(historyItem ? { status: 'completed', result: historyItem.result, done: true } : { done: true, error: 'Task not found' })}\n\n`);
        clearInterval(interval);
        res.end();
        return;
      }
      res.write(`data: ${JSON.stringify({ status: task.status, progress: task.progress, subTasks: task.subTasks, intermediateResults: task.intermediateResults, error: task.error, result: task.result })}\n\n`);
      if (task.status === 'completed' || task.status === 'error') {
        res.write(`data: ${JSON.stringify({ status: task.status, result: task.result, error: task.error, done: true })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    };
    await sendUpdate();
    const interval = setInterval(sendUpdate, 1000);
    req.on('close', () => {
      clearInterval(interval);
      res.end();
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/custom-urls', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    res.json(user.customUrls);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/custom-urls', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });
  try {
    await User.updateOne({ _id: req.session.user }, { $addToSet: { customUrls: url } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/custom-urls/:url', requireAuth, async (req, res) => {
  const { url } = req.params;
  try {
    await User.updateOne({ _id: req.session.user }, { $pull: { customUrls: url } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, '/public/index.html'));
});

app.get('/history.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  const filePath = path.join(__dirname, 'public', 'history.html');
  fs.existsSync(filePath) ? res.sendFile(filePath) : res.status(404).send('History page not found');
});

app.get('/guide.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  const filePath = path.join(__dirname, 'public', 'guide.html');
  fs.existsSync(filePath) ? res.sendFile(filePath) : res.status(404).send('Guide page not found');
});

app.get('/settings.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  const filePath = path.join(__dirname, 'public', 'settings.html');
  fs.existsSync(filePath) ? res.sendFile(filePath) : res.status(404).send('Settings page not found');
});


// Utility functions
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureElementVisible(page, selector) {
  const element = await page.$(selector);
  if (!element) return false;
  const isVisible = await element.isIntersectingViewport();
  if (!isVisible) {
    await element.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(100);
  }
  return true;
}

async function openApplication(appName) {
  if (process.platform === 'win32') {
    await keyboard.pressKey(Key.LeftSuper);
    await sleep(500);
    await keyboard.type(appName);
    await sleep(500);
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    return `Launched application "${appName}" via Start menu.`;
  } else if (process.platform === 'darwin') {
    require('child_process').exec(`open -a "${appName}"`);
    return `Opened application "${appName}" on macOS.`;
  } else if (process.platform === 'linux') {
    require('child_process').exec(`${appName} &`);
    return `Attempted to launch "${appName}" on Linux.`;
  }
  return `Platform not supported for openApplication.`;
}

// Import statements would remain the same
// const puppeteerExtra = require('puppeteer-extra');
// const path = require('path');
// const fs = require('fs');
// const { v4: uuidv4 } = require('uuid');
// const mongoose = require('mongoose');
// const PuppeteerAgent = require('./PuppeteerAgent');
// ... other imports

// Active browser sessions map - shared across the application
const activeBrowsers = new Map();

/**
 * Send updates to the client via WebSocket
 * @param {string} userId - User ID to send updates to
 * @param {Object} data - Data to send
 */
function sendWebSocketUpdate(userId, data) {
//console.log(`[WebSocket] Sending update to userId=${userId}:`, JSON.stringify(data).substring(0, 200) + '...');
  if (userConnections.has(userId)) {
    userConnections.get(userId).forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    });
  }
}

/**
 * Handle browser action commands with improved error handling and step tracking
 * @param {Object} args - Command arguments
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID
 * @param {string} runDir - Run directory
 * @param {number} currentStep - Current step number
 * @param {string} stepDescription - Description of the current step
 * @param {Object} stepMap - Map of all steps with their status and results
 * @returns {Object} - Result object
 */
async function handleBrowserAction(args, userId, taskId, runId, runDir, currentStep, stepDescription, stepMap) {
  console.log(`[BrowserAction] Starting with args:`, args);
  const { command, url } = args;
  let task_id = args.task_id;
  let browser, agent, page;

  // Ensure runDir exists
  fs.mkdirSync(runDir, { recursive: true });

  try {
    // Reuse existing browser session or create new one
    if (task_id && activeBrowsers.has(task_id)) {
      console.log(`[BrowserAction] Reusing browser session ${task_id}`);
      ({ browser, agent, page } = activeBrowsers.get(task_id));
      
      // Verify browser is still valid/open
      try {
        await page.evaluate(() => true);
      } catch (err) {
        console.log(`[BrowserAction] Browser session invalid, creating new one`);
        activeBrowsers.delete(task_id);
        task_id = null;
      }
    } 
    
    // Create new browser if needed
    if (!task_id || !activeBrowsers.has(task_id)) {
      if (!url) throw new Error("URL is required for new tasks");
      console.log(`[BrowserAction] Creating new browser session for URL: ${url}`);
      const newTaskId = uuidv4();
      
      // Launch browser with retry mechanism
      let launchAttempts = 0;
      const maxLaunchAttempts = 3;
      
      while (launchAttempts < maxLaunchAttempts) {
        try {
          browser = await puppeteerExtra.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1080,768"],
            timeout: 120000
          });
          break;
        } catch (err) {
          launchAttempts++;
          console.error(`[BrowserAction] Browser launch failed (attempt ${launchAttempts}):`, err);
          if (launchAttempts >= maxLaunchAttempts) throw err;
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      page = await browser.newPage();
      await page.setViewport({ 
        width: 1080, 
        height: 768, 
        deviceScaleFactor: process.platform === "darwin" ? 2 : 1 
      });
      
      // Navigate to URL with retry mechanism
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[BrowserAction] Navigating to ${url} (attempt ${attempt})`);
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 180000 });
          break;
        } catch (error) {
          if (attempt === 3) throw error;
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      agent = new PuppeteerAgent(page, {
        provider: 'huggingface',
        apiKey: process.env.HF_API_KEY,
        model: 'bytedance/ui-tars-72b',
        forceSameTabNavigation: true,
        executionTimeout: 600000,
        planningTimeout: 180000,
        maxPlanningRetries: 4
      });
      
      activeBrowsers.set(newTaskId, { browser, agent, page });
      task_id = newTaskId;
    }

    // Send progress update
    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 30,
      message: `Preparing to execute: ${command}`
    });

    // Initialize step in step map if not already done
    if (!stepMap[currentStep]) {
      stepMap[currentStep] = {
        step: currentStep,
        description: stepDescription,
        status: "started",
        beforeInfo: null,
        afterInfo: null,
        progress: "pending"
      };
    }

    // Get page info BEFORE action using handleTaskFinality
    const beforeInfo = await handleTaskFinality(currentStep, page, agent, command, stepDescription, stepMap);
    console.log("[BrowserAction] Before state captured:", beforeInfo);

        // Update task status in database
        await updateTaskInDatabase(userId, taskId, {
          status: 'processing',
          progress: 50,
          lastAction: command
        });
    
    // Handle potential overlays or obstacles
    try {
      const preparationSuccessful = await handleTaskPreparation(page, agent);
      console.log("[BrowserAction] Task preparation status:", preparationSuccessful);
    } catch (error) {
      console.error("[BrowserAction] Preparation skipped - Error during task preparation:", error);
    }

    // Send progress update
    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 50,
      message: `Executing: ${command}`
    });

    // Execute the action
    console.log(`[BrowserAction] Executing command: ${command}`);
    await agent.aiAction(command);
    
    // Wait a moment for any page changes to settle
    await sleep(200);
    
    // Capture screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));

    // Send progress update
    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 80,
      message: `Verifying result of: ${command}`
    });

    // Get page info AFTER action using handleTaskFinality
    const finalityStatus = await handleTaskFinality(currentStep, page, agent, command, stepDescription, stepMap);
    console.log("[BrowserAction] Task finality status:", finalityStatus);
    
    // Get current page state
    const currentUrl = await page.url();
    const pageTitle = await page.title();
    
    // Determine if action was successful
    const isSuccess = finalityStatus.status === "progressed";

    // Create result with verification
    const result = {
      success: isSuccess,
      currentUrl,
      pageTitle,
      actionOutput: `Browser action completed for step ${currentStep}: ${stepDescription}`,
      timestamp: new Date().toISOString(),
      type: "action",
      command: command,
      extractedInfo: finalityStatus.extractedInfo,
      stepSummary: finalityStatus.stepSummary
    };

    // Send final progress update
    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 100,
      message: isSuccess ? 'Action completed successfully' : 'Action may not have completed as expected'
    });

    return {
      task_id,
      result,
      screenshot,
      screenshotPath: `/midscene_run/${runId}/${path.basename(screenshotPath)}`
    };
  } catch (error) {
    console.error(`[BrowserAction] Error:`, error);
    
    // Try to get a screenshot of the error state if possible
    let screenshot, screenshotPath;
    try {
      if (page) {
        screenshot = await page.screenshot({ encoding: 'base64' });
        screenshotPath = path.join(runDir, `error-screenshot-${Date.now()}.png`);
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
        screenshotPath = `/midscene_run/${runId}/${path.basename(screenshotPath)}`;
      }
    } catch (ssError) {
      console.error("[BrowserAction] Could not capture error screenshot:", ssError);
    }
    
    // Update step status in step map
    if (stepMap[currentStep]) {
      stepMap[currentStep].status = "error";
      stepMap[currentStep].progress = "error";
      stepMap[currentStep].afterInfo = `Error: ${error.message}`;
    }
    
    return {
      task_id,
      error: error.message,
      errorStack: error.stack,
      success: false,
      screenshot,
      screenshotPath,
      timestamp: new Date().toISOString(),
      command: command,
      stepSummary: stepMap ? generateStepSummary(stepMap) : "Error occurred, no step summary available"
    };
  }
}

/**
 * Handle browser query commands with improved error handling and step tracking
 * @param {Object} args - Query arguments
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID
 * @param {string} runDir - Run directory
 * @param {number} currentStep - Current step number
 * @param {string} stepDescription - Description of the current step
 * @param {Object} stepMap - Map of all steps with their status and results
 * @returns {Object} - Result object
 */
async function handleBrowserQuery(args, userId, taskId, runId, runDir, currentStep, stepDescription, stepMap) {
  console.log(`[BrowserQuery] Starting with args:`, args);
  let { query, url, task_id } = args;
  let browser, agent, page;

  // Ensure runDir exists
  fs.mkdirSync(runDir, { recursive: true });

  try {
    // Reuse existing browser session or create new one
    if (task_id && activeBrowsers.has(task_id)) {
      console.log(`[BrowserQuery] Reusing browser session ${task_id}`);
      ({ browser, agent, page } = activeBrowsers.get(task_id));
      
      // Verify browser is still valid/open
      try {
        await page.evaluate(() => true);
      } catch (err) {
        console.log(`[BrowserQuery] Browser session invalid, creating new one`);
        activeBrowsers.delete(task_id);
        task_id = null;
      }
    }
    
    // Create new browser if needed
    if (!task_id || !activeBrowsers.has(task_id)) {
      if (!url) throw new Error("URL is required for new tasks");
      console.log(`[BrowserQuery] Creating new browser session for URL: ${url}`);
      const newTaskId = uuidv4();
      
      // Launch browser with retry mechanism
      let launchAttempts = 0;
      const maxLaunchAttempts = 3;
      
      while (launchAttempts < maxLaunchAttempts) {
        try {
          browser = await puppeteerExtra.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1080,768"],
            timeout: 120000
          });
          break;
        } catch (err) {
          launchAttempts++;
          console.error(`[BrowserQuery] Browser launch failed (attempt ${launchAttempts}):`, err);
          if (launchAttempts >= maxLaunchAttempts) throw err;
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      page = await browser.newPage();
      await page.setViewport({ 
        width: 1080, 
        height: 768,
        deviceScaleFactor: process.platform === "darwin" ? 2 : 1 
      });
      
      // Navigate to URL with retry mechanism
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[BrowserQuery] Navigating to ${url} (attempt ${attempt})`);
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 180000 });
          break;
        } catch (error) {
          if (attempt === 3) throw error;
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      agent = new PuppeteerAgent(page, {
        provider: 'huggingface',
        apiKey: process.env.HF_API_KEY,
        model: 'bytedance/ui-tars-72b',
        forceSameTabNavigation: true,
        executionTimeout: 600000,
        planningTimeout: 300000,
        maxPlanningRetries: 4
      });
      
      activeBrowsers.set(newTaskId, { browser, agent, page });
      task_id = newTaskId;
    }

    // Send progress update before execution
    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 30,
      message: `Preparing to query: ${query}`
    });

    // Initialize step in step map if not already done
    if (!stepMap[currentStep]) {
      stepMap[currentStep] = {
        step: currentStep,
        description: stepDescription,
        status: "started",
        beforeInfo: null,
        afterInfo: null,
        progress: "pending"
      };
    }

    // Get page info BEFORE query using handleTaskFinality
    const beforeInfo = await handleTaskFinality(currentStep, page, agent, query, stepDescription, stepMap);
    console.log("[BrowserQuery] Before state captured:", beforeInfo);

    // Update task status in database
    await User.updateOne(
      { _id: userId, 'activeTasks._id': taskId },
      { 
        $set: { 
          'activeTasks.$.lastQuery': query,
          'activeTasks.$.status': 'processing'
        } 
      }
    );

    // Execute the query
    console.log(`[BrowserQuery] Executing query: ${query}`);
    const queryResult = await agent.aiQuery(query);
    console.log(`[BrowserQuery] Query result:`, queryResult);

    // Send progress update after execution
    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 70,
      message: `Query executed, capturing screenshot`
    });

    // Capture screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));

    // Get page info AFTER query using handleTaskFinality
    const finalityStatus = await handleTaskFinality(currentStep, page, agent, query, stepDescription, stepMap);
    console.log("[BrowserQuery] Task finality status:", finalityStatus);
    
    // Get current page state
    const currentUrl = await page.url();
    const pageTitle = await page.title();
    
    // Determine if query was successful
    const isSuccess = finalityStatus.status === "progressed";

    // Create result with verification
    const result = {
      success: isSuccess,
      currentUrl,
      pageTitle,
      queryOutput: queryResult,
      timestamp: new Date().toISOString(),
      type: "query",
      query: query,
      extractedInfo: finalityStatus.extractedInfo,
      stepSummary: finalityStatus.stepSummary
    };

    // Save intermediate result to database
    await addIntermediateResult(userId, taskId, result);

    // Send final progress update
    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 100,
      message: 'Query completed successfully'
    });

    return {
      task_id,
      result,
      screenshot,
      screenshotPath: `/midscene_run/${runId}/${path.basename(screenshotPath)}`
    };
  } catch (error) {
    console.error(`[BrowserQuery] Error:`, error);
    
    // Attempt to capture error screenshot
    let screenshot, screenshotPath;
    try {
      if (page) {
        screenshot = await page.screenshot({ encoding: 'base64' });
        screenshotPath = path.join(runDir, `error-screenshot-${Date.now()}.png`);
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
        screenshotPath = `/midscene_run/${runId}/${path.basename(screenshotPath)}`;
      }
    } catch (ssError) {
      console.error("[BrowserQuery] Could not capture error screenshot:", ssError);
    }
    
    // Update step status in step map
    if (stepMap[currentStep]) {
      stepMap[currentStep].status = "error";
      stepMap[currentStep].progress = "error";
      stepMap[currentStep].afterInfo = `Error: ${error.message}`;
    }

    // Create error result
    const errorResult = {
      task_id,
      error: error.message,
      errorStack: error.stack,
      success: false,
      screenshot,
      screenshotPath,
      timestamp: new Date().toISOString(),
      query: query,
      stepSummary: stepMap ? generateStepSummary(stepMap) : "Error occurred, no step summary available"
    };

    // Save error result to database
    await addIntermediateResult(userId, taskId, errorResult);

    // Send error update
    sendWebSocketUpdate(userId, {
      event: 'stepError',
      taskId,
      error: error.message
    });

    return errorResult;
  }
}

async function handleDesktopAction(prompt, targetUrl, runDir, runId) {
  try {
    const browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1080,768"],
      timeout: 120000
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 768, deviceScaleFactor: process.platform === "darwin" ? 2 : 1 });
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 180000 });
    
    const rawResult = await runAutomation(page, prompt);
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const pageText = await page.evaluate(() => document.body.innerText);
    
    // Save screenshot
    const screenshotPath = path.join(runDir, 'screenshot.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
    
    // Generate Midscene report
    const reportFile = `midscene-report-${Date.now()}.html`;
    const reportPath = path.join(REPORT_DIR, reportFile);
    const runReportUrl = `/midscene_run/report/${reportFile}`;
    
    fs.writeFileSync(reportPath, generateKomputerReport(prompt, rawResult, `/midscene_run/${runId}/screenshot.png`));
    
    const result = {
      raw: { screenshotPath: `/midscene_run/${runId}/screenshot.png`, pageText },
      aiPrepared: { summary: rawResult },
      runReport: runReportUrl
    };
    
    await browser.close();
    return result;
  } catch (error) {
    console.error("[Komputer Task] Error:", error);
    throw error;
  }
}

// Generate Komputer task report
function generateKomputerReport(prompt, result, screenshotPath) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Komputer Task Report</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; }
        .summary { background: #f1f8ff; padding: 15px; border-radius: 5px; margin: 15px 0; }
        img { max-width: 100%; border: 1px solid #ddd; margin: 15px 0; }
      </style>
    </head>
    <body>
      <h1>Komputer Task Report</h1>
      <h2>Original Command</h2>
      <div class="command">${prompt}</div>
      <h2>Execution Summary</h2>
      <div class="summary">${result}</div>
      <h2>Screenshot</h2>
      <img src="${screenshotPath}" alt="Task Screenshot">
    </body>
    </html>
  `;
}

/*
async function handleTaskPreparation(page, agent) {
  const screenshot = await page.screenshot({ encoding: 'base64' });

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a web agent analyzing a page screenshot for automation. 
First, detect and classify the page intent using: task_type=login | captcha | popup | cookies | human_check | none.

Then describe the steps in plain English using: steps=...

Guidelines:
- For login forms: Identify username/email and password fields, and describe how to log in with Google or credentials.
- For captchas: Identify if it's a checkbox, image selection, or text input and describe how to solve it.
- For popups: If there's a form, explain how to close it or submit it.
- For cookies: Say how to accept all cookies.
- For "I am human" checks: Describe checkbox behavior or visual test.

Format your response as:
task_type=<detected_type>
steps=<step-by-step plan>

Do not guess. If unsure, return task_type=none`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${screenshot}` },
          },
        ],
      },
    ],
    max_tokens: 500,
  });

  const analysis = response.choices[0].message.content.toLowerCase();
  const lines = analysis.split('\n');
  const taskTypeLine = lines.find(line => line.startsWith('task_type='));
  const stepsLine = lines.find(line => line.startsWith('steps='));
  const taskType = taskTypeLine?.split('=')[1]?.trim();

  if (stepsLine) console.log(`[AI PLAN] ${stepsLine}`);
  console.log(' TaskTYPEline: ',taskTypeLine);
  const steps = stepsLine?.replace(/^steps=/, '').trim();

  switch (taskType) {
    case 'login':
      await agent.aiAction(`Login detected. ${steps || 'Fill out and submit the login form using the provided credentials.'}`);
      console.log("Login form handled.");
      break;
    case 'captcha':
      await agent.aiAction(`Captcha challenge detected. ${steps || 'Solve the captcha on the page.'}`);
      console.log("Captcha handled.");
      break;
    case 'cookies':
      await agent.aiAction(`Cookie prompt detected, click "Accept" or follow these steps: ${steps || 'Click the button to acccept cookies on the page and click it to accept cookies.'}`);
      console.log("Cookies popup handled.");
      break;
    case 'popup':
      await agent.aiAction(`Popup form detected. ${steps || 'Close or dismiss the popup shown.'}`);
      console.log("Popup handled.");
      break;
    case 'human_check':
      await agent.aiAction(`Human verification challenge detected. ${steps || 'Complete the checkbox or challenge labeled "I am human".'}`);
      console.log("Human check handled.");
      break;
    default:
      console.log("No actionable element detected.");
  }

  // Step 4: Verify success
  const verificationScreenshot = await page.screenshot({ encoding: 'base64' });
  const verificationResponse = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Verify if the login or captcha was successfully handled. Return 'yes' if the page shows the expected content, 'no' otherwise.",
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${verificationScreenshot}` },
          },
        ],
      },
    ],
    max_tokens: 100,
  });

  const verification = verificationResponse.choices[0].message.content.toLowerCase();
  return verification.includes("yes");
}
*/

/**
 * Update task in database and notify clients
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {Object} updates - Updates to apply
 */
async function updateTaskInDatabase(userId, taskId, updates) {
  console.log(`[Database] Updating task ${taskId} for user ${userId}:`, updates);
  
  // Build update object
  const dbUpdates = {};
  Object.keys(updates).forEach(key => {
    dbUpdates[`activeTasks.$.${key}`] = updates[key];
  });
  
  // Ensure progress updates include step data to fix undefined steps and percentages
  if (!dbUpdates['activeTasks.$.stepData']) {
    dbUpdates['activeTasks.$.stepData'] = updates.stepData || {};
  }

  // Update task in database
  try {
    await User.updateOne(
      { _id: userId, 'activeTasks._id': taskId },
      { $set: dbUpdates }
    );
    
    // Send update to client
    sendWebSocketUpdate(userId, {
      event: 'taskUpdate',
      taskId,
      ...updates,
      stepData: updates.stepData || {} // Ensure stepData is sent in updates
    });
  } catch (error) {
    console.error(`[Database] Error updating task:`, error);
  }
}

/**
 * Add intermediate result to task
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {Object} result - Result to add
 */
async function addIntermediateResult(userId, taskId, result) {
  console.log(`[Database] Adding intermediate result for task ${taskId}`);
  
  try {
    // Add result to task
    await User.updateOne(
      { _id: userId, 'activeTasks._id': taskId },
      { 
        $push: { 
          'activeTasks.$.intermediateResults': result 
        },
        $inc: {
          'activeTasks.$.progress': 10 // Increment progress by 10%
        }
      }
    );
    
    // Send update to client
    sendWebSocketUpdate(userId, {
      event: 'intermediateResult',
      taskId,
      result
    });
  } catch (error) {
    console.error(`[Database] Error adding intermediate result:`, error);
  }
}

/**
 * Analyzes the current page state and compares it to previous state to determine step progress
 * @param {number} currentStep - The current step number
 * @param {Page} page - Puppeteer page object
 * @param {PuppeteerAgent} agent - Browser agent for AI operations
 * @param {string} commandOrQuery - The command or query that was executed
 * @param {string} stepDescription - Description of the current step
 * @param {Object} stepMap - Map of all steps with their status and results
 * @returns {Object} - The finality status object
 */
async function handleTaskFinality(currentStep, page, agent, commandOrQuery, stepDescription, stepMap) {
  // Get current page basic info
  const currentUrl = await page.url();
  const pageTitle = await page.title();
  
  // Create step tracking entry if it doesn't exist
  if (!stepMap[currentStep]) {
    stepMap[currentStep] = {
      step: currentStep,
      description: stepDescription,
      status: "started",
      beforeInfo: null,
      afterInfo: null,
      progress: "pending"
    };
  }
  
  // Get the last step info if available
  const lastStep = currentStep > 0 ? stepMap[currentStep - 1] : null;
  const lastStepData = lastStep ? lastStep.afterInfo : "No previous step data";
  
  // Construct context for AI query before action
  if (!stepMap[currentStep].beforeInfo) {
    const beforeContext = `
      I'm analyzing a web page before performing an action. 
      Current URL: ${currentUrl}
      Page Title: ${pageTitle}
      Step ${currentStep}: ${stepDescription}
      Command/Query to execute: ${commandOrQuery}
      
      Extract only key main content that is relevant to the command/query. Ignore navigation elements, 
      ads, and other unrelated content. Focus on prices, product details, main text content, or other 
      data that will help determine if the action succeeds. Be specific and concise describing whats visible.
    `;
    
    try {
      // Use aiQuery to get page information before action
      const beforeInfo = await agent.aiQuery(beforeContext);
      stepMap[currentStep].beforeInfo = beforeInfo;
    } catch (error) {
      console.error(`[TaskFinality] Error getting before info: ${error.message}`);
      stepMap[currentStep].beforeInfo = "Error extracting page information";
    }
  }
  
  // Construct context for AI query after action
  const afterContext = `
    I'm analyzing a web page after performing an action to determine if it succeeded.
    Current URL: ${currentUrl}
    Page Title: ${pageTitle}
    Step ${currentStep}: ${stepDescription}
    Command/Query that was executed: ${commandOrQuery}
    
    What I saw before the action: ${stepMap[currentStep].beforeInfo || "No before information"}
    Previous step info: ${lastStepData}
    
    Extract only key main content that is relevant to the command/query. Ignore navigation elements, 
    ads, and other unrelated content. Focus on prices, product details, main text content, or other 
    data that will help determine if the command execution changed what was on the page and achieved the action desired. 
    Pay attention to the page before & after changes in relation to the command executed and state if the command action suceeded or not.
    
    Start your response with either "PROGRESSED: " or "UNPROGRESSED: " based on whether the page 
    content shows the action was successful.
    If UNPROGRESSED make sure to suggestion a different navigation action. Menus, different search query in url
    Then provide the extracted information currently visible. Be specific and consise.
  `;
  
  try {
    // Use aiQuery to get page information after action
    const afterInfo = await agent.aiQuery(afterContext);
    stepMap[currentStep].afterInfo = afterInfo;
    
    // Determine if step progressed based on AI response
    if (afterInfo.toLowerCase().startsWith("progressed:")) {
      stepMap[currentStep].status = "completed";
      stepMap[currentStep].progress = "progressed";
    } else {
      stepMap[currentStep].status = "completed";
      stepMap[currentStep].progress = "unprogressed";
    }
    
    // Clean up the extracted info by removing the progress marker
    const cleanedInfo = afterInfo.replace(/^(PROGRESSED|UNPROGRESSED):\s*/i, "").trim();
    
    // Generate summary of all steps for LLM context
    const stepSummary = generateStepSummary(stepMap);
    
    return {
      currentStep,
      stepDescription,
      currentUrl,
      pageTitle,
      commandOrQuery,
      executed: true,
      status: stepMap[currentStep].progress,
      extractedInfo: cleanedInfo,
      stepSummary
    };
  } catch (error) {
    console.error(`[TaskFinality] Error getting after info: ${error.message}`);
    stepMap[currentStep].status = "error";
    stepMap[currentStep].progress = "error";
    stepMap[currentStep].afterInfo = `Error: ${error.message}`;
    
    // Even with error, try to generate step summary
    const stepSummary = generateStepSummary(stepMap);
    
    return {
      currentStep,
      stepDescription,
      currentUrl,
      pageTitle,
      commandOrQuery,
      executed: false,
      status: "error",
      error: error.message,
      stepSummary
    };
  }
}

/**
 * Generates a summary of all steps for LLM context
 * @param {Object} stepMap - Map of all steps with their status and results
 * @returns {string} - Summary of all steps
 */
function generateStepSummary(stepMap) {
  let summary = "STEP PROGRESS SUMMARY:\n\n";
  
  const steps = Object.values(stepMap).sort((a, b) => a.step - b.step);
  
  for (const step of steps) {
    const statusEmoji = step.progress === "progressed" ? "✅" : 
                        step.progress === "unprogressed" ? "⚠️" : 
                        step.progress === "error" ? "❌" : "⏳";
    
    summary += `${statusEmoji} Step ${step.step}: ${step.description}\n`;
    
    if (step.status === "completed" || step.status === "error") {
      summary += `   Result: ${step.afterInfo ? step.afterInfo.substring(0, 150) : "No result data"}\n`;
      if (step.afterInfo && step.afterInfo.length > 150) {
        summary += "   ...(truncated)\n";
      }
    }
    
    summary += "\n";
  }
  
  return summary;
}

/**
 * Process task completion and generate reports
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
    // Get final screenshot if available
    let finalScreenshot = null;
    let lastTaskId = null;
    let agent = null;

    if (intermediateResults.length > 0) {
      const lastResult = intermediateResults[intermediateResults.length - 1];
      if (lastResult.task_id) {
        lastTaskId = lastResult.task_id;
        if (activeBrowsers.has(lastTaskId)) {
          const { page, agent: activeAgent } = activeBrowsers.get(lastTaskId);
          finalScreenshot = await page.screenshot({ encoding: 'base64' });
          agent = activeAgent; // Save agent for Midscene report access
        }
      }
      if (lastResult.screenshot) {
        finalScreenshot = lastResult.screenshot;
      }
    }

    // Save final screenshot
    let finalScreenshotPath = null;
    if (finalScreenshot) {
      finalScreenshotPath = path.join(runDir, `final-screenshot-${Date.now()}.png`);
      fs.writeFileSync(finalScreenshotPath, Buffer.from(finalScreenshot, 'base64'));
      console.log(`[TaskCompletion] Saved final screenshot to ${finalScreenshotPath}`);
    }

    // Generate custom landing page report
    const landingReportPath = await generateReport(
      originalPrompt,
      intermediateResults,
      finalScreenshotPath ? `/midscene_run/${runId}/${path.basename(finalScreenshotPath)}` : null,
      runId
    );

    // Locate and edit Midscene SDK report
    let midsceneReportPath = null;
    let midsceneReportUrl = null;
    if (agent) {
      await agent.writeOutActionDumps(); // Generate Midscene SDK report
      midsceneReportPath = agent.reportFile; // Get the report file path
      if (midsceneReportPath && fs.existsSync(midsceneReportPath)) {
        midsceneReportPath = await editMidsceneReport(midsceneReportPath); // Edit the report
        midsceneReportUrl = `/midscene_run/report/${path.basename(midsceneReportPath)}`;
      } else {
        console.error(`[TaskCompletion] Midscene SDK report not found at ${midsceneReportPath}`);
      }
    } else {
      console.warn(`[TaskCompletion] No agent available to generate Midscene SDK report`);
    }

    // Include the last URL visited in finalResult to fix history card URL display
    // Extract the last currentUrl from intermediateResults
    const lastResult = intermediateResults[intermediateResults.length - 1];
    const url = lastResult?.result?.currentUrl || 'N/A';

    // Ensure final AI-prepared summary is included in finalResult for NLI output
    const finalResult = {
      success: true,
      intermediateResults,
      finalScreenshotPath: finalScreenshotPath ? `/midscene_run/${runId}/${path.basename(finalScreenshotPath)}` : null,
      landingReportUrl: landingReportPath ? `/midscene_run/report/${path.basename(landingReportPath)}` : null,
      midsceneReportUrl,
      summary: lastResult || "Task execution completed",
      url: url, // Added for history card URL display
    };

    console.log(`[TaskCompletion] Task completed with status: ${finalResult.success ? 'success' : 'partial success'}`);
    return finalResult;

  } catch (error) {
    console.error(`[TaskCompletion] Error:`, error);

    // Generate error report
    const errorReportFile = `error-report-${Date.now()}.html`;
    const errorReportPath = path.join(REPORT_DIR, errorReportFile);
    const errorReportContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>O.P.E.R.A.T.O.R Error Report</title>
        <link rel="icon" href="/assets/images/dail-fav.png">
        <style>
          body { background: linear-gradient(to bottom, #1a1a1a, #000); color: #e8e8e8; font-family: Arial, sans-serif; }
          .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
          .header { display: flex; align-items: center; margin-bottom: 30px; }
          .logo { width: 50px; margin-right: 20px; }
          .content { background-color: #111; padding: 20px; border-radius: 10px; }
          .error { background-color: rgba(255, 0, 0, 0.2); padding: 15px; border-radius: 5px; }
          .detail-content { background-color: dodgerblue; border-radius: 10px; padding: 10px; color: #000; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <img src="/assets/images/dail-fav.png" alt="OPERATOR_logo" class="logo">
            <h1>O.P.E.R.A.T.O.R - Error Report</h1>
          </div>
          <div class="content">
            <h2>Task Details</h2>
            <div class="detail-content">
              <p><strong>Command:</strong> ${originalPrompt}</p>
              <p><strong>Run ID:</strong> ${runId}</p>
              <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            </div>
            <h2>Error Details</h2>
            <div class="error">
              <p><strong>Error Message:</strong> ${error.message}</p>
              <pre>${error.stack}</pre>
            </div>
            <h2>Partial Results</h2>
            ${intermediateResults.map((result, index) => `
              <div class="task">
                <div class="task-header">Step ${index + 1}</div>
                <pre>${JSON.stringify(result, null, 2)}</pre>
              </div>
            `).join('')}
          </div>
        </div>
      </body>
      </html>
    `;
    fs.writeFileSync(errorReportPath, errorReportContent);
    console.log(`[TaskCompletion] Saved error report to ${errorReportPath}`);

    return {
      success: false,
      error: error.message,
      intermediateResults,
      reportUrl: `/midscene_run/report/${errorReportFile}`
    };
  } finally {
    // Clean up browser sessions
    for (const [id, { browser }] of activeBrowsers.entries()) {
      try {
        await browser.close();
        activeBrowsers.delete(id);
        console.log(`[TaskCompletion] Closed browser session ${id}`);
      } catch (error) {
        console.error(`[TaskCompletion] Error closing browser session ${id}:`, error);
      }
    }
  }
}

/**
 * Save and optimize screenshot
 * @param {string} screenshotBase64 - Base64-encoded screenshot
 * @param {string} directory - Directory to save to
 * @param {string} filename - Filename (without extension)
 * @returns {string} - Path to saved screenshot
 */
async function saveOptimizedScreenshot(screenshotBase64, directory, filename) {
  try {
    // Import sharp for image optimization if available
    let sharp;
    try {
      sharp = await import('sharp');
    } catch (error) {
      console.warn('[Screenshot] Sharp library not available, saving without optimization');
    }
    
    const timestamp = Date.now();
    const screenshotPath = path.join(directory, `${filename}-${timestamp}.png`);
    
    if (sharp) {
      // Save optimized screenshot with sharp
      const buffer = Buffer.from(screenshotBase64, 'base64');
      await sharp(buffer)
        .png({ quality: 85, compressionLevel: 8 })
        .toFile(screenshotPath);
        
      console.log(`[Screenshot] Saved optimized screenshot to ${screenshotPath}`);
    } else {
      // Save without optimization
      fs.writeFileSync(screenshotPath, Buffer.from(screenshotBase64, 'base64'));
      console.log(`[Screenshot] Saved unoptimized screenshot to ${screenshotPath}`);
    }
    
    return screenshotPath;
  } catch (error) {
    console.error(`[Screenshot] Error saving screenshot:`, error);
    
    // Fallback to basic save
    const fallbackPath = path.join(directory, `${filename}-fallback-${Date.now()}.png`);
    fs.writeFileSync(fallbackPath, Buffer.from(screenshotBase64, 'base64'));
    console.log(`[Screenshot] Saved fallback screenshot to ${fallbackPath}`);
    
    return fallbackPath;
  }
}

/**
 * Generate custom landing page report
 * @param {string} prompt - Original prompt
 * @param {Array} results - Task results
 * @param {string} screenshotPath - Path to final screenshot
 * @param {string} runId - Run ID
 * @returns {string} - Path to landing report file
 */
async function generateReport(prompt, results, screenshotPath, runId) {
  console.log(`[LandingReport] Generating landing report for run ${runId}`);

  const reportContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>O.P.E.R.A.T.O.R Report</title>
      <link rel="icon" href="/assets/images/dail-fav.png">
      <style>
        body {
          background: linear-gradient(to bottom, #1a1a1a, #000);
          color: #e8e8e8;
          font-family: Arial, sans-serif;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        .header {
          display: flex;
          align-items: center;
          margin-bottom: 30px;
        }
        .logo {
          width: 50px;
          margin-right: 20px;
        }
        .replay-button {
          margin-left: auto;
          padding: 10px 20px;
          background-color: dodgerblue;
          color: #000;
          text-decoration: none;
          border-radius: 5px;
          font-weight: bold;
        }
        .replay-button:hover {
          background-color: #1e90ff;
        }
        .content {
          background-color: #111;
          padding: 20px;
          border-radius: 10px;
        }
        .screenshot {
          max-width: 100%;
          border-radius: 5px;
          margin: 20px 0;
        }
        .task {
          background-color: #222;
          padding: 15px;
          margin-bottom: 15px;
          border-radius: 5px;
        }
        .task-header {
          font-weight: bold;
          margin-bottom: 10px;
        }
        .detail-content {
          background-color: dodgerblue;
          border-radius: 10px;
          padding: 10px;
          color: #000;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <img src="/assets/images/dail-fav.png" alt="OPERATOR_logo" class="logo">
          <h1>O.P.E.R.A.T.O.R - Sentinel Report</h1>
          <a id="replayButton" href="#" class="replay-button">Replay</a>
        </div>
        <div class="content">
          <h2>Task Details</h2>
          <div class="detail-content">
            <p><strong>Command:</strong> ${prompt}</p>
            <p><strong>Run ID:</strong> ${runId}</p>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          </div>
          <h2>Execution Results</h2>
          ${results.map((result, index) => {
            let resultDisplay = '';
            if (result.error) {
              resultDisplay = `
                <div class="task error">
                  <div class="task-header">Step ${index + 1} - Error</div>
                  <pre>${JSON.stringify(result, null, 2)}</pre>
                </div>`;
            } else if (result.screenshot) {
              const screenshotUrl = result.screenshotPath || `/midscene_run/${runId}/${result.screenshot}`;
              resultDisplay = `
                <div class="task">
                  <div class="task-header">Step ${index + 1} - Screenshot</div>
                  <img src="${screenshotUrl}" class="screenshot" alt="Step ${index + 1} Screenshot">
                  ${result.summary ? `<p>${result.summary}</p>` : ''}
                </div>`;
            } else {
              resultDisplay = `
                <div class="task">
                  <div class="task-header">Step ${index + 1}</div>
                  <pre>${JSON.stringify(result, null, 2)}</pre>
                </div>`;
            }
            return resultDisplay;
          }).join('')}
          ${screenshotPath ? `<h2>Final State</h2><img src="${screenshotPath}" class="screenshot" alt="Final Screenshot">` : ''}
        </div>
      </div>
    </body>
    </html>
  `;

  const reportFile = `landing-report-${Date.now()}.html`;
  const reportPath = path.join(REPORT_DIR, reportFile);
  fs.writeFileSync(reportPath, reportContent);
  console.log(`[LandingReport] Saved landing report to ${reportPath}`);
  return reportPath;
}

/**
 * Edit the Midscene SDK report with branding and fallbacks
 * @param {string} midsceneReportPath - Path to the Midscene SDK report
 * @returns {string} - Path to the edited report
 */
async function editMidsceneReport(midsceneReportPath) {
  console.log(`[MidsceneReport] Editing Midscene SDK report at ${midsceneReportPath}`);

  const cheerio = await import('cheerio');
  const reportContent = fs.readFileSync(midsceneReportPath, 'utf8');
  const $ = cheerio.load(reportContent);

  // 1. Update the report title
  $('title').text('VLM Run Report | O.P.E.R.A.T.O.R.');
      
  // 2. Update favicon 
  $('link[rel="icon"]').attr('href', '/assets/images/dail.png');
  
  // 3. Replace logo images - Multiple targeting strategies for maximum reliability
  const localLogoPath = '/assets/images/dail.png';
  
  // Target by alt text (case insensitive)
  $('img[alt*="midscene" i], img[alt*="Midscene" i]').each(function() {
    $(this).attr('src', localLogoPath);
    $(this).attr('alt', 'OPERATOR_logo');
  });
  
  // Target by src attribute containing Midscene.png
  $('img[src*="Midscene.png"]').each(function() {
    $(this).attr('src', localLogoPath);
    $(this).attr('alt', 'OPERATOR_logo');
  });
  
  // Target by class name containing logo
  $('img[class*="logo"]').each(function() {
    $(this).attr('src', localLogoPath);
    $(this).attr('alt', 'OPERATOR_logo');
  });

  // Update SDK version with JavaScript
  const newSdkVersion = "1.0.1";
  $('script[type="midscene_web_dump"]').each(function () {
    let scriptContent = $(this).html();
    try {
      const jsonMatch = scriptContent.match(/(\{[\s\S]*\})/);
      if (jsonMatch && jsonMatch[0]) {
        const data = JSON.parse(jsonMatch[0]);
        if (data.executions) {
          data.executions.forEach(exec => { if (exec.sdkVersion) exec.sdkVersion = newSdkVersion; });
        }
        if (data.groupName) data.groupName = "O.P.E.R.A.T.O.R - Sentinel Report";
        scriptContent = scriptContent.replace(jsonMatch[0], JSON.stringify(data, null, 2));
        $(this).html(scriptContent);
      }
    } catch (error) {
      scriptContent = scriptContent.replace(/"sdkVersion"\s*:\s*"([^"]+)"/g, `"sdkVersion": "${newSdkVersion}"`);
      $(this).html(scriptContent);
    }
  });

  // Add CSS fallbacks and custom styles
  $('head').append(`
    <style>
      /* General styling */
      body { background: linear-gradient(to bottom, #1a1a1a, #000); color: #e8e8e8; }
      .side-bar, .page-nav, .panel-title { background: #000 !important; color: #e8e8e8 !important; }
      .main-right .main-content-container, .detail-panel { background: #111 !important; color: #FFF !important; }
      .detail-side .item-list .item, .page-nav, .page-side, .main-right .main-content-container, .detail-side .meta-kv, .timeline-wrapper { border-color: #333 !important; }
      a, .side-item-name, .meta-key, .meta-value { color: #e8e8e8 !important; }
      .main-right .main-side, .detail-content { background-color: dodgerblue !important; color: #000 !important; }

      /* CSS fallback for logo replacement */
      img[src*="Midscene.png"], img[alt*="midscene" i], img[class*="logo"] {
        content: url("/assets/images/dail-fav.png") !important;
        width: 50px !important;
      }

      /* CSS fallback for version number update */
      .task-list-sub-name:contains("v0.12.8"),
      .task-list-sub-name:contains("v0."),
      .task-list-sub-name:contains("default model") {
        visibility: hidden;
        position: relative;
      }
      .task-list-sub-name:contains("v0.12.8")::after,
      .task-list-sub-name:contains("v0.")::after,
      .task-list-sub-name:contains("default model")::after {
        content: "v${newSdkVersion}, OPERATOR model";
        visibility: visible;
        position: absolute;
        left: 0;
        color: #e8e8e8;
      }

      /* Logo replacement fallback */
          img[alt*="midscene" i], 
          img[alt*="Midscene" i], 
          img[src*="Midscene.png"],
          .logo img {
            content: url("/assets/images/dail.png") !important;
          }
          
          /* Version number replacement */
          .task-list-sub-name:contains("v0.12.8"),
          .task-list-sub-name:contains("v0."),
          .task-list-sub-name:contains("default model") {
            visibility: hidden;
            position: relative;
          }
          
          .task-list-sub-name:contains("v0.12.8")::after,
          .task-list-sub-name:contains("v0.")::after,
          .task-list-sub-name:contains("default model")::after {
            content: "v${newSdkVersion}, OPERATOR model";
            visibility: visible;
            position: absolute;
            left: 0;
          }
    </style>
  `);

  // Save the updated report
  fs.writeFileSync(midsceneReportPath, $.html());
  console.log(`[MidsceneReport] Updated Midscene SDK report at ${midsceneReportPath}`);
  return midsceneReportPath;
}

/**
 * Main NLI endpoint handler with improved step processing
 */
app.post('/nli', requireAuth, async (req, res) => {
  const { prompt, url } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required.' });

  const userId = req.session.user; // ObjectId
  // Fetch the user's email using the ObjectId
  const user = await User.findById(userId);
  if (!user) return res.status(400).json({ success: false, error: 'User not found' });
  const userEmail = user.email; // Use email for WebSocket updates

  const taskId = new mongoose.Types.ObjectId().toString();
  const runId = uuidv4();
  const runDir = path.join(MIDSCENE_RUN_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`[NLI] Starting new task: ${taskId} for user ${userEmail}`);
  console.log(`[NLI] Prompt: ${prompt}`);
  if (url) console.log(`[NLI] URL: ${url}`);

  try {
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          activeTasks: {
            _id: taskId,
            command: prompt,
            status: 'pending',
            progress: 0,
            startTime: new Date(),
            isStreaming: true,
            url: url || null
          }
        }
      }
    );
  } catch (dbError) {
    console.error(`[NLI] Database error:`, dbError);
    return res.status(500).json({ success: false, error: 'Database error' });
  }

  // Immediately respond to client with task info
  res.json({ success: true, taskId, runId });

  // Start task processing in background
  processTask(userId, userEmail, taskId, runId, runDir, prompt, url);
});

/**
 * Process an NLI task by planning steps and executing them sequentially
 */
async function processTask(userId, userEmail, taskId, runId, runDir, prompt, url) {
  let activeBrowserId = null;
  let intermediateResults = [];
  let currentStepIndex = 0;
  let stepMap = {}; // Map to track detailed step information
  
  try {
    // Get relevant chat history for context
    const chatHistory = await ChatHistory.findOne({ userId });
    let recentMessages = [];
    if (chatHistory) {
      recentMessages = chatHistory.messages.slice(-5);
    }

    // Initial system message
    const systemMessage = {
      role: "system",
      content: `
You are an advanced AI task automation assistant. Your purpose is to help users complete complex tasks by breaking them down into manageable steps and executing them sequentially.

GUIDELINES:
1. PERSISTENCE: Never give up on a task. If one approach fails, try alternative methods.
2. AUTONOMY: You must determine steps needed without user input after initial request.
3. PLANNING: Outline a plan with numbered steps for complex tasks. Update the plan based on results.
4. ADAPTABILITY: Review each result and adjust your plan based on new information.
5. COMMUNICATION: Explain what you're doing and why in simple language.
6. PROGRESS TRACKING: Clearly indicate task progress and status.

CAPABILITIES:
- You can call functions to interact with web browsers and desktop applications.
- You maintain context between function calls to track task progress.
- You make decisions based on function results to determine next steps.

FUNCTIONS AVAILABLE:
- browser_action: Execute actions on websites (clicking, typing, navigating, scrolling - no data extraction capabilities, never use for data extraction).
- browser_query: Extract information from websites (it can navigate autonomously to desired page, extract info)
- use these 2 functionas interchangebly where relevant, extraction function to get info and action function for actions only
- You must always start with creating a step-by-step plan and then execute each step.

TASK EXECUTION STRATEGY:
1. After receiving the original request, outline a plan with numbered steps. Try not breaking the plan into smaller steps if it's straightforward browser_action and browser_query use Visual Language Models and are autonomous.
2. Call appropriate function(s) to execute each step.
3. Evaluate the result and update the plan if needed (e.g., "Step 2 completed, adjusting Step 3").
4. Repeat until the task is complete or 10 function calls are made.
5. If 10 function calls are reached, summarize progress and return a status update.
6. Summarize the steps accomplished only. But when it comes to data requested or crucial to the users ask, you must detail the key information for depth and clarity, with maximum focus on key data like prices, names, dates, reviews, users, etc.
7. For browser_action and browser_query, if a URL is provided in the user prompt or context, include it in the function call under the 'url' parameter for new tasks. If continuing a previous task, use the 'task_id' parameter instead.
8. You can switch between browser_action to navigate to correct page and section, then switch to browser_query to extract information, then use that information to call browser_action again to do another action based on the new info you have. browser_action does not return data its for actions only. browser_query can do limited navigation and exctract all the data - its best to call it when on the page required and the next step is extracting info.
9. PAY CAREFUL ATTENTION to the step summaries returned after each step. They contain valuable information about the current state of each step, including whether it was successful and what information was extracted.


GENERAL TIPS::
1. DIRECT URL NAVIGATION: For search queries and known patterns, construct URLs directly:
   - Google search: https://google.com/search?q=your+query
   - Amazon search: https://amazon.com/s?k=your+query
   - YouTube search: https://youtube.com/results?search_query=your+query
   - Never rely on coinbase.com, use a search query or click the main menu, the homepage shows pictures not clickable elements
   
2. MULTI-APPROACH PIPELINE: If direct navigation fails:
   a. Try query parameter URL navigation first
   b. Try site search functionality 
   c. Try step-by-step UI navigation as last resort
   
3. COMMANDS VS URLS:
   - Trust aiAction with multi-step commands like "go to google and search for X"
   - If that fails, switch to URL-based navigation
   - Break complex commands into simple steps only when necessary

4. ERROR RECOVERY:
   - When stuck on a page, try URL construction with query parameters, or instruct browser_action to navigate through main menu or sidebar.
   - When element selection fails, try different selectors or wait longer
   - When timeouts occur, retry with longer timeouts
- Scroll down to look for information required.
- If a page is not changing its a dead end, use main menu or other menus to navigate to desired page, then try clicking again
- Overlays can affect navigation, check if the overlay is still there, if so, try to click a button to accept or close the overlay
- Retry using different navigation so you never fail, persistance is required always, be smart in browsing.

ALWAYS TRY MULTIPLE APPROACHES IF ONE FAILS. BE PERSISTENT.

Always reference the original request to ensure you're making progress toward the user's goal.
${url ? `The user has provided a starting URL: ${url}. Use this URL for browser_action or browser_query calls when starting a new task.` : ''}
      `
    };

    // First, get LLM to plan the steps
    console.log(`[NLI] Planning steps for task: ${taskId}`);
    const planResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        systemMessage,
        ...recentMessages,
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 1000
    });

    const planContent = planResponse.choices[0].message.content;
    console.log(`[NLI] Task plan: ${planContent}`);
    
    // Extract steps from the plan
    const stepMatches = planContent.match(/\d+\.\s*(.*?)(?=\n\d+\.|\n*$)/gs) || [];
    const steps = stepMatches.map(step => step.trim().replace(/^\d+\.\s*/, ''));
    
    if (steps.length === 0) {
      throw new Error("Could not parse steps from the plan");
    }

    // Initialize step map with all steps
    steps.forEach((step, index) => {
      stepMap[index] = {
        step: index,
        description: step,
        status: "pending",
        beforeInfo: null,
        afterInfo: null,
        progress: "pending"
      };
    });

    // Store the plan in the database and notify the user
    await User.updateOne(
      { _id: userId, 'activeTasks._id': taskId },
      { 
        $set: { 
          'activeTasks.$.plan': planContent,
          'activeTasks.$.steps': steps,
          'activeTasks.$.totalSteps': steps.length,
          'activeTasks.$.currentStep': 0,
          'activeTasks.$.status': 'processing',
          'activeTasks.$.stepMap': stepMap
        } 
      }
    );

    // Send initial plan to client
    sendWebSocketUpdate(userEmail, {
      event: 'taskPlan',
      taskId,
      plan: planContent,
      steps: steps,
      totalSteps: steps.length
    });

    // Initialize messages array with system message and user prompt
    let messages = [
      systemMessage,
      ...recentMessages,
      { role: "user", content: prompt },
      { role: "assistant", content: planContent }
    ];

    // Process each step
    const MAX_STEPS = 10;
    const actualSteps = Math.min(steps.length, MAX_STEPS);
    
    for (let i = 0; i < actualSteps; i++) {
      currentStepIndex = i;
      const stepDescription = steps[i];
      console.log(`[NLI] Processing step ${i + 1}/${actualSteps}: ${stepDescription}`);
      
      // Update step status in step map
      stepMap[i].status = "processing";
      
      // Update database and notify client that we're starting this step
      await User.updateOne(
        { _id: userId, 'activeTasks._id': taskId },
        { 
          $set: { 
            'activeTasks.$.currentStep': i,
            'activeTasks.$.progress': Math.floor((i / actualSteps) * 100),
            'activeTasks.$.currentStepDescription': stepDescription,
            'activeTasks.$.stepMap': stepMap
          } 
        }
      );
      
      // Notify user of current step being processed (before execution)
      sendWebSocketUpdate(userEmail, {
        event: 'stepStart',
        taskId,
        stepIndex: i,
        stepDescription: stepDescription,
        progress: Math.floor((i / actualSteps) * 100)
      });

      // Get the LLM to determine the function to call for this step
      const stepFunctionResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          ...messages,
          { 
            role: "user", 
            content: `Now execute step ${i + 1}: ${stepDescription}. Based on the current state and this step, determine whether to use browser_action or browser_query and what parameters to use. If this is the first step and we need a URL, use the URL provided: ${url || "No URL was provided, you'll need to determine an appropriate starting URL."}. If we're continuing from a previous step, use the task_id from the previous step: ${activeBrowserId || "No previous browser session exists yet."}`
          }
        ],
        max_tokens: 300,
        temperature: 0.2,
        functions: [
          {
            name: "browser_action",
            description: "Perform an action on a web page. Provide 'url' for new tasks or 'task_id' to continue.",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string", description: "Action to perform (e.g., 'search for cats on Google' or 'Scroll down and look for Solana then click it' or 'press Esc key on page through browser_action')" },
                url: { type: "string", description: "URL for new tasks" },
                task_id: { type: "string", description: "ID of an existing task" }
              },
              required: ["command"]
            }
          },
          {
            name: "browser_query",
            description: "Query info from a web page. Provide 'url' for new tasks or 'task_id' to continue.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Info to extract (e.g., 'get the top search result')" },
                url: { type: "string", description: "URL for new tasks" },
                task_id: { type: "string", description: "ID of an existing task" }
              },
              required: ["query"]
            }
          }
        ],
        function_call: "auto"
      });

      const functionMessage = stepFunctionResponse.choices[0].message;
      if (!functionMessage.function_call) {
        console.log(`[NLI] No function call for step ${i + 1}, continuing with next step`);
        
        // Update step in stepMap to indicate no function call made
        stepMap[i].status = "skipped";
        stepMap[i].progress = "skipped";
        stepMap[i].afterInfo = "No function call was made for this step";
        
        continue;
      }

      // Extract function details
      const functionName = functionMessage.function_call.name;
      let args = JSON.parse(functionMessage.function_call.arguments);
      
      // Add URL or task_id if needed
      if (!args.url && !args.task_id) {
        if (activeBrowserId) {
          args.task_id = activeBrowserId;
        } else if (url) {
          args.url = url;
        }
      }

      // Log the function call
      console.log(`[NLI] Step ${i + 1} function: ${functionName} with args:`, args);
      
      // Update step in database with function call info
      await User.updateOne(
        { _id: userId, 'activeTasks._id': taskId },
        { 
          $set: { 
            'activeTasks.$.currentStepFunction': functionName,
            'activeTasks.$.currentStepArgs': args,
            'activeTasks.$.stepMap': stepMap
          } 
        }
      );

      // Notify client of function call
      sendWebSocketUpdate(userEmail, {
        event: 'stepFunction',
        taskId,
        stepIndex: i,
        functionName: functionName,
        args: args
      });

      // Execute the function
      let functionResult;
      try {
        if (functionName === "browser_action") {
          functionResult = await handleBrowserAction(args, userId, taskId, runId, runDir, currentStepIndex, stepDescription, stepMap);
        } else if (functionName === "browser_query") {
          functionResult = await handleBrowserQuery(args, userId, taskId, runId, runDir, currentStepIndex, stepDescription, stepMap);
        } else {
          throw new Error(`Unknown function: ${functionName}`);
        }

        // Store browser ID for subsequent steps
        if (functionResult.task_id) {
          activeBrowserId = functionResult.task_id;
        }

        // Store result
        intermediateResults.push(functionResult);
        
        // Update step map in database
        await User.updateOne(
          { _id: userId, 'activeTasks._id': taskId },
          { 
            $set: { 
              'activeTasks.$.stepMap': stepMap
            } 
          }
        );
        
        // If screenshot available, send it to client
        if (functionResult.screenshot) {
          sendWebSocketUpdate(userEmail, {
            event: 'stepScreenshot',
            taskId,
            stepIndex: i,
            screenshot: `data:image/png;base64,${functionResult.screenshot}`,
            screenshotPath: functionResult.screenshotPath
          });
        }
        
        // Notify client of function result
        sendWebSocketUpdate(userEmail, {
          event: 'stepComplete',
          taskId,
          stepIndex: i,
          result: cleanFunctionResult(functionResult),
          success: !functionResult.error,
          stepSummary: functionResult.result?.stepSummary || stepMap[i]?.afterInfo || "No step summary available"
        });
        
      } catch (error) {
        console.error(`[NLI] Error in step ${i + 1}:`, error);
        functionResult = { error: error.message, errorStack: error.stack };
        
        // Update step status in step map to indicate error
        stepMap[i].status = "error";
        stepMap[i].progress = "error";
        stepMap[i].afterInfo = `Error: ${error.message}`;
        
        // Update step map in database
        await User.updateOne(
          { _id: userId, 'activeTasks._id': taskId },
          { 
            $set: { 
              'activeTasks.$.stepMap': stepMap
            } 
          }
        );
        
        // Notify client of step error
        sendWebSocketUpdate(userEmail, {
          event: 'stepError',
          taskId,
          stepIndex: i,
          error: error.message,
          stepMap: stepMap
        });
      }

      // Add the function call and result to messages
      messages.push({
        role: "assistant",
        content: null,
        function_call: { name: functionName, arguments: JSON.stringify(args) }
      });
      
      messages.push({
        role: "function",
        name: functionName,
        content: JSON.stringify(cleanFunctionResult(functionResult))
      });

      // Check if we need to adjust the plan based on the result
      if (i < actualSteps - 1) {
        // Add step summary info to the prompt to better contextualize the decision
        const stepSummary = stepMap[i]?.afterInfo || functionResult.result?.stepSummary || "No step summary available";
        
        const adjustmentResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            ...messages,
            { 
              role: "user", 
              content: `Based on the result of step ${i + 1} and considering the current step summary: "${stepSummary}", do we need to adjust our plan for the remaining steps? If yes, provide the adjusted steps. If no, just say "Continue with the current plan."`
            }
          ],
          max_tokens: 500,
          temperature: 0.2
        });

        const adjustmentContent = adjustmentResponse.choices[0].message.content;
        if (!adjustmentContent.includes("Continue with the current plan")) {
          console.log(`[NLI] Adjusting plan after step ${i + 1}: ${adjustmentContent}`);
          
          // Extract adjusted steps if available
          const adjustedStepMatches = adjustmentContent.match(/\d+\.\s*(.*?)(?=\n\d+\.|\n*$)/gs) || [];
          if (adjustedStepMatches.length > 0) {
            const adjustedSteps = adjustedStepMatches.map(step => step.trim().replace(/^\d+\.\s*/, ''));
            
            // Update remaining steps
            steps.splice(i + 1, steps.length - (i + 1), ...adjustedSteps);
            
            // Update step map with new steps
            for (let j = i + 1; j < steps.length; j++) {
              if (j < MAX_STEPS) {
                stepMap[j] = {
                  step: j,
                  description: steps[j],
                  status: "pending",
                  beforeInfo: null,
                  afterInfo: null,
                  progress: "pending"
                };
              }
            }
            
            // Update database with adjusted steps
            await User.updateOne(
              { _id: userId, 'activeTasks._id': taskId },
              { 
                $set: { 
                  'activeTasks.$.steps': steps,
                  'activeTasks.$.totalSteps': steps.length,
                  'activeTasks.$.planAdjustment': adjustmentContent,
                  'activeTasks.$.stepMap': stepMap
                } 
              }
            );
            
            // Notify client of plan adjustment
            sendWebSocketUpdate(userEmail, {
              event: 'planAdjusted',
              taskId,
              newSteps: steps,
              totalSteps: steps.length,
              adjustment: adjustmentContent,
              stepMap: stepMap
            });
          }
        }
        
        // Add adjustment message to conversation
        messages.push({ role: "assistant", content: adjustmentContent });
      }
    }

    // Generate a comprehensive step summary for final context
    const finalStepSummary = generateStepSummary(stepMap);

    // Final summary generation
    console.log(`[NLI] Task complete, generating summary`);
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        ...messages,
        { 
          role: "user", 
          content: `Please provide a final summary of the task execution. Include what was accomplished, any challenges faced, and the key information requested. Focus on the most important data extracted or actions performed.
          
Here is a summary of all steps executed: ${finalStepSummary}

Be concise but detailed about the key information found. Highlight specific data points (prices, names, dates, reviews, etc.) that were extracted during the task.` 
        }
      ],
      stream: true,
      max_tokens: 1000,
      temperature: 0.2
    });

    // Stream the final summary to the client
    let finalMessage = '';
    let isStreaming = true;
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      finalMessage += content;
      sendWebSocketUpdate(userEmail, {
        event: 'finalSummaryChunk',
        taskId,
        chunk: content,
        streaming: isStreaming
      });
    }
    isStreaming = false;
    sendWebSocketUpdate(userEmail, {
      event: 'finalSummaryComplete',
      taskId,
      summary: finalMessage,
      streaming: isStreaming
    });

    // Process task completion and update database
    const finalResult = await processTaskCompletion(userId, taskId, intermediateResults, prompt, runDir, runId);
    finalResult.aiPrepared = { 
      summary: finalMessage,
      stepSummary: finalStepSummary 
    };

    sendWebSocketUpdate(userEmail, {
      event: 'taskComplete',
      taskId,
      status: 'completed',
      result: finalResult,
      stepMap: stepMap
    });

    await User.updateOne(
      { _id: userId, 'activeTasks._id': taskId },
      {
        $set: {
          'activeTasks.$.status': 'completed',
          'activeTasks.$.progress': 100,
          'activeTasks.$.result': finalResult,
          'activeTasks.$.endTime': new Date(),
          'activeTasks.$.isStreaming': false,
          'activeTasks.$.stepMap': stepMap
        }
      }
    );

    await User.updateOne(
      { _id: userId },
      { $push: { history: { _id: taskId, command: prompt, result: finalResult, timestamp: new Date() } } }
    );

    await ChatHistory.updateOne(
      { userId },
      { $push: { messages: { $each: [{ role: 'user', content: prompt }, { role: 'assistant', content: finalMessage }], $slice: -20 } } },
      { upsert: true }
    );

  } catch (error) {
    console.error(`[NLI] Critical error:`, error);
    
    // Update step map to reflect the error
    if (stepMap[currentStepIndex]) {
      stepMap[currentStepIndex].status = "error";
      stepMap[currentStepIndex].progress = "error";
      stepMap[currentStepIndex].afterInfo = `Critical error: ${error.message}`;
    }
    
    sendWebSocketUpdate(userEmail, {
      event: 'taskError',
      taskId,
      status: 'error',
      error: error.message,
      stepMap: stepMap
    });

    await User.updateOne(
      { _id: userId, 'activeTasks._id': taskId },
      {
        $set: {
          'activeTasks.$.status': 'error',
          'activeTasks.$.progress': 0,
          'activeTasks.$.error': error.message,
          'activeTasks.$.endTime': new Date(),
          'activeTasks.$.isStreaming': false,
          'activeTasks.$.stepMap': stepMap
        }
      }
    );
  } finally {
    // Always close the browser when done
    if (activeBrowserId && activeBrowsers.has(activeBrowserId)) {
      console.log(`[NLI] Closing browser for task_id: ${activeBrowserId}`);
      try {
        await activeBrowsers.get(activeBrowserId).browser.close();
        activeBrowsers.delete(activeBrowserId);
      } catch (err) {
        console.error(`[NLI] Error closing browser:`, err);
      }
    }
  }
}

/**
 * Clean function result to reduce token usage
 * @param {Object} result - Function result
 * @returns {Object} - Cleaned result
 */
function cleanFunctionResult(result) {
  const { screenshot, screenshotPath, ...cleaned } = result;
  return cleaned;
}

/**
 * Helper function for handling task preparation tasks like closing modals or accepting cookies
 * @param {Page} page - Puppeteer page object
 * @param {PuppeteerAgent} agent - Browser agent
 * @returns {boolean} - Whether preparation was successful
 */
async function handleTaskPreparation(page, agent) {
  try {
    // Try to detect and close common overlays (cookie notices, modals, etc.)
    const preparationQuery = `
      Look at the current page and determine if there are any obstacles like cookie notices, 
      modals, or popups. If you find any, tell me what to click to dismiss them (like 'Accept All', 
      'Continue', 'Close', etc.). If there are none, say 'No obstacles detected'.
    `;
    
    const obstacles = await agent.aiQuery(preparationQuery);
    
    if (obstacles.toLowerCase().includes('no obstacles detected')) {
      return true;
    }
    
    // If obstacles were detected, try to dismiss them
    const dismissAction = `
      Look for and dismiss any modals, cookie notices, or popups by clicking 'Accept', 'Close', 
      'Continue', 'I Agree', 'X', or similar buttons. If you see multiple, handle the most prominent one first.
    `;
    
    await agent.aiAction(dismissAction);
    await sleep(500); // Brief pause to let the page update
    
    return true;
  } catch (error) {
    console.error(`[TaskPreparation] Error during preparation:`, error);
    return false;
  }
}

// Start server
const PORT = process.env.PORT || 3400;
server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});

// Handle process termination
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('Mongoose connection closed');
  process.exit(0);
});

process.on('uncaughtException', (err) => { console.error('Uncaught Exception:', err); process.exit(1); });
process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection:', reason); });