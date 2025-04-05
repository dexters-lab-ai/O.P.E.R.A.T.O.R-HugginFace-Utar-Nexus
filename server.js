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

wss.on('connection', (ws, request) => {
  const userId = request.session?.user;
  if (!userId) {
    ws.close();
    return;
  }
  if (!userConnections.has(userId)) userConnections.set(userId, new Set());
  userConnections.get(userId).add(ws);
  console.log(`WebSocket connected for user: ${userId}`);

  ws.on('close', () => {
    userConnections.get(userId).delete(ws);
    if (userConnections.get(userId).size === 0) userConnections.delete(userId);
    console.log(`WebSocket disconnected for user: ${userId}`);
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


const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dailAdmin:ua5^bRNFCkU*--c@operator.smeax.mongodb.net/?retryWrites=true&w=majority&appName=OPERATOR";
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI, // Use MONGO_URI directly instead of client
    dbName: 'dail',
    collectionName: 'sessions',
  }),
}));

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

// Mongoose connection
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB via Mongoose"))
  .catch(err => console.error("Mongoose connection error:", err));

// Mongoose schemas
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  customUrls: [{ type: String }],
  history: [{
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    url: String,
    command: String,
    result: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now },
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
      error: String,
    }],
    intermediateResults: [mongoose.Schema.Types.Mixed],
  }],
});
const User = mongoose.model('User', userSchema);

const chatHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  }],
});
const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);

// Routes
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) throw new Error('Email already exists');
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ email, password: hashedPassword, history: [], activeTasks: [], customUrls: [] });
    req.session.user = newUser._id;
    res.json({ success: true });
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
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

app.get('/history', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const user = await User.findById(req.session.user);
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

app.get('/chat-history', requireAuth, async (req, res) => {
  try {
    const chatHistory = await ChatHistory.findOne({ userId: req.session.user });
    res.json({ messages: chatHistory ? chatHistory.messages : [] });
  } catch (err) {
    console.error('Error fetching chat history:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch chat history' });
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
    const user = await User.findById(req.session.user);
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
      const user = await User.findById(req.session.user);
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
    await sleep(300);
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
  console.log(`[WebSocket] Sending update to ${userId}:`, JSON.stringify(data).substring(0, 200) + '...');
  if (userConnections && userConnections.has(userId)) {
    userConnections.get(userId).forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    });
  }
}

/**
 * Handle browser action commands
 * @param {Object} args - Command arguments
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID
 * @param {string} runDir - Run directory
 * @returns {Object} - Result object
 */
