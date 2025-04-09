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
import { Parser } from 'htmlparser2';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import winston from 'winston';
import pRetry from 'p-retry';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Semaphore } from 'async-mutex';

mongoose.set('strictQuery', true);

// File paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure stealth plugin for puppeteer
puppeteerExtra.use(StealthPlugin());
const browserSemaphore = new Semaphore(5); // Limit to 5 concurrent browsers

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
});

// Define indexes for User schema
userSchema.index({ email: 1 }, { unique: true }); // Email index
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

const taskSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  command: String,
  status: { type: String, enum: ['pending', 'processing', 'completed', 'error'], default: 'pending' },
  progress: { type: Number, default: 0 },
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  result: mongoose.Schema.Types.Mixed,
  error: String,
  url: String,
  runId: String,
  isComplex: { type: Boolean, default: false },
  subTasks: [{
    id: { type: String },
    command: String,
    status: { type: String, enum: ['pending', 'processing', 'completed', 'error'], default: 'pending' },
    result: mongoose.Schema.Types.Mixed,
    progress: { type: Number, default: 0 },
    error: String
  }],
  intermediateResults: [mongoose.Schema.Types.Mixed],
  plan: String,
  steps: [String],
  totalSteps: Number,
  currentStep: Number,
  stepMap: mongoose.Schema.Types.Mixed,
  currentStepDescription: String,
  currentStepFunction: String,
  currentStepArgs: mongoose.Schema.Types.Mixed,
  planAdjustment: String,
  lastAction: String,
  lastQuery: String
});
taskSchema.index({ endTime: 1 }, { expireAfterSeconds: 604000 }); // 7 days
const Task = mongoose.model('Task', taskSchema);

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
    const newUser = await User.create({ email, password: hashedPassword, customUrls: [] });
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
    const userId = req.session.user;

    const totalItems = await Task.countDocuments({ userId, status: 'completed' });
    const tasks = await Task.find({ userId, status: 'completed' })
      .sort({ endTime: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
      items: tasks.map(task => ({
        _id: task._id,
        url: task.url || 'Unknown URL',
        command: task.command,
        timestamp: task.endTime,
        result: task.result
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
    const task = await Task.findOne({ _id: req.params.id, userId: req.session.user }).lean();
    if (!task) return res.status(404).json({ error: 'History item not found' });
    res.json({
      _id: task._id,
      url: task.url || 'Unknown URL',
      command: task.command,
      timestamp: task.endTime,
      result: {
        raw: task.result?.raw || null,
        aiPrepared: task.result?.aiPrepared || null,
        runReport: task.result?.runReport || null
      },
    });
  } catch (err) {
    console.error('Error fetching history item:', err);
    res.status(500).json({ error: 'Failed to fetch history item' });
  }
});

app.delete('/history/:id', requireAuth, async (req, res) => {
  try {
    const result = await Task.deleteOne({ _id: req.params.id, userId: req.session.user });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/history', requireAuth, async (req, res) => {
  try {
    await Task.deleteMany({ userId: req.session.user, status: 'completed' });
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
    const result = await Task.updateOne(
      { _id: req.params.id, userId: req.session.user },
      { $set: { progress: progress } }
    );
    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, error: 'Task not found or not updated' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/tasks/active', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user;
    const activeTasks = await Task.find({ userId, status: { $in: ['pending', 'processing'] } }).lean();
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
      try {
        const task = await Task.findById(req.params.id).lean();
        if (!task) {
          res.write(`data: ${JSON.stringify({ done: true, error: 'Task not found' })}\n\n`);
          clearInterval(updateInterval);
          res.end();
          return;
        }
        res.write(`data: ${JSON.stringify({
          status: task.status,
          progress: task.progress,
          intermediateResults: task.intermediateResults,
          error: task.error,
          result: task.result
        })}\n\n`);
        if (task.status === 'completed' || task.status === 'error') {
          res.write(`data: ${JSON.stringify({
            status: task.status,
            result: task.result,
            error: task.error,
            done: true
          })}\n\n`);
          clearInterval(updateInterval);
          res.end();
        }
      } catch (error) {
        console.error('Error in sendUpdate:', error);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: error.message });
        }
      }
    };

    await sendUpdate();
    const updateInterval = setInterval(sendUpdate, 1000);

    req.on('close', () => {
      clearInterval(updateInterval);
      res.end();
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      console.error('Error after headers sent:', err);
    }
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
  let browser, agent, page, release;

  fs.mkdirSync(runDir, { recursive: true });

  try {
    if (task_id && activeBrowsers.has(task_id)) {
      console.log(`[BrowserAction] Reusing browser session ${task_id}`);
      ({ browser, agent, page, release } = activeBrowsers.get(task_id));
      try {
        await page.evaluate(() => true);
      } catch (err) {
        console.log(`[BrowserAction] Browser session invalid, creating new one`);
        activeBrowsers.delete(task_id);
        task_id = null;
      }
    }

    if (!task_id || !activeBrowsers.has(task_id)) {
      if (!url) throw new Error("URL is required for new tasks");
      console.log(`[BrowserAction] Creating new browser session for URL: ${url}`);
      const newTaskId = uuidv4();
      release = await browserSemaphore.acquire();
      let launchAttempts = 0;
      const maxLaunchAttempts = 3;

      while (launchAttempts < maxLaunchAttempts) {
        try {
          browser = await puppeteerExtra.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
            timeout: 30000
          });
          break;
        } catch (err) {
          launchAttempts++;
          console.error(`[BrowserAction] Browser launch failed (attempt ${launchAttempts}):`, err);
          if (launchAttempts >= maxLaunchAttempts) {
            if (release) release();
            throw err;
          }
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 768, deviceScaleFactor: process.platform === "darwin" ? 2 : 1 });

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
        planningTimeout: 480000,
        maxPlanningRetries: 4
      });

      activeBrowsers.set(newTaskId, { browser, agent, page, release });
      task_id = newTaskId;
    }

    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 30,
      message: `Preparing to execute: ${command}`
    });

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

    const beforeInfo = await handleTaskFinality(currentStep, page, agent, command, stepDescription, stepMap);
    console.log("[BrowserAction] Before state captured:", beforeInfo);

    await updateTaskInDatabase(taskId, {
      status: 'processing',
      progress: 50,
      lastAction: command
    });

    try {
      const preparationSuccessful = await handleTaskPreparation(page, agent);
      console.log("[BrowserAction] Task preparation status:", preparationSuccessful);
    } catch (error) {
      console.error("[BrowserAction] Preparation skipped - Error during task preparation:", error);
    }

    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 50,
      message: `Executing: ${command}`
    });

    //await autoScroll(page); // Scroll before querying
    console.log(`[BrowserAction] Executing command: ${command}`);
    await agent.aiAction(`Scroll into main view to remove header adverts, then execute this command: ${command}. Unresponsive clicks may mean you are clicking an image, find elements only or use main menu if clicking on images fails to navigate further`);
    await sleep(200);

    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));

    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 80,
      message: `Verifying result of: ${command}`
    });

    const finalityStatus = await handleTaskFinality(currentStep, page, agent, command, stepDescription, stepMap);
    console.log("[BrowserAction] Task finality status:", finalityStatus);
    const currentUrl = await page.url();
    const pageTitle = await page.title();
    const isSuccess = finalityStatus.status === "progressed";

    const result = {
      success: isSuccess,
      currentUrl,
      pageTitle,
      actionOutput: `Browser action completed for step ${currentStep}: ${stepDescription}`,
      timestamp: new Date().toISOString(),
      type: "action",
      command,
      extractedInfo: finalityStatus.extractedInfo,
      stepSummary: finalityStatus.stepSummary
    };

    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 100,
      message: isSuccess ? 'Action completed successfully' : 'Action may not have completed as expected'
    });

    return { task_id, result, screenshot, screenshotPath: `/midscene_run/${runId}/${path.basename(screenshotPath)}` };
  } catch (error) {
    console.error(`[BrowserAction] Error:`, error);
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
      command,
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
  let browser, agent, page, release;

  fs.mkdirSync(runDir, { recursive: true });

  try {
    if (task_id && activeBrowsers.has(task_id)) {
      console.log(`[BrowserQuery] Reusing browser session ${task_id}`);
      ({ browser, agent, page, release } = activeBrowsers.get(task_id));
      try {
        await page.evaluate(() => true);
      } catch (err) {
        console.log(`[BrowserQuery] Browser session invalid, creating new one`);
        activeBrowsers.delete(task_id);
        task_id = null;
      }
    }

    if (!task_id || !activeBrowsers.has(task_id)) {
      if (!url) throw new Error("URL is required for new tasks");
      console.log(`[BrowserQuery] Creating new browser session for URL: ${url}`);
      const newTaskId = uuidv4();
      release = await browserSemaphore.acquire();
      let launchAttempts = 0;
      const maxLaunchAttempts = 3;

      while (launchAttempts < maxLaunchAttempts) {
        try {
          browser = await puppeteerExtra.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
            timeout: 30000
          });
          break;
        } catch (err) {
          launchAttempts++;
          console.error(`[BrowserQuery] Browser launch failed (attempt ${launchAttempts}):`, err);
          if (launchAttempts >= maxLaunchAttempts) {
            if (release) release();
            throw err;
          }
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 768, deviceScaleFactor: process.platform === "darwin" ? 2 : 1 });

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
        planningTimeout: 480000,
        maxPlanningRetries: 4
      });

      activeBrowsers.set(newTaskId, { browser, agent, page, release });
      task_id = newTaskId;
    }

    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 30,
      message: `Preparing to query: ${query}`
    });

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

    const beforeInfo = await handleTaskFinality(currentStep, page, agent, query, stepDescription, stepMap);
    console.log("[BrowserAction] Before state captured:", beforeInfo);

    await updateTaskInDatabase(taskId, {
      status: 'processing',
      progress: 50,
      lastAction: query
    });

    console.log(`[BrowserQuery] Executing query: ${query}`);
    await autoScroll(page); // Scroll before querying
    const queryResult = await agent.aiQuery(`Scroll into main view to remove adverts, then extract all crucial page data relevant to this command: ${query}`);
    console.log(`[BrowserQuery] Query result:`, queryResult);

    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 70,
      message: `Query executed, capturing screenshot`
    });

    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));

    const finalityStatus = await handleTaskFinality(currentStep, page, agent, query, stepDescription, stepMap);
    console.log("[BrowserQuery] Task finality status:", finalityStatus);
    const currentUrl = await page.url();
    const pageTitle = await page.title();
    const isSuccess = finalityStatus.status === "progressed";

    const result = {
      success: isSuccess,
      currentUrl,
      pageTitle,
      queryOutput: queryResult,
      timestamp: new Date().toISOString(),
      type: "query",
      query,
      extractedInfo: finalityStatus.extractedInfo,
      stepSummary: finalityStatus.stepSummary
    };

    await addIntermediateResult(userId, taskId, result);

    sendWebSocketUpdate(userId, {
      event: 'stepProgress',
      taskId,
      status: 'processing',
      progress: 100,
      message: 'Query completed successfully'
    });

    return { task_id, result, screenshot, screenshotPath: `/midscene_run/${runId}/${path.basename(screenshotPath)}` };
  } catch (error) {
    console.error(`[BrowserQuery] Error:`, error);
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
    if (stepMap[currentStep]) {
      stepMap[currentStep].status = "error";
      stepMap[currentStep].progress = "error";
      stepMap[currentStep].afterInfo = `Error: ${error.message}`;
    }
    const errorResult = {
      task_id,
      error: error.message,
      errorStack: error.stack,
      success: false,
      screenshot,
      screenshotPath,
      timestamp: new Date().toISOString(),
      query,
      stepSummary: stepMap ? generateStepSummary(stepMap) : "Error occurred, no step summary available"
    };
    await addIntermediateResult(userId, taskId, errorResult);
    sendWebSocketUpdate(userId, { event: 'stepError', taskId, error: error.message });
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

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

/**
 * Update task in database and notify clients
 * @param {string} userId - User ID
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
    await Task.updateOne({ _id: new mongoose.Types.ObjectId(taskId) }, { $set: updates });
    const task = await Task.findById(new mongoose.Types.ObjectId(taskId));
    if (task && task.userId) {
      sendWebSocketUpdate(task.userId.toString(), { event: 'taskUpdate', taskId, ...updates });
    } else {
      console.warn(`[Database] Task ${taskId} not found or missing userId`);
    }
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
    // Check if the task exists
    const task = await Task.findById(taskId);
    if (!task) {
      console.error(`[Database] Task ${taskId} not found`);
      return;
    }

    // Update the task with the intermediate result and increment progress
    await Task.updateOne(
      { _id: taskId },
      { 
        $push: { intermediateResults: result }, // Add the result to the array
        $inc: { progress: 10 }                  // Increment progress (adjust as needed)
      }
    );

    // Send a WebSocket update to the user
    sendWebSocketUpdate(userId, { event: 'intermediateResult', taskId, result });
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
    
    Extract only key main content that is relevant to the command/query. Ignore unclickable placeholder images, decoration elements, background images, 
    ads, and other unrelated content. Focus on clickable navigation elements, menu descriptions, prices, product details, main text content, or other 
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

    let finalScreenshotPath = null;
    if (finalScreenshot) {
      finalScreenshotPath = path.join(runDir, `final-screenshot-${Date.now()}.png`);
      fs.writeFileSync(finalScreenshotPath, Buffer.from(finalScreenshot, 'base64'));
      console.log(`[TaskCompletion] Saved final screenshot to ${finalScreenshotPath}`);
    }

    const landingReportPath = await generateReport(originalPrompt, intermediateResults, finalScreenshotPath ? `/midscene_run/${runId}/${path.basename(finalScreenshotPath)}` : null, runId);
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

    const lastResult = intermediateResults[intermediateResults.length - 1];
    const url = lastResult?.result?.currentUrl || 'N/A';

    const finalResult = {
      success: true,
      intermediateResults,
      finalScreenshotPath: finalScreenshotPath ? `/midscene_run/${runId}/${path.basename(finalScreenshotPath)}` : null,
      landingReportUrl: landingReportPath ? `/midscene_run/report/${path.basename(landingReportPath)}` : null,
      midsceneReportUrl,
      summary: lastResult || "Task execution completed",
      url: lastResult?.result?.currentUrl || url || 'N/A' 
    };

    return finalResult;
  } catch (error) {
    console.error(`[TaskCompletion] Error:`, error);
    const errorReportFile = `error-report-${Date.now()}.html`;
    const errorReportPath = path.join(REPORT_DIR, errorReportFile);
    fs.writeFileSync(errorReportPath, `...`); // Keep your existing error report content
    return {
      success: false,
      error: error.message,
      intermediateResults,
      reportUrl: `/midscene_run/report/${errorReportFile}`
    };
  } finally {
    if (activeBrowsers.size > 0) {
      for (const [id, { browser, release }] of activeBrowsers.entries()) {
        try {
          await browser.close();
          release();
          activeBrowsers.delete(id);
          console.log(`[TaskCompletion] Closed browser session ${id}`);
        } catch (error) {
          console.error(`[TaskCompletion] Error closing browser session ${id}:`, error);
        }
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

// Custom CSS styles to be injected into the <head>
const customCss = `
    /* General styling */
    body { background: linear-gradient(to bottom, #1a1a1a, #000); color: #e8e8e8; }
    .side-bar, .page-nav, .panel-title { background: #000 !important; color: #e8e8e8 !important; }
    .main-right .main-content-container, .detail-panel { background: #111 !important; color: #FFF !important; }
    .detail-side .item-list .item, .page-nav, .page-side, .main-right .main-content-container, .detail-side .meta-kv, .timeline-wrapper { border-color: #333 !important; }
    a, .side-item-name, .meta-key, .meta-value { color: #e8e8e8 !important; }
    .main-right .main-side, .detail-content { background-color: dodgerblue !important; color: #000 !important; }

    /* Logo replacement */
    img[src*="Midscene.png" i], img[alt*="midscene" i], img[class*="logo" i], img[src*="logo" i] {
        content: url("/assets/images/dail-fav.png") !important;
        width: 50px !important;
        height: 50px !important;
    }

    /* Version number update */
    .task-list-sub-name {
        visibility: hidden;
        position: relative;
    }
    .task-list-sub-name::after {
        content: "v1.0.1, OPERATOR model";
        visibility: visible;
        position: absolute;
        left: 0;
        color: #e8e8e8;
    }
`;

/**
 * Edit the Midscene SDK report with branding and updates using a streaming approach
 * @param {string} midsceneReportPath - Path to the Midscene SDK report
 * @returns {Promise<string>} - Path to the edited report
 */
async function editMidsceneReport(midsceneReportPath) {
  console.log(`[MidsceneReport] Editing report at ${midsceneReportPath}`);

  const readStream = fs.createReadStream(midsceneReportPath, 'utf8');
  const tempPath = `${midsceneReportPath}.tmp`;
  const writeStream = fs.createWriteStream(tempPath, 'utf8');

  // State variables for parsing
  let insideTitle = false;
  let insideScript = false;
  let scriptContent = '';
  let insideHead = false;
  let appendedCss = false;

  const parser = new Parser({
    // Handle opening tags
    onopentag: (name, attribs) => {
      if (name === 'title') {
          // Replace title
          writeStream.write('<title>VLM Run Report | O.P.E.R.A.T.O.R.</title>');
          insideTitle = true;
      } else if (name === 'link' && attribs.rel === 'icon') {
          // Replace favicon
          writeStream.write('<link rel="icon" href="/assets/images/dail-fav.png" type="image/png" sizes="32x32">');
      } else if (
          name === 'img' &&
          (attribs.src?.toLowerCase().includes('midscene.png') ||
           attribs.alt?.toLowerCase().includes('midscene') ||
           attribs.class?.toLowerCase().includes('logo') ||
           attribs.src?.toLowerCase().includes('logo'))
      ) {
          // Replace logo images
          writeStream.write('<img src="/assets/images/dail-fav.png" alt="OPERATOR_logo" class="logo" width="50" height="50">');
      } else if (name === 'script' && attribs.type === 'midscene_web_dump') {
          // Start collecting script content
          insideScript = true;
          scriptContent = '';
          writeStream.write('<script type="midscene_web_dump" type="application/json">');
      } else {
          // Write original tag
          const attribsStr = Object.entries(attribs)
              .map(([key, value]) => ` ${key}="${value}"`)
              .join('');
          writeStream.write(`<${name}${attribsStr}>`);
      }
      if (name === 'head') {
          insideHead = true;
      }
    },

    // Handle text content
    ontext: (text) => {
      if (insideScript) {
        scriptContent += text;
      } else if (!insideTitle) {
        writeStream.write(text);
      }
      // Skip original title text since we replaced it
    },

    // Handle closing tags
    onclosetag: (name) => {
      if (name === 'title') {
        insideTitle = false;
      } else if (name === 'script' && insideScript) {
        try {
          // Handle truncated JSON by attempting to complete it
          let jsonContent = scriptContent.trim();
          if (!jsonContent.endsWith('}')) {
            jsonContent += '"}]}'; // Attempt to close truncated JSON
          }
          const data = JSON.parse(jsonContent);
          if (data.executions) {
            data.executions.forEach((exec) => {
              if (exec.sdkVersion) exec.sdkVersion = '1.0.1';
            });
          }
          if (data.groupName) data.groupName = 'O.P.E.R.A.T.O.R - Sentinel Report';
          writeStream.write(JSON.stringify(data));
        } catch (error) {
          console.error('[MidsceneReport] Error parsing script content:', error);
          // Fallback to original content if JSON parsing fails
          writeStream.write(scriptContent);
        }
        writeStream.write('</script>');
        insideScript = false;
      } else if (name === 'head' && insideHead) {
        // Append custom CSS before closing head
        if (!appendedCss) {
          writeStream.write(`\n<style>${customCss}</style>\n`);
          appendedCss = true;
        }
        writeStream.write('</head>');
        insideHead = false;
      } else {
        writeStream.write(`</${name}>`);
      }
    },

    // Handle parsing errors
    onerror: (error) => {
      console.error('[MidsceneReport] Parser error:', error);
    }
  }, { decodeEntities: true });

  // Pipe the read stream into the parser
  readStream.on('data', (chunk) => {
    parser.write(chunk);
  });

  readStream.on('end', () => {
    parser.end();
    writeStream.end();
  });

  readStream.on('error', (err) => {
    console.error('[MidsceneReport] Read stream error:', err);
    writeStream.end();
  });

  // Return a promise that resolves when writing is complete
  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => {
      try {
        fs.renameSync(tempPath, midsceneReportPath);
        console.log(`[MidsceneReport] Updated report at ${midsceneReportPath}`);
        resolve(midsceneReportPath);
      } catch (renameErr) {
        console.error('[MidsceneReport] Error renaming file:', renameErr);
        reject(renameErr);
      }
    });

    writeStream.on('error', (err) => {
      console.error('[MidsceneReport] Write stream error:', err);
      reject(err);
    });
  });
}

/**
 * Main NLI endpoint handler with improved step processing
 */
app.post('/nli', requireAuth, async (req, res) => {
  const { prompt, url } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required.' });
/*
  streamEvent(taskId, { event: 'taskUpdate', status: 'starting' }); // Send immediately
  sendWebSocketUpdate(userEmail, { event: 'taskPlan', taskId, plan: planContent, steps, totalSteps: steps.length });
  sendWebSocketUpdate(task.userId.toString(), { event: 'taskUpdate', taskId, ...updates });
*/
  const userId = req.session.user; // ObjectId
  const user = await User.findById(userId).select('email').lean();
  if (!user) return res.status(400).json({ success: false, error: 'User not found' });
  const userEmail = user.email;

  const taskId = new mongoose.Types.ObjectId(); // Keep as ObjectId
  const runId = uuidv4();
  const runDir = path.join(MIDSCENE_RUN_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`[NLI] Starting new task: ${taskId} for user ${userEmail}`);
  console.log(`[NLI] Prompt: ${prompt}`);
  if (url) console.log(`[NLI] URL: ${url}`);

  try {
    // Create a new Task document
    const newTask = new Task({
      _id: taskId,
      userId: userId,
      command: prompt,
      status: 'pending',
      progress: 0,
      startTime: new Date(),
      isStreaming: true,
      url: url || null,
      runId: runId
    });
    await newTask.save();
    console.log(`[NLI] Task ${taskId} created in Task collection`);

    // Update User's activeTasks
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          activeTasks: {
            _id: taskId.toString(), // Convert to string for User document
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

  // Respond with taskId as string
  res.json({ success: true, taskId: taskId.toString(), runId });

  // Pass taskId as string to processTask
  processTask(userId, userEmail, taskId.toString(), runId, runDir, prompt, url);
});

/**
 * Process an NLI task by planning steps and executing them sequentially
 */
async function processTask(userId, userEmail, taskId, runId, runDir, prompt, url) {
  let activeBrowserId = null;
  let intermediateResults = [];
  let currentStepIndex = 0;
  let stepMap = {};

  try {
    const chatHistory = await ChatHistory.findOne({ userId });
    let recentMessages = chatHistory ? chatHistory.messages.slice(-5) : [];

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
7. EXTRACTING DATA: Always provide a high level instruction which includes scrolling to extract all data on the page. E.g., "Scroll down and list 5 trending tokens based on volume"

CAPABILITIES:
- You can call functions to interact with web browsers and desktop applications.
- You maintain context between function calls to track task progress.
- You make decisions based on function results to determine next steps.

FUNCTIONS AVAILABLE:
- browser_action: Execute actions on websites (clicking, typing, navigating, scrolling - no data extraction capabilities, never use for data extraction).
- browser_query: Extract information from websites (it can navigate autonomously to desired page, extract info)
- use these 2 functions interchangebly where relevant, extraction function to get info and action function for actions only
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
    - https://www.coinbase.com/explore instead of https://www.coinbase.com
   - Google search: https://google.com/search?q=your+query instead of https://www.google.com
   - Amazon search: https://amazon.com/s?k=your+query instead of https://amazon.com
   - YouTube search: https://youtube.com/results?search_query=your+query instead of https://youtube.com
   
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
   - When element selection fails, treat them as placeholders and try different selectors
   - When timeouts occur, retry with longer timeouts
- Scroll down to look for information required.
- If clicking a image or element does not work use the top main menu options or sidebar menus interchachably to discover your way around the site and to navigate to required page
- Overlays can affect navigation, check if the overlay is still there, if so, try to click a button to accept or close the overlay
- Retry using different navigation so you never fail, persistance is required always, be smart in browsing.

ALWAYS TRY MULTIPLE APPROACHES IF ONE FAILS. BE PERSISTENT.

Always reference the original request to ensure you're making progress toward the user's goal.
${url ? `The user has provided a starting URL: ${url}. Use this URL for browser_action or browser_query calls when starting a new task.` : ''}
      `
    };

    console.log(`[NLI] Planning steps for task: ${taskId}`);
    const planResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [systemMessage, ...recentMessages, { role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    });

    const planContent = planResponse.choices[0].message.content;
    const steps = (planContent.match(/\d+\.\s*(.*?)(?=\n\d+\.|\n*$)/gs) || []).map(step => step.trim().replace(/^\d+\.\s*/, ''));
    if (steps.length === 0) throw new Error("Could not parse steps from the plan");

    steps.forEach((step, index) => {
      stepMap[index] = { step: index, description: step, status: "pending", beforeInfo: null, afterInfo: null, progress: "pending" };
    });

    await Task.updateOne(
      { _id: new mongoose.Types.ObjectId(taskId) }, // Convert string to ObjectId
      { $set: { plan: planContent, steps, totalSteps: steps.length, currentStep: 0, status: 'processing', stepMap } }
    );

    sendWebSocketUpdate(userEmail, { event: 'taskPlan', taskId, plan: planContent, steps, totalSteps: steps.length });

    let messages = [systemMessage, ...recentMessages, { role: "user", content: prompt }, { role: "assistant", content: planContent }];
    const MAX_STEPS = 10;
    const actualSteps = Math.min(steps.length, MAX_STEPS);

    for (let i = 0; i < actualSteps; i++) {
      currentStepIndex = i;
      const stepDescription = steps[i];
      console.log(`[NLI] Processing step ${i + 1}/${actualSteps}: ${stepDescription}`);

      stepMap[i].status = "processing";
      await Task.updateOne(
        { _id: taskId },
        { $set: { currentStep: i, progress: Math.floor((i / actualSteps) * 100), currentStepDescription: stepDescription, stepMap } }
      );

      sendWebSocketUpdate(userEmail, { event: 'stepStart', taskId, stepIndex: i, stepDescription, progress: Math.floor((i / actualSteps) * 100) });

      const stepFunctionResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [...messages, { role: "user", content: `Now execute step ${i + 1}: ${stepDescription}. Based on the current state and this step, determine whether to use browser_action or browser_query and what parameters to use. If this is the first step and we need a URL, use the URL provided: ${url || "No URL was provided, you'll need to determine an appropriate starting URL."}. If we're continuing from a previous step, use the task_id from the previous step: ${activeBrowserId || "No previous browser session exists yet."}`}],
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
              required: ["command", "url", "task_id"]
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
              required: ["query", "url", "task_id"]
            }
          }
        ],
        function_call: "auto"
      });

      const functionMessage = stepFunctionResponse.choices[0].message;
      if (!functionMessage.function_call) {
        stepMap[i].status = "skipped";
        stepMap[i].progress = "skipped";
        stepMap[i].afterInfo = "No function call was made for this step";
        continue;
      }

      const functionName = functionMessage.function_call.name;
      let args = JSON.parse(functionMessage.function_call.arguments);
      if (!args.url && !args.task_id) {
        args.task_id = activeBrowserId || (url ? null : undefined);
        args.url = !args.task_id && url ? url : undefined;
      }

      console.log(`[NLI] Step ${i + 1} function: ${functionName} with args:`, args);
      await Task.updateOne(
        { _id: taskId },
        { $set: { currentStepFunction: functionName, currentStepArgs: args, stepMap } }
      );

      sendWebSocketUpdate(userEmail, { event: 'stepFunction', taskId, stepIndex: i, functionName, args });

      let functionResult;
      if (functionName === "browser_action") {
        functionResult = await handleBrowserAction(args, userId, taskId, runId, runDir, currentStepIndex, stepDescription, stepMap);
      } else if (functionName === "browser_query") {
        functionResult = await handleBrowserQuery(args, userId, taskId, runId, runDir, currentStepIndex, stepDescription, stepMap);
      } else {
        throw new Error(`Unknown function: ${functionName}`);
      }

      activeBrowserId = functionResult.task_id || activeBrowserId;
      intermediateResults.push(functionResult);

      await Task.updateOne({ _id: taskId }, { $set: { stepMap } });

      if (functionResult.screenshot) {
        sendWebSocketUpdate(userEmail, {
          event: 'stepScreenshot',
          taskId,
          stepIndex: i,
          screenshot: `data:image/png;base64,${functionResult.screenshot}`,
          screenshotPath: functionResult.screenshotPath
        });
      }

      sendWebSocketUpdate(userEmail, {
        event: 'stepComplete',
        taskId,
        stepIndex: i,
        result: cleanFunctionResult(functionResult),
        success: !functionResult.error,
        stepSummary: functionResult.result?.stepSummary || stepMap[i]?.afterInfo || "No step summary"
      });

      messages.push(
        { role: "assistant", content: null, function_call: { name: functionName, arguments: JSON.stringify(args) } },
        { role: "function", name: functionName, content: JSON.stringify(cleanFunctionResult(functionResult)) }
      );

      if (i < actualSteps - 1) {
        const stepSummary = stepMap[i]?.afterInfo || functionResult.result?.stepSummary || "No step summary";
        const adjustmentResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [...messages, { role: "user", content: `Based on the result of step ${i + 1} and summary: "${stepSummary}", adjust the plan if needed...` }],
          max_tokens: 500,
          temperature: 0.2
        });

        const adjustmentContent = adjustmentResponse.choices[0].message.content;
        if (!adjustmentContent.includes("Continue with the current plan")) {
          console.log(`[NLI] Adjusting plan after step ${i + 1}: ${adjustmentContent}`);
          const adjustedSteps = (adjustmentContent.match(/\d+\.\s*(.*?)(?=\n\d+\.|\n*$)/gs) || []).map(step => step.trim().replace(/^\d+\.\s*/, ''));
          if (adjustedSteps.length > 0) {
            steps.splice(i + 1, steps.length - (i + 1), ...adjustedSteps);
            for (let j = i + 1; j < steps.length && j < MAX_STEPS; j++) {
              stepMap[j] = { step: j, description: steps[j], status: "pending", beforeInfo: null, afterInfo: null, progress: "pending" };
            }
            await Task.updateOne(
              { _id: taskId },
              { $set: { steps, totalSteps: steps.length, planAdjustment: adjustmentContent, stepMap } }
            );
            sendWebSocketUpdate(userEmail, { event: 'planAdjusted', taskId, newSteps: steps, totalSteps: steps.length, adjustment: adjustmentContent, stepMap });
          }
        }
        messages.push({ role: "assistant", content: adjustmentContent });
      }
    }

    const finalStepSummary = generateStepSummary(stepMap);
    console.log(`[NLI] Task complete, generating summary`);
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [...messages, { role: "user", content: `Provide a final summary... ${finalStepSummary}` }],
      stream: true,
      max_tokens: 1000,
      temperature: 0.2
    });

    let finalMessage = '';
    let isStreaming = true;
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      finalMessage += content;
      sendWebSocketUpdate(userEmail, { event: 'finalSummaryChunk', taskId, chunk: content, streaming: isStreaming });
    }
    isStreaming = false;
    sendWebSocketUpdate(userEmail, { event: 'finalSummaryComplete', taskId, summary: finalMessage, streaming: isStreaming });

    const finalResult = await processTaskCompletion(userId, taskId, intermediateResults, prompt, runDir, runId);
    finalResult.aiPrepared = { summary: finalMessage, stepSummary: finalStepSummary };

    sendWebSocketUpdate(userEmail, { event: 'taskComplete', taskId, status: 'completed', result: finalResult, stepMap });

    await Task.updateOne(
      { _id: taskId },
      { $set: { status: 'completed', progress: 100, result: finalResult, endTime: new Date(), isStreaming: false, stepMap } }
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
    if (stepMap[currentStepIndex]) {
      stepMap[currentStepIndex].status = "error";
      stepMap[currentStepIndex].progress = "error";
      stepMap[currentStepIndex].afterInfo = `Critical error: ${error.message}`;
    }
    sendWebSocketUpdate(userEmail, { event: 'taskError', taskId, status: 'error', error: error.message, stepMap });
    await Task.updateOne(
      { _id: taskId },
      { $set: { status: 'error', progress: 0, error: error.message, endTime: new Date(), isStreaming: false, stepMap } }
    );
  } finally {
    if (activeBrowserId && activeBrowsers.has(activeBrowserId)) {
      console.log(`[NLI] Closing browser for task_id: ${activeBrowserId}`);
      try {
        const { browser, release } = activeBrowsers.get(activeBrowserId);
        await browser.close();
        release();
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

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});