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
const MIDSCENE_RUN_DIR = path.join(__dirname, 'sentinel_report');
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
app.use('/sentinel_report', express.static(MIDSCENE_RUN_DIR));
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

    // Update task status in database
    await updateTaskInDatabase(userId, taskId, {
      status: 'processing',
      progress: 50,
      lastAction: command
    });

    // Task preparation in try-catch
    try {
      const preparationSuccessful = await handleTaskPreparation(page, agent);
      console.log("[Midscene] Task preparation status:", preparationSuccessful);
    } catch (error) {
      console.error("[Midscene] Preparation skipped - Error during task preparation:", error);
    }

    // Ensure element visibility (assuming command might include a selector)
    // For simplicity, we'll assume agent.aiAction handles selector identification
    // If a specific selector is needed, pass it via args and use ensureElementVisible here

    // Execute the action
    console.log(`[BrowserAction] Executing command: ${command}`);
    const actionResult = await agent.aiAction(command);
    console.log(`[BrowserAction] Action result:`, actionResult);

    // Capture screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));

    // Verify outcome with handleTaskFinality
    const finalityStatus = await handleTaskFinality(page, agent, command);
    const isSuccess = finalityStatus.status_type === 'success';

    // Get current page state
    const currentUrl = await page.url();
    const pageTitle = await page.title();

    // Create result with verification
    const result = {
      success: isSuccess,
      currentUrl,
      pageTitle,
      actionOutput: actionResult || "No output returned",
      timestamp: new Date().toISOString(),
      type: "action",
      summary: isSuccess ? `Performed: ${command}` : `Failed: ${command}`,
      finalityStatus
    };

    // Update task progress in database
    await addIntermediateResult(userId, taskId, result);

    // Send WebSocket update with milestone
    sendWebSocketUpdate(userId, {
      event: 'taskUpdate',
      taskId,
      status: 'processing',
      progress: 60,
      milestone: isSuccess ? 'Action completed successfully' : 'Action failed'
    });

    return {
      task_id,
      result,
      screenshot,
      screenshotPath: `/sentinel_report/${runId}/${path.basename(screenshotPath)}`
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

    // Task preparation in try-catch
    try {
      const preparationSuccessful = await handleTaskPreparation(page, agent);
      console.log("[Midscene] Task preparation status:", preparationSuccessful);
    } catch (error) {
      console.error("[Midscene] Preparation skipped - Error during task preparation:", error);
    }

    // Ensure element visibility (assuming query might involve a visible element)
    // If a selector is needed, pass it via args and use ensureElementVisible here

    // Suggestion: Enhance query to handle pagination and extract all five fields (title, price, review stars, reviews count, delivery, shipsTo)
    // Modify the query to ensure comprehensive extraction and sorting by review stars
    console.log(`[BrowserQuery] Executing query: ${query}`);
    const enhancedQuery = query.includes("extract details") 
      ? "First, find all product listings for Samsung Galaxy S23 on this page; then, for each listing, extract title, price, review stars, reviews count, delivery information, and shipsTo; then sort these listings by review stars in descending order; finally return the top five listings with their details. If fewer than five listings are found, return all available listings."
      : query;
    const queryResult = await agent.aiQuery(enhancedQuery);
    console.log(`[BrowserQuery] Query result:`, queryResult);

    // Capture screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));

    // Verify outcome with handleTaskFinality
    const finalityStatus = await handleTaskFinality(page, agent, query);
    const isSuccess = finalityStatus.status_type === 'success';

    // Get current page state
    const currentUrl = await page.url();
    const pageTitle = await page.title();

    // Create result with verification
    const result = {
      success: isSuccess,
      currentUrl,
      pageTitle,
      queryOutput: queryResult || "No output returned",
      timestamp: new Date().toISOString(),
      type: "query",
      summary: isSuccess ? `Queried: ${query}` : `Failed: ${query}`,
      finalityStatus
    };

    // Update task progress in database
    await addIntermediateResult(userId, taskId, result);

    // Send WebSocket update with milestone
    sendWebSocketUpdate(userId, {
      event: 'taskUpdate',
      taskId,
      status: 'processing',
      progress: 60,
      milestone: isSuccess ? 'Query completed successfully' : 'Query failed'
    });

    return {
      task_id,
      result,
      screenshot,
      screenshotPath: `/sentinel_report/${runId}/${path.basename(screenshotPath)}`
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

async function handleTaskFinality(page, agent, commandOrQuery) {
  const screenshot = await page.screenshot({ encoding: 'base64' });
  const currentUrl = await page.url();

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are a web agent specialized in verifying automated browsing results. 
Your job is to supervise automated browsing agents to ensure they landed on the right page area for the task. 
You check the user intent, then the screen information and URL. If the screenshot and URL show the agent landed on the intended page to execute the task, return status_type=success. 
If not, return status_type=failed and give a reason. If unsure, return status_type=none. Do not guess.`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${screenshot}` },
          },
          {
            type: "text",
            text: `User intent: ${commandOrQuery}\nCurrent URL: ${currentUrl}`,
          },
        ],
      },
    ],
    max_tokens: 200,
  });

  const analysis = response.choices[0].message.content.toLowerCase();
  const status_type = analysis.includes('success') ? 'success' : analysis.includes('failed') ? 'failed' : 'none';
  return { status_type, reason: analysis };
}