async function handleBrowserAction(args, userId, taskId, runId, runDir) {
  console.log(`[BrowserAction] Starting with args:`, args);
  const { command, url } = args;
  let task_id = args.task_id;
  let browser, agent, page;

  try {
    // Reuse existing browser session or create new one
    if (task_id && activeBrowsers.has(task_id)) {
      console.log(`[BrowserAction] Reusing browser session ${task_id}`);
      ({ browser, agent, page } = activeBrowsers.get(task_id));
    } else {
      if (!url) throw new Error("URL is required for new tasks");
      
      console.log(`[BrowserAction] Creating new browser session for URL: ${url}`);
      const newTaskId = task_id || uuidv4();
      browser = await puppeteerExtra.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1080,768"],
        timeout: 120000
      });
      
      page = await browser.newPage();
      await page.setViewport({ 
        width: 1080, 
        height: 768, 
        deviceScaleFactor: process.platform === "darwin" ? 2 : 1 
      });
      
      console.log(`[BrowserAction] Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 180000 });
      
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

    // Update task status in database
    await updateTaskInDatabase(userId, taskId, {
      status: 'processing',
      progress: 50,
      lastAction: command
    });

    // Execute the action
    console.log(`[BrowserAction] Executing command: ${command}`);
    const actionResult = await agent.aiAction(command);
    console.log(`[BrowserAction] Action result:`, actionResult);
    
    // Capture screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
    
    // Get current page state
    const currentUrl = await page.url();
    const pageTitle = await page.title();
    
    // Create comprehensive result
    const result = { 
      success: true, 
      currentUrl, 
      pageTitle, 
      actionOutput: actionResult,
      timestamp: new Date().toISOString()
    };

    // Update task progress in database
    await addIntermediateResult(userId, taskId, result);

    return {
      task_id,
      result,
      screenshot,
      screenshotPath: `/midscene_run/${runId}/${path.basename(screenshotPath)}`
    };
  } catch (error) {
    console.error(`[BrowserAction] Error:`, error);
    return {
      task_id,
      error: error.message,
      errorStack: error.stack,
      success: false
    };
  }
}

/**
 * Handle browser query commands
 * @param {Object} args - Query arguments
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID
 * @param {string} runDir - Run directory
 * @returns {Object} - Result object
 */
async function handleBrowserQuery(args, userId, taskId, runId, runDir) {
  console.log(`[BrowserQuery] Starting with args:`, args);
  const { query, url, task_id } = args;
  let browser, agent, page;

  try {
    // Reuse existing browser session or create new one
    if (task_id && activeBrowsers.has(task_id)) {
      console.log(`[BrowserQuery] Reusing browser session ${task_id}`);
      ({ browser, agent, page } = activeBrowsers.get(task_id));
    } else {
      if (!url) throw new Error("URL is required for new tasks");
      
      console.log(`[BrowserQuery] Creating new browser session for URL: ${url}`);
      const newTaskId = task_id || uuidv4();
      browser = await puppeteerExtra.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1080,768"],
        timeout: 120000
      });
      
      page = await browser.newPage();
      await page.setViewport({ 
        width: 1080, 
        height: 768, 
        deviceScaleFactor: process.platform === "darwin" ? 2 : 1 
      });
      
      console.log(`[BrowserQuery] Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 180000 });
      
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

    // Update task status in database
    await updateTaskInDatabase(userId, taskId, {
      status: 'processing',
      progress: 50,
      lastQuery: query
    });

    // Execute the query
    console.log(`[BrowserQuery] Executing query: ${query}`);
    const queryResult = await agent.aiQuery(query);
    console.log(`[BrowserQuery] Query result:`, queryResult);
    
    // Capture screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
    
    // Get current page state
    const currentUrl = await page.url();
    const pageTitle = await page.title();
    
    // Create comprehensive result
    const result = { 
      success: true, 
      currentUrl, 
      pageTitle, 
      queryOutput: queryResult,
      timestamp: new Date().toISOString()
    };

    // Update task progress in database
    await addIntermediateResult(userId, taskId, result);

    return {
      task_id,
      result,
      screenshot,
      screenshotPath: `/midscene_run/${runId}/${path.basename(screenshotPath)}`
    };
  } catch (error) {
    console.error(`[BrowserQuery] Error:`, error);
    return {
      task_id,
      error: error.message,
      errorStack: error.stack,
      success: false
    };
  }
}

/**
 * Handle desktop automation actions
 * @param {Object} args - Action arguments
 * @returns {Object} - Result object
 */