// Utility to extract or generate URL from prompt
async function getUrlFromPrompt(prompt, providedUrl = null) {
  // Use providedUrl if available
  if (providedUrl) {
    return providedUrl;
  }

  // Try to extract a URL from the prompt using regex
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = prompt.match(urlRegex);
  if (matches && matches.length > 0) {
    return matches[0]; // Return the first URL found
  }

  // If no URL is found, infer one
  return await inferUrlFromPrompt(prompt);
}

async function inferUrlFromPrompt(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a URL generation specialist for web automation tasks. Based on the user's prompt, infer the most appropriate URL. You have knowledge of URLs for a vast range of websites and services—far beyond the examples provided. The list of common URLs is **not exhaustive**; it serves only as a guide to help you understand URL formats and structures. Your task is to generate accurate URLs for **any website** mentioned in the prompt, even if it’s not listed below.

**Common URLs (Examples Only):**
** Here’s a broad selection of websites across multiple categories, formatted for easy reference:**
Shopping:
Amazon: https://www.amazon.com, Walmart: https://www.walmart.com, Target: https://www.target.com, Best Buy: https://www.bestbuy.com, eBay: https://www.ebay.com, Etsy: https://www.etsy.com, Alibaba: https://www.alibaba.com, AliExpress: https://www.aliexpress.com, Taobao: https://www.taobao.com, JD.com: https://www.jd.com, Tmall: https://www.tmall.com, Shein: https://www.shein.com, Fashion Nova: https://www.fashionnova.com, Boohoo: https://www.boohoo.com, Newegg: https://www.newegg.com, B&H Photo Video: https://www.bhphotovideo.com

Social Media:
Twitter: https://twitter.com, Facebook: https://www.facebook.com, Instagram: https://www.instagram.com, Snapchat: https://www.snapchat.com, TikTok: https://www.tiktok.com, Pinterest: https://www.pinterest.com, Tumblr: https://www.tumblr.com, Weibo: https://www.weibo.com, LinkedIn: https://www.linkedin.com

Cryptocurrency:
CoinGecko: https://www.coingecko.com, CryptoCompare: https://www.cryptocompare.com, CoinMarketCap: https://coinmarketcap.com, Coinbase: https://www.coinbase.com/explore, Binance: https://www.binance.com, Kucoin: https://www.kucoin.com, Dexscreener: https://dexscreener.com, Kraken: https://www.kraken.com, Bitfinex: https://www.bitfinex.com, Gemini: https://www.gemini.com, MetaMask: https://metamask.io, Trust Wallet: https://trustwallet.com, SushiSwap: https://sushi.com, PancakeSwap: https://pancakeswap.finance

News:
CNN: https://www.cnn.com, BBC: https://www.bbc.com, The New York Times: https://www.nytimes.com, The Guardian: https://www.theguardian.com, Al Jazeera: https://www.aljazeera.com

Entertainment:
YouTube: https://www.youtube.com, Netflix: https://www.netflix.com, Hulu: https://www.hulu.com, Disney+: https://www.disneyplus.com, Twitch: https://www.twitch.tv, Steam: https://store.steampowered.com, Epic Games: https://www.epicgames.com

Food Delivery:
Grubhub: https://www.grubhub.com, Postmates: https://postmates.com, Deliveroo: https://deliveroo.co.uk

Travel:
Booking.com: https://www.booking.com, Expedia: https://www.expedia.com, Airbnb: https://www.airbnb.com, TripAdvisor: https://www.tripadvisor.com

Education:
Coursera: https://www.coursera.org, Udemy: https://www.udemy.com, Khan Academy: https://www.khanacademy.org, edX: https://www.edx.org

Health:
WebMD: https://www.webmd.com, Mayo Clinic: https://www.mayoclinic.org, Healthline: https://www.healthline.com, Teladoc: https://www.teladoc.com

General/Other:
Google: https://www.google.com, Reddit: https://www.reddit.com, Wikipedia: https://www.wikipedia.org, GitHub: https://github.com



**Instructions:**
- Return a single URL string (e.g., "https://www.amazon.com").
- If the prompt mentions a specific website, return its URL (e.g., "visit Amazon" → "https://www.amazon.com").
- If the prompt implies a search on a specific website, use your knowledge to generate the appropriate search URL for that site. For example, "search for BTC on CoinGecko" → "https://www.coingecko.com/en/search?query=BTC".
- If the prompt requests a specific page or action on a website, generate a direct URL for that page or action. For example, "open a Bitcoin chart and check the price" → "https://www.coinbase.com/price/bitcoin".
- For websites not in the examples, use your expertise as a URL specialist to generate the correct URL. If unsure, assume a standard format like "https://www.[sitename].com" and replace "[sitename]" with the website name from the prompt (e.g., "visit New York Times" → "https://www.nytimes.com").
- If the prompt implies a general search without specifying a website (e.g., "find dog videos"), return "https://www.google.com/search?q=<query>".
- Default to "https://www.google.com" if no clear intent is detected.
- Leverage your extensive knowledge of website structures to create URLs for any site, including search URLs or specific pages, even if not explicitly listed. For reference, some search URL patterns include:
  - Amazon: https://www.amazon.com/s?k=<query>
  - YouTube: https://www.youtube.com/results?search_query=<query>
  - CoinGecko: https://www.coingecko.com/en/search?query=<query>`
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error("[Error] Failed to infer URL from prompt:", error);
    return "https://www.google.com"; // Default fallback
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
      finalScreenshotPath ? `/sentinel_report/${runId}/${path.basename(finalScreenshotPath)}` : null,
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
        midsceneReportUrl = `/sentinel_report/report/${path.basename(midsceneReportPath)}`;
        // Update landing report with "Replay" link
        await updateLandingReportWithReplayLink(landingReportPath, midsceneReportUrl);
      } else {
        console.error(`[TaskCompletion] Midscene SDK report not found at ${midsceneReportPath}`);
      }
    } else {
      console.warn(`[TaskCompletion] No agent available to generate Midscene SDK report`);
    }

    // Determine completion status
    const completionStatus = await determineCompletionStatus(originalPrompt, intermediateResults);

    // Include the last URL visited in finalResult to fix history card URL display
    // Extract the last currentUrl from intermediateResults
    const lastResult = intermediateResults[intermediateResults.length - 1];
    const url = lastResult?.result?.currentUrl || 'N/A';

    // Ensure final AI-prepared summary is included in finalResult for NLI output
    const finalResult = {
      success: completionStatus.isSuccess,
      intermediateResults,
      finalScreenshotPath: finalScreenshotPath ? `/sentinel_report/${runId}/${path.basename(finalScreenshotPath)}` : null,
      landingReportUrl: landingReportPath ? `/sentinel_report/report/${path.basename(landingReportPath)}` : null,
      midsceneReportUrl,
      summary: completionStatus.summary || "Task execution completed",
      url: url, // Added for history card URL display
      aiPrepared: { summary: completionStatus.summary || "Task execution completed" } // Ensure AI summary is included
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
      reportUrl: `/sentinel_report/report/${errorReportFile}`
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
 * Helper function to determine task completion status
 * @param {string} originalPrompt - Original prompt
 * @param {Array} results - Task results
 * @returns {Object} - Completion status
 */
async function determineCompletionStatus(originalPrompt, results) {
  // Default completion status
  let status = {
    isSuccess: true,
    summary: "Task executed successfully"
  };
  
  // Check for errors in results
  const hasErrors = results.some(result => result.error);
  if (hasErrors) {
    status.isSuccess = false;
    status.summary = "Task encountered errors during execution";
  }
  
  // Check if the last result indicates success
  if (results.length > 0) {
    const lastResult = results[results.length - 1];
    if (lastResult.success === false) {
      status.isSuccess = false;
      status.summary = lastResult.summary || "Task execution failed in the final step";
    }
  }
  
  return status;
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
              const screenshotUrl = result.screenshotPath || `/sentinel_report/${runId}/${result.screenshot}`;
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

  // Update title
  $('title').text('O.P.E.R.A.T.O.R Report');

  // Update favicon
  $('link[rel="icon"]').attr('href', '/assets/images/dail-fav.png');

  // Replace logo with JavaScript
  $('img[src*="Midscene.png"], img[alt*="midscene" i], img[class*="logo"]').each(function () {
    $(this).attr('src', '/assets/images/dail-fav.png').attr('alt', 'OPERATOR_logo');
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
    </style>
  `);

  // Save the updated report
  fs.writeFileSync(midsceneReportPath, $.html());
  console.log(`[MidsceneReport] Updated Midscene SDK report at ${midsceneReportPath}`);
  return midsceneReportPath;
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
- browser_action: Execute actions on websites (clicking, typing, navigating)
- browser_query: Extract information from websites
- You must always start with one of these functions - direct responses are not helpful.

TASK EXECUTION STRATEGY:
1. After receiving the original request, outline a plan with numbered steps.
2. Call appropriate function(s) to execute each step.
3. Evaluate the result and update the plan if needed (e.g., "Step 2 completed, adjusting Step 3").
4. Repeat until the task is complete or 10 function calls are made.
5. If 10 function calls are reached, summarize progress and return a status update.
6. Summarize what was accomplished.

ERROR HANDLING:
- If an element isn’t found, try alternative selectors or wait 5 seconds and retry.
- If a query returns no data, verify the page has loaded or rephrase the query.
- If navigation fails, check the URL and retry.

Always reference the original request to ensure you're making progress toward the user's goal.
        `
      },
      { role: "user", content: prompt }
    ];
    
    let lastTaskId = null;
    let intermediateResults = [];
    let stepCount = 0;
    const MAX_STEPS = 10;
    const MAX_RETRIES = 3;

    async function withRetry(operation, description) {
      return pRetry(async () => {
        try {
          return await operation();
        } catch (error) {
          console.error(`[NLI] ${description} failed:`, error);
          throw error;
        }
      }, {
        retries: MAX_RETRIES,
        minTimeout: 1000,
        factor: 2, // Exponential backoff: 1s, 2s, 4s
        onFailedAttempt: (error) => {
          console.log(`[NLI] Retry attempt ${error.attemptNumber} for ${description}: ${error.message}`);
        }
      });
    }

    try {
      while (stepCount < MAX_STEPS) {
        console.log(`[NLI] Processing step ${stepCount + 1}`);
        // Call OpenAI API to get next action
        const response = await withRetry(() => openai.chat.completions.create({
          model: "gpt-4o",
          messages,
          functions: [
            {
              name: "browser_action",
              description: "Perform an action on a web page. Provide 'url' for new tasks or 'task_id' to continue.",
              parameters: {
                type: "object",
                properties: {
                  command: { type: "string", description: "Action to perform (e.g., 'search for cats on Google')" },
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
            },
            {
              name: "desktop_action",
              description: "Perfom computer operations on windows or mac os. Open apps, use and nagivate apps, save and close apps. Control mouse and keyboard actions; mouse move, scroll, click, drag and drop, tap, type, etc.",
              parameters: {
                type: "object",
                properties: {
                  command: { type: "string", description: "Action to perfom on the computer (e.g., 'open excel, create a list of numbers from 1 to 10, with 2 columns (Token & Contract Address), and 10 rows, and save it in a text file, close the file.)" },
                  task_id: { type: "string", description: "ID of an existing task" }
                },
                required: ["command"]
              }
            }
          ],
          function_call: "auto"
        }), "OpenAI API call");

        const assistantMessage = response.choices[0].message;
        console.log('[AI Message]', assistantMessage);

        // Check if AI wants to call a function
        if (assistantMessage.function_call) {
          const functionName = assistantMessage.function_call.name;
          const args = JSON.parse(assistantMessage.function_call.arguments);
          
          // Send update to client about task execution
          sendWebSocketUpdate(userId, {
            event: 'taskUpdate',
            taskId,
            status: 'processing',
            progress: stepCount * 10 + 10,
            milestone: `Executing step ${stepCount + 1}: ${functionName}`
          });
          
          // Execute function
          let functionResult;
          try {
            console.log(`[NLI] Executing ${functionName} with args:`, args);
            if (functionName === "browser_action") {
              functionResult = await withRetry(() => handleBrowserAction(args, userId, taskId, runId, runDir), "browser_action");
            } else if (functionName === "browser_query") {
              functionResult = await withRetry(() => handleBrowserQuery(args, userId, taskId, runId, runDir), "browser_query");
            } else if (functionName === "desktop_action") {
              functionResult = await withRetry(() => handleDesktopAction(args.command), "desktop_action");
            } else {
              functionResult = { error: "Unknown function" };
            }

            // Keep track of task Id for browser cleanup & Add function call and result to conversation history 
            if (functionResult.task_id) lastTaskId = functionResult.task_id;
            intermediateResults.push(functionResult);
            
            sendWebSocketUpdate(userId, {
              event: 'taskUpdate',
              taskId,
              status: 'processing',
              progress: stepCount * 10 + 20,
              milestone: `Step ${stepCount + 1} completed`
            });
          } catch (error) {
            console.error(`[NLI] Function execution error after retries:`, error);
            functionResult = { error: error.message, errorStack: error.stack };
            intermediateResults.push(functionResult);
          }

          // Create a clean version of the result to avoid token limits
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

          stepCount++;
        } else {
          // If we've reached the maximum number of steps, stop executing functions
          // Task complete: AI has decided to respond directly
          console.log(`[NLI] Task complete, generating summary`);
          const stream = await withRetry(() => openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            stream: true
          }), "Streaming final response");

          let finalMessage = '';
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            finalMessage += content;
            sendWebSocketUpdate(userId, {
              event: 'taskUpdate',
              taskId,
              status: 'streaming',
              chunk: content
            });
          }
          // Handle task completion and generate report
          const finalResult = await processTaskCompletion(userId, taskId, intermediateResults, prompt, runDir, runId);
          finalResult.aiPrepared = { summary: finalMessage };
          // Update task status and result in the database
          sendWebSocketUpdate(userId, {
            event: 'taskComplete',
            taskId,
            status: 'completed',
            result: finalResult
          });

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
          // Update history with final result
          await User.updateOne(
            { _id: userId },
            { $push: { history: { _id: taskId, command: prompt, result: finalResult, timestamp: new Date() } } }
          );
          // Update chat history with final message
          await ChatHistory.updateOne(
            { userId },
            { $push: { messages: { $each: [{ role: 'user', content: prompt }, { role: 'assistant', content: finalMessage }], $slice: -20 } } },
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

      // Handle step limit reached
      if (stepCount >= MAX_STEPS) {
        console.log(`[NLI] Maximum steps reached for task ${taskId}`);
        const summary = "Task execution reached the maximum number of steps...\n\n" +
          intermediateResults.map((r, i) => `Step ${i + 1}: ${r.summary || 'No summary'}`).join('\n');
        sendWebSocketUpdate(userId, {
          event: 'taskComplete',
          taskId,
          status: 'completed',
          result: { success: false, summary, intermediateResults }
        });
      }
    } catch (error) {
      console.error(`[NLI] Critical error:`, error);
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