async function handleDesktopAction(args) {
  console.log(`[DesktopAction] Starting with args:`, args);
  const { command } = args;
  
  if (command.toLowerCase().includes("open")) {
    const appName = command.split("open")[1]?.trim();
    if (!appName) throw new Error("Application name required");
    
    console.log(`[DesktopAction] Opening application: ${appName}`);
    const result = await openApplication(appName); // Assumes openApplication is defined elsewhere
    return { result };
  }
  
  throw new Error("Unsupported desktop command");
}

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
      ...updates
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
 * Process task completion and generate report
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
    
    if (intermediateResults.length > 0) {
      const lastResult = intermediateResults[intermediateResults.length - 1];
      if (lastResult.task_id) {
        lastTaskId = lastResult.task_id;
        if (activeBrowsers.has(lastTaskId)) {
          const { page } = activeBrowsers.get(lastTaskId);
          finalScreenshot = await page.screenshot({ encoding: 'base64' });
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
    }
    
    // Generate report using Cheerio if needed
    const reportPath = await generateReport(
      originalPrompt,
      intermediateResults,
      finalScreenshotPath ? `/midscene_run/${runId}/${path.basename(finalScreenshotPath)}` : null,
      runId
    );
    
    // Return final result
    return {
      success: true,
      intermediateResults,
      finalScreenshotPath: finalScreenshotPath ? `/midscene_run/${runId}/${path.basename(finalScreenshotPath)}` : null,
      reportUrl: reportPath ? `/midscene_run/report/${path.basename(reportPath)}` : null
    };
  } catch (error) {
    console.error(`[TaskCompletion] Error:`, error);
    return {
      success: false,
      error: error.message,
      intermediateResults
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
 * Generate report for task
 * @param {string} prompt - Original prompt
 * @param {Array} results - Task results
 * @param {string} screenshotPath - Path to final screenshot
 * @param {string} runId - Run ID
 * @returns {string} - Path to report file
 */
async function generateReport(prompt, results, screenshotPath, runId) {
  console.log(`[Report] Generating report for run ${runId}`);
  
  try {
    // Generate report content - simple example
    // In reality, you'd want to use the Cheerio logic from your original code
    const reportContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>O.P.E.R.A.T.O.R Report</title>
        <link rel="icon" href="/assets/images/dail-fav.png">
        <style>
          body {
            background-color: #000;
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
          </div>
          <div class="content">
            <h2>Task Details</h2>
            <div class="detail-content">
              <p><strong>Command:</strong> ${prompt}</p>
              <p><strong>Run ID:</strong> ${runId}</p>
              <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            </div>
            
            <h2>Execution Results</h2>
            ${results.map((result, index) => `
              <div class="task">
                <div class="task-header">Step ${index + 1}</div>
                <pre>${JSON.stringify(result, null, 2)}</pre>
              </div>
            `).join('')}
            
            ${screenshotPath ? `<h2>Final State</h2><img src="${screenshotPath}" class="screenshot">` : ''}
          </div>
        </div>
      </body>
      </html>
    `;
    
    // Save report
    const reportFile = `report-${Date.now()}.html`;
    const reportPath = path.join(REPORT_DIR, reportFile);
    fs.writeFileSync(reportPath, reportContent);
    
    console.log(`[Report] Saved report to ${reportPath}`);
    return reportPath;
  } catch (error) {
    console.error(`[Report] Error generating report:`, error);
    return null;
  }
}

/**
 * Main NLI endpoint handler
 */
app.post('/nli', requireAuth, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required.' });

  const userId = req.session.user;
  const taskId = new mongoose.Types.ObjectId().toString();
  const runId = uuidv4();
  const runDir = path.join(MIDSCENE_RUN_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`[NLI] Starting new task: ${taskId} for user ${userId}`);
  console.log(`[NLI] Prompt: ${prompt}`);

  // Create task in database
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
            isStreaming: true
          }
        }
      }
    );
  } catch (dbError) {
    console.error(`[NLI] Database error:`, dbError);
    return res.status(500).json({ success: false, error: 'Database error' });
  }

  // Send initial response to client
  res.json({ success: true, taskId, runId });

  // Start asynchronous conversation loop
  (async () => {
    let messages = [
      {
        role: "system",
        content: `
You are an advanced AI task automation assistant. Your purpose is to help users complete complex tasks by breaking them down into manageable steps and executing them sequentially.

GUIDELINES:
1. PERSISTENCE: Never give up on a task. If one approach fails, try alternative methods like visiting the homepage of the url and navigate from there. Search queries in URLs are not reliable.
2. AUTONOMY: You must determine steps needed without user input after initial request.
3. PLANNING: Break complex tasks into logical sub-tasks.
4. ADAPTABILITY: Review each result and adjust your plan based on new information.
5. COMMUNICATION: Explain what you're doing and why in simple language.
6. PROGRESS TRACKING: Clearly indicate task progress and status.

CAPABILITIES:
- You can call functions to interact with web browsers and desktop applications.
- You maintain context between function calls to track task progress.
- You make decisions based on function results to determine next steps to accomplish user command/request.

FUNCTIONS AVAILABLE:
- browser_action: Execute actions on websites (clicking, typing, navigating)
- browser_query: Extract information from websites
- You must always start with one of these functions - direct responses are not helpful.

TASK EXECUTION STRATEGY:
1. After receiving the original request, determine the first logical step
2. Call appropriate function(s) to execute that step
3. Evaluate the result
4. Determine next step based on original goal and current progress
5. Repeat until task complete
6. Adjust approach as needed based on new information from the previous step
6. Summarize what was accomplished

Always reference the original request to ensure you're making progress toward the user's goal.
        `
      },
      { role: "user", content: prompt }
    ];
    
    let lastTaskId = null;
    let intermediateResults = [];

    try {
      while (true) {
        console.log(`[NLI] Processing message for task ${taskId}`);
        
        // Call OpenAI API to get next action
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages,
          functions: [
            {
              name: "browser_action",
              description: "Perform an action on a web page. Provide 'url' for new tasks or 'task_id' to continue.",
              parameters: {
                type: "object",
                properties: {
                  command: { type: "string", description: "Action to perform (e.g., 'search for cats on Google', 'close the popup form', 'solve the CAPTHA challenge', 'Navigate to side menu and filter by type', 'fill the form with ...... and submit')" },
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

        const assistantMessage = response.choices[0].message;
        console.log('[AI Message]', assistantMessage);

        // Check if AI wants to call a function
        if (assistantMessage.function_call) {
          const functionName = assistantMessage.function_call.name;
          const args = JSON.parse(assistantMessage.function_call.arguments);
          let functionResult;
          
          // Send update to client about task execution
          sendWebSocketUpdate(userId, {
            event: 'taskUpdate',
            taskId,
            status: 'processing',
            progress: intermediateResults.length * 10 + 10,
            message: `Executing ${functionName}: ${JSON.stringify(args)}`
          });

          // Execute function
          try {
            console.log(`[NLI] Executing ${functionName} with args:`, args);
            
            if (functionName === "browser_action") {
              functionResult = await handleBrowserAction(args, userId, taskId, runId, runDir);
            } else if (functionName === "browser_query") {
              functionResult = await handleBrowserQuery(args, userId, taskId, runId, runDir);
            } else {
              functionResult = { error: "Unknown function" };
            }
            
            console.log(`[NLI] ${functionName} result:`, functionResult);
            
            // Keep track of task ID for browser cleanup
            if (functionResult.task_id) {
              lastTaskId = functionResult.task_id;
            }
            
            // Store result
            intermediateResults.push(functionResult);
            
            // Send update to client
            sendWebSocketUpdate(userId, {
              event: 'taskUpdate',
              taskId,
              status: 'processing',
              progress: intermediateResults.length * 10 + 20,
              result: functionResult
            });
          } catch (error) {
            console.error(`[NLI] Function execution error:`, error);
            functionResult = { error: error.message, errorStack: error.stack };
          }

          // Add function call and result to conversation
          messages.push({
            role: "assistant",
            content: null,
            function_call: {
              name: functionName,
              arguments: JSON.stringify(args)
            }
          });
          
          // Create a clean version of the result to avoid token limits
          const cleanResult = cleanFunctionResult(functionResult);
          
          messages.push({
            role: "function",
            name: functionName,
            content: JSON.stringify(cleanResult)
          });
        } else {
          // Task complete: AI has decided to respond directly
          console.log(`[NLI] Task complete, generating summary`);
          
          // Stream the final response
          const stream = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            stream: true
          });
          
          let finalMessage = '';
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            finalMessage += content;
            
            // Stream content to client
            sendWebSocketUpdate(userId, {
              event: 'taskUpdate',
              taskId,
              status: 'streaming',
              chunk: content
            });
          }
          
          console.log(`[NLI] Final message:`, finalMessage);
          
          // Process completion and generate report
          const finalResult = await processTaskCompletion(
            userId,
            taskId,
            intermediateResults,
            prompt,
            runDir,
            runId
          );
          
          // Add summary to final result
          finalResult.aiPrepared = { summary: finalMessage };
          
          // Send completion to client
          sendWebSocketUpdate(userId, {
            event: 'taskComplete',
            taskId,
            status: 'completed',
            result: finalResult
          });

          // Update task in database
          await User.updateOne(
            { _id: userId, 'activeTasks._id': taskId },
            {
              $set: {
                'activeTasks.$.status': 'completed',
                'activeTasks.$.progress': 100,
                'activeTasks.$.result': finalResult,
                'activeTasks.$.endTime': new Date(),
                'activeTasks.$.isStreaming': false
              }
            }
          );

          // Log to history
          await User.updateOne(
            { _id: userId },
            {
              $push: {
                history: {
                  _id: taskId,
                  command: prompt,
                  result: finalResult,
                  timestamp: new Date()
                }
              }
            }
          );

          // Update chat history
          await ChatHistory.updateOne(
            { userId },
            {
              $push: {
                messages: {
                  $each: [
                    { role: 'user', content: prompt },
                    { role: 'assistant', content: finalMessage }
                  ],
                  $slice: -20
                }
              }
            },
            { upsert: true }
          );

          // Clean up browser sessions
          if (lastTaskId && activeBrowsers.has(lastTaskId)) {
            await activeBrowsers.get(lastTaskId).browser.close();
            activeBrowsers.delete(lastTaskId);
          }

          break;
        }
      }
    } catch (error) {
      console.error(`[NLI] Error:`, error);
      
      // Send error to client
      sendWebSocketUpdate(userId, {
        event: 'taskError',
        taskId,
        status: 'error',
        error: error.message
      });

      // Update task in database
      await User.updateOne(
        { _id: userId, 'activeTasks._id': taskId },
        {
          $set: {
            'activeTasks.$.status': 'error',
            'activeTasks.$.progress': 0,
            'activeTasks.$.error': error.message,
            'activeTasks.$.endTime': new Date(),
            'activeTasks.$.isStreaming': false
          }
        }
      );

      // Clean up browser sessions
      if (lastTaskId && activeBrowsers.has(lastTaskId)) {
        await activeBrowsers.get(lastTaskId).browser.close();
        activeBrowsers.delete(lastTaskId);
      }
    }
  })();
});

/**
 * Clean function result to reduce token usage
 * @param {Object} result - Function result
 * @returns {Object} - Cleaned result
 */
function cleanFunctionResult(result) {
  // Create a copy to avoid modifying the original
  const cleanResult = { ...result };
  
  // Remove large properties
  if (cleanResult.screenshot) {
    // Keep only first 100 chars as a reference
    cleanResult.screenshot = cleanResult.screenshot.substring(0, 100) + '...';
  }
  
  // Add screenshotSize if screenshot was present
  if (result.screenshot) {
    cleanResult.screenshotSize = result.screenshot.length;
  }
  
  // Clean up nested objects
  if (cleanResult.result && typeof cleanResult.result === 'object') {
    // Keep important properties, summarize the rest
    const { currentUrl, pageTitle, success } = cleanResult.result;
    cleanResult.result = { currentUrl, pageTitle, success };
    
    // Add summary of other properties
    if (result.result.actionOutput) {
      cleanResult.result.actionSummary = typeof result.result.actionOutput === 'string' 
        ? result.result.actionOutput.substring(0, 200) + '...'
        : 'Action completed successfully';
    }
    
    if (result.result.queryOutput) {
      cleanResult.result.querySummary = typeof result.result.queryOutput === 'string'
        ? result.result.queryOutput.substring(0, 200) + '...'
        : 'Query executed successfully';
    }
  }
  
  return cleanResult;
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