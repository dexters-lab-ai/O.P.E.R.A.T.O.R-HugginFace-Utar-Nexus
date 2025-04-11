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

    const updateInterval = setInterval(sendUpdate, 1000);

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

async function handleDesktopAction(prompt, targetUrl, runDir, runId) {
  try {
    const browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1080,768"],
      timeout: 120000
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: process.platform === "darwin" ? 2 : 1 });
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
 * Analyzes the current page state and compares it to previous state to determine step progress
 * @param {number} currentStep - The current step number
 * @param {Page} page - Puppeteer page object
 * @param {PuppeteerAgent} agent - Browser agent for AI operations
 * @param {string} commandOrQuery - The command or query that was executed
 * @param {string} stepDescription - Description of the current step
 * @param {Object} stepMap - Map of all steps with their status and results
 * @returns {Object} - The finality status object
 */
async function handleTaskFinality(currentStep, functionName, args, functionResult) {
  const { success, error, currentUrl, pageTitle, actionOutput, queryOutput } = functionResult.result || {};

  const stepStatus = success ? "progressed" : "unprogressed";
  const extractedInfo = actionOutput || queryOutput || "No additional info";
  const summary = `Step ${currentStep}: ${functionName} with args ${JSON.stringify(args)} - Status: ${stepStatus}. ${extractedInfo}`;

  // Simple heuristic: task might be done after 5 steps or if explicitly completed
  const taskComplete = currentStep >= 5 || (stepStatus === "progressed" && extractedInfo.includes("task complete"));

  return {
    status: taskComplete ? "completed" : "in_progress",
    summary,
    extractedInfo
  };
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
      summary += `   Result: ${step.afterInfo ? step.afterInfo.substring(0, 1000) : "No result data"}\n`;
      if (step.afterInfo && step.afterInfo.length > 1000) {
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
      for (const [id, session] of activeBrowsers.entries()) {
          if (!session.closed) {
              try {
                  await session.browser.close();
                  if (typeof session.release === 'function') {
                      session.release();
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

// Sessions map - shared across the application
const activeBrowsers = new Map();

/**
 * TaskPlan - Class to manage the execution plan for a browser task
 */
class TaskPlan {
  constructor(userId, taskId, prompt, initialUrl, runDir, maxSteps = 20) {
    this.userId = userId;
    this.taskId = taskId;
    this.prompt = prompt; // Original task description
    this.initialUrl = initialUrl;
    this.currentUrl = initialUrl;
    this.runDir = runDir;
    this.steps = [];
    this.currentStepIndex = -1;
    this.maxSteps = maxSteps;
    this.currentState = null; // Holds latest page state
    this.planLog = [];
    this.completed = false;
    this.summary = null;
  }

  log(message, metadata = {}) {
    const entry = { timestamp: new Date().toISOString(), message, ...metadata };
    this.planLog.push(entry);
    console.log(`[Task ${this.taskId}] ${message}`, metadata);
  }

  /**
   * Create a new step in the plan
   * @param {string} type - Step type (action or query)
   * @param {string} instruction - Step instruction
   * @param {Object} args - Step arguments
   * @returns {PlanStep} - The created step
   */
  createStep(type, instruction, args) {
    const step = {
      index: this.steps.length,
      type, // 'action' or 'query'
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
            result = await plan.executeBrowserAction(step.args);
          } else {
            result = await plan.executeBrowserQuery(step.args);
          }
          step.result = result;
          step.status = result.success ? 'completed' : 'failed';
          plan.currentUrl = result.currentUrl || plan.currentUrl;
          plan.currentState = result.state || plan.currentState;
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
        success: step.result?.success || false
      })
    };
    this.steps.push(step);
    this.currentStepIndex = this.steps.length - 1;
    return step;
  }

  /**
   * Get the current step
   * @returns {PlanStep} - Current step or null if no steps exist
   */
  getCurrentStep() {
    if (this.currentStepIndex >= 0 && this.currentStepIndex < this.steps.length) {
      return this.steps[this.currentStepIndex];
    }
    return null;
  }

  /**
   * Update the browser session with new data
   * @param {Object} session - Browser session data
   */
  updateBrowserSession(session) {
    this.browserSession = session;
    if (session && session.currentUrl) {
      this.currentUrl = session.currentUrl;
    }
    this.log(`Updated browser session, current URL: ${this.currentUrl}`);
  }

  /**
   * Mark the plan as completed
   * @param {string} summary - Completion summary
   */
  markCompleted(summary) {
    this.completed = true;
    this.summary = summary;
    this.log(`Task marked as completed: ${summary}`);
  }

  /**
   * Generate a system prompt for the AI based on current plan state
   * @returns {string} - System prompt
   */
  generateSystemPrompt() {
    // Concise progress summary
    const progressSummary = this.steps.length > 0
      ? this.steps.map(step => 
          `- Step ${step.index + 1}: ${step.type.toUpperCase()} - ${step.instruction} (${step.status})`
        ).join('\n')
      : 'No steps executed yet';

    // Highlight recent failures (last 3 steps) for context
    const recentFailures = this.steps.slice(-3)
      .filter(step => step.status === 'failed')
      .map(step => 
        `- Step ${step.index + 1}: ${step.instruction} failed (${step.error || 'Unknown error'})`
      ).join('\n') || 'No recent failures';

    // Current page state summary
    const stateSummary = this.currentState
      ? `**Current Page State**:\n` +
        `- Description: ${typeof this.currentState.pageDescription === 'string' 
          ? this.currentState.pageDescription.substring(0, 200) + '...' 
          : 'Structured data'}\n` +
        (this.currentState.navigableElements 
          ? `- Navigable: ${this.currentState.navigableElements.slice(0, 5).join(', ')}...` 
          : '')
      : '**Current Page State**: Not available';

    return `
You are an AI assistant automating browser tasks with resilience and adaptability. You always instruct towards achieving the main original task.
**Original Task**: "${this.prompt}"
**Starting URL**: ${this.initialUrl || 'Not specified'}
**Current Step**: ${this.currentStepIndex + 1} of ${this.maxSteps} max
**Current URL**: ${this.currentUrl || 'Not yet navigated'}
**Progress Summary**:
${progressSummary}
**Recent Failures**:
${recentFailures}
${stateSummary}
**Instructions**:
- Use 'browser_action' for navigation, clicks, or input (e.g., {"command": "navigate to https://example.com"}). This is a VLM able to accept high level command like "look for Bitcoin and click it. Click 3M chart view and candlestick view".
- Use 'browser_query' to analyze the page or extract info (e.g., {"query": "What is on the page?"}). This is a high level VLM able to accept instructions like "scroll and find a product under $1000. Click to open when found. Extract all information on product page".
- If the starting URL is 'Not specified', you must include the 'url' parameter in your first 'browser_action' or 'browser_query' call with the initial URL to navigate to.
- Use 'task_complete' with a summary to finish (e.g., {"summary": "Task done"}).
- After a failure, use 'browser_query' to assess the state before retrying.
- If stuck, propose a new approach based on the current state.
**Rules**:
- Always return a function call in JSON format.
- Keep actions specific and goal-oriented toward "${this.prompt}".
- Avoid repeating failed actions without new information.
    `.trim();
  }

  /**
   * Get execution summary
   * @returns {Object} - Execution summary
   */
  getSummary() {
    return {
      taskId: this.taskId,
      prompt: this.prompt,
      initialUrl: this.initialUrl,
      currentUrl: this.currentUrl,
      steps: this.steps.map(step => step.getSummary()), // Detailed summary for each step
      completed: this.completed,
      summary: this.summary, // Final summary when task is completed
      planLog: this.planLog, // Full log of events for the task plan
      currentStepIndex: this.currentStepIndex,
      maxSteps: this.maxSteps
    };
  }

  // Add these methods to your TaskPlan class:

/**
 * Execute a browser action
 * @param {Object} args - Action arguments
 * @param {number} stepIndex - Current step index
 * @returns {Object} - Result of the action
 */
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

/**
 * Execute a browser query
 * @param {Object} args - Query arguments
 * @param {number} stepIndex - Current step index
 * @returns {Object} - Result of the query
 */
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
}

/**
 * PlanStep - Class to manage an individual step in the execution plan
 */
class PlanStep {
  constructor(index, type, instruction, args, userId, taskId, runDir) {
    this.index = index;
    this.type = type; // 'action' or 'query'
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
  }

  /**
   * Log an event in the step execution
   * @param {string} message - Message to log
   * @param {Object} data - Optional data to include
   */
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

  /**
 * Execute the step
 * @param {Object} plan - The task plan
 * @returns {Object} - Result of the step execution
 */
async execute(plan) {
  this.log(`Starting execution: ${this.type} - ${this.instruction}`);
  this.status = 'running';
  
  try {
    sendWebSocketUpdate(this.userId, { 
      event: 'stepProgress', 
      taskId: this.taskId, 
      stepIndex: this.index, 
      progress: 10, 
      message: `Starting: ${this.instruction}`,
      log: this.logs
    });

    let result;
    // Execute the appropriate handler based on step type
    console.log(`[PlanStep] Executing with index: ${this.index}`);
    if (this.type === 'action') {
      result = await plan.executeBrowserAction(this.args, this.index);
    } else if (this.type === 'query') {
      result = await plan.executeBrowserQuery(this.args, this.index);
    } else {
      throw new Error(`Unknown step type: ${this.type}`);
    }

    this.result = result;
    this.status = result.success ? 'completed' : 'failed';
    this.endTime = new Date();
    
    // Update the plan with the browser session from this step
    plan.updateBrowserSession(result);
    
    // Update the plan's current state with context info
    if (result.extractedInfo) {
      plan.currentState = {
        pageDescription: result.extractedInfo,
        navigableElements: result.navigableElements || [],
        currentUrl: result.currentUrl
      };
    }

    // Make sure we include the step index in our WebSocket update
    sendWebSocketUpdate(this.userId, { 
      event: 'stepProgress', 
      taskId: this.taskId, 
      stepIndex: this.index, 
      progress: 100, 
      message: this.status === 'completed' ? 'Step completed' : 'Step failed',
      log: this.logs.concat(result.actionLog || [])
    });

    // Include step index in log
    console.log(`[Task ${this.taskId}] Step ${this.index} completed`, {
      status: this.status,
      type: this.type,
      url: result.currentUrl
    });

    return result;
  } catch (error) {
    this.log(`Error executing step: ${error.message}`);
    this.status = 'failed';
    this.endTime = new Date();
    this.error = error.message;
    
    // Make sure we include the step index in our WebSocket update
    sendWebSocketUpdate(this.userId, { 
      event: 'stepProgress', 
      taskId: this.taskId, 
      stepIndex: this.index, 
      progress: 100, 
      message: `Error: ${error.message}`,
      log: this.logs
    });
    
    // Include step index in error log
    console.log(`[Task ${this.taskId}] Step ${this.index} failed`, {
      error: error.message
    });
    
    return {
      success: false,
      error: error.message,
      actionLog: this.logs,
      stepIndex: this.index // Ensure step index is returned in error case
    };
  }
}

  /**
   * Get step summary
   * @returns {Object} - Step summary
   */
  getSummary() {
    return {
      index: this.index,
      type: this.type,
      instruction: this.instruction,
      args: this.args,
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.endTime ? (this.endTime - this.startTime) : null, // Duration in milliseconds
      resultSummary: this.result ? {
        success: this.result.success,
        url: this.result.currentUrl,
        error: this.result.error,
        extractedInfo: this.result.extractedInfo, // Full extracted info
        navigableElements: this.result.navigableElements
      } : null,
      logs: this.logs, // Full logs for this step
      error: this.error // Error message if the step failed
    };
  }
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
  const { command, url: providedUrl, task_id } = args; // Rename url to providedUrl for clarity
  let browser, agent, page, release;
  const actionLog = [];

  // Updated logAction to always use currentStep
  const logAction = (message, data = null) => {
    const logEntry = { 
      timestamp: new Date().toISOString(), 
      step: currentStep, 
      message, 
      data: data ? JSON.stringify(data) : null 
    };
    actionLog.push(logEntry);
    console.log(`[BrowserAction] [Step ${currentStep}] ${message}`, data ? JSON.stringify(data) : '');
  };

  try {
    logAction(`Starting action with command: "${command}", URL: "${providedUrl || 'none provided'}"`);

    // Extract URL from command if not provided
    let effectiveUrl = providedUrl;
    if (!effectiveUrl && command.startsWith('navigate to ')) {
      const urlMatch = command.match(/navigate to (\S+)/);
      if (urlMatch) {
        effectiveUrl = urlMatch[1];
        logAction(`Extracted URL from command: ${effectiveUrl}`);
      }
    }

    // Single URL validation for new tasks
    if (!existingSession && !effectiveUrl) {
      throw new Error("URL required for new tasks");
    }

    // Browser session management
    if (existingSession) {
      logAction("Using existing browser session");
      ({ browser, agent, page, release } = existingSession);
      if (!page || page.isClosed()) {
        logAction("Page is invalid or closed, creating a new one");
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
        agent = new PuppeteerAgent(page, { 
          provider: 'huggingface', 
          apiKey: process.env.HF_API_KEY, 
          model: 'bytedance/ui-tars-72b'
        });
        activeBrowsers.set(task_id, { browser, agent, page, release, closed: false });
      }
    } else if (task_id && activeBrowsers.has(task_id)) {
      logAction("Retrieving existing browser session from active browsers");
      ({ browser, agent, page, release } = activeBrowsers.get(task_id));
      if (!page || page.isClosed()) {
        logAction("Page is invalid or closed, creating a new one");
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
        agent = new PuppeteerAgent(page, { 
          provider: 'huggingface', 
          apiKey: process.env.HF_API_KEY, 
          model: 'bytedance/ui-tars-72b'
        });
        activeBrowsers.set(task_id, { browser, agent, page, release, closed: false });
      }
    } else {
      // Create new session with clear logging
      logAction(`Creating new browser session and navigating to URL: ${effectiveUrl}`);
      
      release = await browserSemaphore.acquire();
      logAction("Acquired browser semaphore");
      
      browser = await puppeteerExtra.launch({ 
        headless: false, 
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
        defaultViewport: { width: 1280, height: 720 }
      });
      logAction("Browser launched successfully");
      
      page = await browser.newPage();
      logAction("New page created");
      
      await page.setDefaultNavigationTimeout(60000); // 60 seconds
      page.on('console', msg => logAction(`Console: ${msg.text().substring(0, 150)}`));
      page.on('pageerror', err => logAction(`Page error: ${err.message}`));
      page.on('request', req => {
        if (['document', 'script', 'xhr', 'fetch'].includes(req.resourceType())) {
          logAction(`Request: ${req.method()} ${req.url().substring(0, 100)}`);
        }
      });
      page.on('response', res => {
        if (['document', 'script', 'xhr', 'fetch'].includes(res.request().resourceType())) {
          logAction(`Response: ${res.status()} ${res.url().substring(0, 100)}`);
        }
      });
      
      logAction(`Navigating to URL: ${effectiveUrl}`);
      await page.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      logAction("Navigation completed successfully");
      
      agent = new PuppeteerAgent(page, { 
        provider: 'huggingface', 
        apiKey: process.env.HF_API_KEY, 
        model: 'bytedance/ui-tars-72b'
      });
      logAction("PuppeteerAgent initialized");
      
      activeBrowsers.set(task_id, { browser, agent, page, release, closed: false });
      logAction("Browser session stored in active browsers");
    }

    // Progress update
    sendWebSocketUpdate(userId, { 
      event: 'stepProgress', 
      taskId, 
      stepIndex: currentStep, 
      progress: 30, 
      message: `Executing: ${command}`,
      log: actionLog
    });

    // Set viewport
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    logAction("Set viewport to 1280x720");
    
    // Handle page obstacles
    logAction("Checking for page obstacles");
    const obstacleResults = await handlePageObstacles(page, agent);
    logAction("Obstacle check results", obstacleResults);
    
    // Execute action
    logAction(`Executing action: "${command}"`);
    await agent.aiAction(command);
    logAction("Action executed successfully");

    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check for popups
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
          agent = new PuppeteerAgent(page, { 
            provider: 'huggingface', 
            apiKey: process.env.HF_API_KEY, 
            model: 'bytedance/ui-tars-72b'
          });
          logAction("Switched to new page and reinitialized agent");
        }
      }
    }
    
    // Extract rich context
    logAction("Extracting rich page context");
    const { pageContent: extractedInfo, navigableElements } = await extractRichPageContext(
      agent, 
      page, 
      command,
      "What information is now visible on the page? What can be clicked or interacted with?"
    );
    logAction("Rich context extraction complete", { 
      contentLength: typeof extractedInfo === 'string' ? extractedInfo.length : 'object',
      navigableElements: navigableElements.length
    });
    
    // Capture screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
    logAction("Screenshot captured and saved", { path: screenshotPath });

    const currentUrl = await page.url();
    logAction(`Current URL: ${currentUrl}`);
    
    // Prepare result
    const result = {
      success: true,
      currentUrl,
      pageTitle: await page.title(),
      actionOutput: `Completed: ${command}`,
      extractedInfo,
      navigableElements,
      actionLog,
      stepIndex: currentStep // Add this to ensure step index is returned
    };

    // Final progress update
    sendWebSocketUpdate(userId, { 
      event: 'stepProgress', 
      taskId, 
      stepIndex: currentStep, 
      progress: 100, 
      message: 'Action completed',
      log: actionLog
    });
    
    return { 
      task_id, 
      browser, 
      agent, 
      page, 
      release, 
      closed: false,
      currentUrl,
      ...result, 
      screenshot, 
      screenshotPath 
    };
  } catch (error) {
    logAction(`Error in browser action: ${error.message}`, { stack: error.stack });
    if (typeof release === 'function') release();
    return { 
      task_id, 
      error: error.message, 
      success: false,
      actionLog,
      browser, 
      agent, 
      page, 
      release, 
      currentUrl: page ? await page.url().catch(() => null) : null,
      stepIndex: currentStep // Add this to ensure step index is returned
    };
  }
}

/**
 * Enhanced browser query handler with improved logging and obstacle management
 * @param {Object} args - Query arguments
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID
 * @param {string} runDir - Run directory
 * @param {number} currentStep - Current step number
 * @param {Object} existingSession - Existing browser session
 * @returns {Object} - Result of the query
 */
async function handleBrowserQuery(args, userId, taskId, runId, runDir, currentStep = 0, existingSession) {
  console.log(`[BrowserQuery] Received currentStep: ${currentStep}`); // Debug log
  const { query, url: providedUrl, task_id } = args;
  let browser, agent, page, release;
  const actionLog = [];

  // Log function for capturing detailed process information
  const logQuery = (message, data = null) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      step: currentStep,
      message,
      data: data ? (typeof data === 'object' ? JSON.stringify(data) : data) : null
    };
    actionLog.push(logEntry);
    console.log(`[BrowserQuery] [Step ${currentStep}] ${message}`);
  };

  try {
    logQuery(`Starting query: "${query}"`);

    // Determine if we need to create a new session or use an existing one
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
        activeBrowsers.set(task_id, { browser, agent, page, release, closed: false });
      }
    } else if (task_id && activeBrowsers.has(task_id)) {
      logQuery("Retrieving existing browser session from active browsers");
      ({ browser, agent, page, release } = activeBrowsers.get(task_id));
      if (!page || page.isClosed()) {
        logQuery("Page is invalid or closed, creating a new one");
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
        agent = new PuppeteerAgent(page, { 
          provider: 'huggingface', 
          apiKey: process.env.HF_API_KEY, 
          model: 'bytedance/ui-tars-72b'
        });
        activeBrowsers.set(task_id, { browser, agent, page, release, closed: false });
      }
    } else {
      // Create new session only if a URL is provided
      if (!providedUrl) throw new Error("URL required for new tasks");
      logQuery(`Creating new browser session for URL: ${providedUrl}`);
      
      release = await browserSemaphore.acquire();
      logQuery("Acquired browser semaphore");
      
      browser = await puppeteerExtra.launch({ 
        headless: false, 
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
        defaultViewport: { width: 1280, height: 720 }
      });
      logQuery("Browser launched successfully");
      
      page = await browser.newPage();
      logQuery("New page created");
      
      await page.setDefaultNavigationTimeout(60000); // 60 seconds
      page.on('console', msg => logQuery(`Console: ${msg.text().substring(0, 150)}`));
      page.on('pageerror', err => logQuery(`Page error: ${err.message}`));
      page.on('request', req => {
        if (['document', 'script', 'xhr', 'fetch'].includes(req.resourceType())) {
          logQuery(`Request: ${req.method()} ${req.url().substring(0, 100)}`);
        }
      });
      page.on('response', res => {
        if (['document', 'script', 'xhr', 'fetch'].includes(res.request().resourceType())) {
          logQuery(`Response: ${res.status()} ${res.url().substring(0, 100)}`);
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
      
      activeBrowsers.set(task_id, { browser, agent, page, release, closed: false });
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

    // Set viewport
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    logQuery("Set viewport to 1280x720");
    
    // Check for and handle page obstacles
    logQuery("Checking for page obstacles");
    const obstacleResults = await handlePageObstacles(page, agent);
    logQuery("Obstacle check results", obstacleResults);
    
    // Execute query
    logQuery(`Executing query: "${query}"`);
    const { pageContent: extractedInfo, navigableElements } = await extractRichPageContext(
      agent, 
      page, 
      "scroll and observe",
      query
    );
    logQuery("Query executed successfully");
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check for state changes
    const stateCheck = await page.evaluate(() => {
      return {
        url: window.location.href,
        popupOpened: window.opener !== null,
        numFrames: window.frames.length,
        alerts: document.querySelectorAll('[role="alert"]').length
      };
    });
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
    
    // Capture screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });
    const screenshotPath = path.join(runDir, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
    logQuery("Screenshot captured and saved", { path: screenshotPath });

    const currentUrl = await page.url();
    logQuery(`Current URL: ${currentUrl}`);
    
    const result = {
      success: true,
      currentUrl,
      pageTitle: await page.title(),
      queryOutput: `Completed: ${query}`,
      extractedInfo,
      navigableElements,
      actionLog,
      stepIndex: currentStep // Add this to ensure step index is returned
    };

    sendWebSocketUpdate(userId, { 
      event: 'stepProgress', 
      taskId, 
      stepIndex: currentStep, 
      progress: 100, 
      message: 'Query completed',
      log: actionLog
    });
    
    return { 
      task_id, 
      browser, 
      agent, 
      page, 
      release, 
      closed: false,
      currentUrl,
      ...result, 
      screenshot, 
      screenshotPath 
    };
  } catch (error) {
    logQuery(`Error in browser query: ${error.message}`, { stack: error.stack });
    if (typeof release === 'function') release();
    return { 
      task_id, 
      error: error.message, 
      success: false,
      actionLog,
      browser, 
      agent, 
      page, 
      release, 
      currentUrl: page ? await page.url().catch(() => null) : null,
      stepIndex: currentStep // Add this to ensure step index is returned
    };
  }
}

/**
 * Main NLI endpoint handler with improved step processing
 */
app.post('/nli', requireAuth, async (req, res) => {
  const { prompt, url } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Prompt is required.' });

  const userId = req.session.user;
  const user = await User.findById(userId).select('email').lean();
  if (!user) return res.status(400).json({ success: false, error: 'User not found' });
  const userEmail = user.email;

  const taskId = new mongoose.Types.ObjectId();
  const runId = uuidv4();
  const runDir = path.join(MIDSCENE_RUN_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`[NLI] Starting task ${taskId} for ${userEmail}`);

  try {
    const newTask = new Task({
      _id: taskId,
      userId,
      command: prompt,
      status: 'pending',
      progress: 0,
      startTime: new Date(),
      url: url || null,
      runId
    });
    await newTask.save();

    await User.updateOne(
      { _id: userId },
      { $push: { activeTasks: { _id: taskId.toString(), command: prompt, status: 'pending', startTime: new Date(), url } } }
    );
  } catch (dbError) {
    console.error(`[NLI] Database error:`, dbError);
    return res.status(500).json({ success: false, error: 'Database error' });
  }

  res.json({ success: true, taskId: taskId.toString(), runId });
  processTask(userId, userEmail, taskId.toString(), runId, runDir, prompt, url); // Triggers streaming
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
  console.log(`[ProcessTask] Starting task ${taskId} with prompt: "${prompt}"`);
  
  // Create a new task plan
  const plan = new TaskPlan(userId, taskId, prompt, url, runDir);
  
  try {
    // Initialize the task in the database
    await Task.updateOne(
      { _id: taskId },
      { 
        $set: { 
          status: 'running', 
          progress: 5,
          planId: plan.planId
        }
      }
    );
    
    // Send initial update to client
    sendWebSocketUpdate(userId, {
      event: 'taskStart',
      taskId,
      prompt,
      url
    });
    
    let taskCompleted = false;
    let consecutiveFailures = 0; // Added to track consecutive failures for dynamic adjustments
    
    while (!taskCompleted && plan.currentStepIndex < plan.maxSteps - 1) {
      // Generate system prompt based on current plan state
      const systemPrompt = plan.generateSystemPrompt();
      
      // Prepare messages for AI
      let messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ];
      
      // Add previous step results if they exist (summarized for better memory management)
      if (plan.steps.length > 0) {
        plan.steps.slice(-3).forEach(step => {
          if (step.result) {
            messages.push({
              role: "assistant",
              content: null,
              function_call: {
                name: step.type === 'action' ? 'browser_action' : 'browser_query',
                arguments: JSON.stringify({
                  [step.type === 'action' ? 'command' : 'query']: step.instruction,
                  task_id: taskId,
                  url: plan.currentUrl
                })
              }
            });
            
            // Summarized result to reduce memory usage
            messages.push({
              role: "function",
              name: step.type === 'action' ? 'browser_action' : 'browser_query',
              content: JSON.stringify({
                success: step.result.success,
                currentUrl: step.result.currentUrl,
                extractedInfo: typeof step.result.extractedInfo === 'string' 
                  ? step.result.extractedInfo.substring(0, 100) + '...' 
                  : 'Structured data',
                navigableElements: step.result.navigableElements?.slice(0, 5)
              })
            });
          }
        });
      }
      // Add current state if available
      if (plan.currentState && plan.currentState.pageDescription) {
        let descriptionText;
        if (typeof plan.currentState.pageDescription === 'string') {
          descriptionText = plan.currentState.pageDescription.substring(0, 300) + '...';
        } else {
          descriptionText = JSON.stringify(plan.currentState.pageDescription).substring(0, 300) + '...';
        }
        messages.push({
          role: "system",
          content: `Current page state: ${descriptionText}`
        });
      }
      
      // Start streaming to get the next function call from the AI
      plan.log("Requesting next action from AI");
      
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        stream: true,
        temperature: 0.3,
        max_tokens: 500,
        functions: [
          {
            name: "browser_action",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
                url: { type: "string" },
                task_id: { type: "string" }
              },
              required: ["command"]
            }
          },
          {
            name: "browser_query",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
                url: { type: "string" },
                task_id: { type: "string" }
              },
              required: ["query"]
            }
          },
          {
            name: "task_complete",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string" }
              },
              required: []
            }
          }
        ],
        function_call: "auto"
      });
      
      // Improved stream handling
      let currentFunctionCall = null;
      let accumulatedArgs = '';
      let functionCallReceived = false;
      
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        // Handle function call start
        if (delta?.function_call?.name) {
          plan.log(`New function call started: ${delta.function_call.name}`);
          currentFunctionCall = { name: delta.function_call.name };
          accumulatedArgs = '';
        }
        
        // Accumulate function arguments
        if (delta?.function_call?.arguments) {
          accumulatedArgs += delta.function_call.arguments;
          
          try {
            const parsedArgs = JSON.parse(accumulatedArgs);
            plan.log(`Complete function call:`, {
              name: currentFunctionCall.name,
              args: parsedArgs
            });
            
            const { name: functionName } = currentFunctionCall;
            parsedArgs.task_id = taskId;
            parsedArgs.url = parsedArgs.url || url || plan.currentUrl;
            
            // Process function call based on type
            if (functionName === "browser_action") {
              // Create a new action step in the plan
              const step = plan.createStep('action', parsedArgs.command, parsedArgs);
              const result = await step.execute(plan);
              
              // Store intermediate results in the database
              await addIntermediateResult(userId, taskId, result);
              
              // Dynamic plan adjustment: handle consecutive failures
              if (result.success) {
                consecutiveFailures = 0;
              } else {
                consecutiveFailures++;
                if (consecutiveFailures >= 3) {
                  plan.log("Triggering recovery due to consecutive failures");
                  const recoveryStep = plan.createStep('query', 'Suggest a new approach to achieve the original task', {
                    query: 'Suggest a new approach to achieve the original task',
                    task_id: taskId,
                    url: plan.currentUrl
                  });
                  await recoveryStep.execute(plan);
                  consecutiveFailures = 0;
                }
              }
              
              functionCallReceived = true;
              break;
            } 
            else if (functionName === "browser_query") {
              // Create a new query step in the plan
              const step = plan.createStep('query', parsedArgs.query, parsedArgs);
              const result = await step.execute(plan);
              
              // Store intermediate results in the database
              await addIntermediateResult(userId, taskId, result);
              
              // Reset consecutive failures for queries (since they gather info)
              consecutiveFailures = 0;
              
              functionCallReceived = true;
              break;
            } 
            else if (functionName === "task_complete") {
              // Mark the plan as completed
              const summary = parsedArgs.summary || `Task completed: ${prompt}`;
              plan.markCompleted(summary);
              
              // Final result with summary and screenshots
              const finalResult = {
                success: true,
                taskId,
                summary,
                currentUrl: plan.currentUrl,
                screenshot: plan.browserSession?.screenshot,
                steps: plan.steps.map(step => step.getSummary())
              };
              
              // Update task as completed
              await Task.updateOne(
                { _id: taskId },
                { 
                  $set: { 
                    status: 'completed', 
                    progress: 100, 
                    result: finalResult, 
                    endTime: new Date() 
                  } 
                }
              );
              
              // Send completion update to client
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
            // Continue accumulating arguments if JSON is incomplete
          }
        }
      }
      
      if (taskCompleted) {
        plan.log(`Task completed after ${plan.currentStepIndex + 1} steps`);
        break;
      }
      
      if (!functionCallReceived) {
        plan.log(`No function call received for step ${plan.currentStepIndex + 1}`);
        // Create a recovery step to gather page state
        const recoveryStep = plan.createStep('query', 'Describe the current page state and available actions', {
          query: 'Describe the current page state and available actions',
          task_id: taskId,
          url: plan.currentUrl
        });
        await recoveryStep.execute(plan);
        consecutiveFailures = 0; // Reset after recovery step
      }
      
      // Update task progress in the database
      const progress = Math.min(95, Math.floor((plan.currentStepIndex + 1) / plan.maxSteps * 100));
      await Task.updateOne(
        { _id: taskId },
        { 
          $set: { 
            status: 'running', 
            progress,
            currentStepIndex: plan.currentStepIndex,
            currentUrl: plan.currentUrl
          } 
        }
      );
    }
    
    // If we reached max steps without completion
    if (!taskCompleted) {
      const summary = `Task reached maximum steps (${plan.maxSteps}) without explicit completion. Current URL: ${plan.currentUrl}`;
      plan.markCompleted(summary);
      
      // Final result with steps summary
      const finalResult = await processTaskCompletion(
        userId,
        taskId,
        plan.steps.map(step => step.result || { success: false }),
        prompt,
        runDir,
        runId
      );
      
      // Update task as completed
      await Task.updateOne(
        { _id: taskId },
        { 
          $set: { 
            status: 'completed', 
            progress: 100, 
            result: finalResult, 
            endTime: new Date(),
            summary
          } 
        }
      );
      
      // Send completion update to client
      sendWebSocketUpdate(userId, {
        event: 'taskComplete',
        taskId,
        status: 'completed',
        result: finalResult
      });
    }
  } catch (error) {
    console.error(`[ProcessTask] Error in task ${taskId}:`, error);
    plan.log(`Error: ${error.message}`, { stack: error.stack });
    
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
  } finally {
    // Clean up browser resources
    if (plan.browserSession) {
      try {
        const { browser, release } = plan.browserSession;
        if (browser && !browser.process()?.killed) {
          await browser.close();
        }
        if (typeof release === 'function') {
          release();
        }
        if (activeBrowsers.has(taskId)) {
          activeBrowsers.delete(taskId);
        }
      } catch (closeError) {
        console.error(`[ProcessTask] Error closing browser for task ${taskId}:`, closeError);
      }
    }
    
    console.log(`[ProcessTask] Task ${taskId} finished with ${plan.steps.length} steps executed`);
    
    // Save the final plan summary to the database for later reference
    try {
      await Task.updateOne(
        { _id: taskId },
        { 
          $set: { 
            planSummary: plan.getSummary(),
            stepsExecuted: plan.steps.length
          } 
        }
      );
    } catch (dbError) {
      console.error(`[ProcessTask] Error saving plan summary:`, dbError);
    }
  }
}
/**
 * Helper function to add intermediate results to a task
 * @param {string} userId - User ID
 * @param {string} taskId - Task ID
 * @param {Object} result - Result to add
 */
async function addIntermediateResult(userId, taskId, result) {
  try {
    // Clean the result to avoid storing large objects
    const cleanedResult = {
      success: result.success,
      currentUrl: result.currentUrl,
      extractedInfo: typeof result.extractedInfo === 'string' 
        ? result.extractedInfo.substring(0, 1000) 
        : 'Complex data structure',
      navigableElements: Array.isArray(result.navigableElements) 
        ? result.navigableElements.slice(0, 10) 
        : [],
      screenshotPath: result.screenshotPath,
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
  // Detect the domain type to apply specialized extraction
  const currentUrl = await page.url();
  const domainType = detectDomainType(currentUrl);
  
  // Create domain-specific query sections
  const domainSpecificPrompt = generateDomainSpecificPrompt(domainType);
  
  // Updated query to enforce a more detailed JSON object response
  const combinedQuery = `
After executing "${command}", thoroughly analyze the page and return a JSON object with the following structure:
{
  "main_content": "Describe the main content visible on the page (prices, titles, important information).",
  "navigable_elements": [
    "List ALL clickable and navigable elements (links, buttons, tabs, menus, dropdowns) with PRECISE descriptive names as they appear on screen."
  ],
  "interactive_controls": [
    "List ALL interactive controls (sliders, toggles, filters, checkboxes, radio buttons, dropdowns) with their EXACT labels/names and current state if visible."
  ],
  "data_visualization": [
    "List ALL chart controls, time period selectors, indicator buttons, or visualization options with their EXACT labels."
  ],
  "product_filters": [
    "List ALL product filtering options, sorting controls, or refinement tools with their EXACT labels."
  ],
  "search_fields": [
    "List any search fields or input areas with their placeholder text."
  ],
  "pagination": "Describe any pagination controls."
}

${domainSpecificPrompt}

BE EXTREMELY THOROUGH. Missing elements is a critical error. If you see any filtering options, toggles, time range selectors, or small UI controls, be sure to include them. Pay special attention to small icons or buttons near charts or product displays.
Ensure the response is a valid JSON object.
[END OF INSTRUCTION]
${query}
  `;
 
  try {
    const extractedInfo = await agent.aiQuery(combinedQuery);
    
    // Handle non-string (object) responses
    if (typeof extractedInfo !== 'string') {
      console.log(`[Rich Context] Received non-string response:`, typeof extractedInfo);
      console.log(`[Rich Context] Full object contents:`, JSON.stringify(extractedInfo, null, 2));
      
      if (extractedInfo && typeof extractedInfo === 'object') {
        // Extract pageContent with fallbacks
        const pageContent = extractedInfo.main_content || 
                           extractedInfo.description || 
                           JSON.stringify(extractedInfo);
        
        // Combine all navigable elements from different categories for comprehensive detection
        const navigableElements = [
          ...(Array.isArray(extractedInfo.navigable_elements) ? extractedInfo.navigable_elements : []),
          ...(Array.isArray(extractedInfo.interactive_controls) ? extractedInfo.interactive_controls : []),
          ...(Array.isArray(extractedInfo.data_visualization) ? extractedInfo.data_visualization : []),
          ...(Array.isArray(extractedInfo.product_filters) ? extractedInfo.product_filters : [])
        ];
        
        return {
          pageContent,
          navigableElements
        };
      }
      
      // Fallback for invalid objects
      console.log(`[Rich Context] Invalid object received, using fallback`);
      return {
        pageContent: "No content extracted",
        navigableElements: []
      };
    }
    
    // Handle string responses (fallback for legacy behavior)
    console.log(`[Rich Context] Received string response:`, extractedInfo.substring(0, 200) + '...');
    let pageContent = extractedInfo;
    let navigableElements = [];
   
    try {
      // Parse string for navigable elements - more aggressive extraction
      const sections = extractedInfo.split(/(?:\r?\n){1,}/);
      const elementKeywords = [
        "clickable", "navigable", "button", "link", "menu", "filter", "toggle", 
        "checkbox", "select", "dropdown", "chart", "control", "tab", "icon",
        "slider", "candlestick", "time frame", "period", "indicator"
      ];
      
      // More aggressive element extraction
      for (const section of sections) {
        if (elementKeywords.some(keyword => section.toLowerCase().includes(keyword))) {
          const newElements = section.split(/\r?\n/)
                                    .filter(line => line.trim())
                                    .map(line => line.trim());
          
          navigableElements = [...navigableElements, ...newElements];
        }
      }
      
      // Deduplicate elements
      navigableElements = [...new Set(navigableElements)];
    } catch (parseError) {
      console.log("[Rich Context] Error parsing navigable elements:", parseError);
    }
   
    return {
      pageContent,
      navigableElements
    };
  } catch (queryError) {
    console.error(`[Rich Context] Error in AI query:`, queryError);
    return {
      pageContent: "Error extracting page content: " + queryError.message,
      navigableElements: []
    };
  }
}

/**
 * Detect the domain type to apply specialized extraction
 * @param {string} url - Current page URL
 * @returns {string} - Domain type
 */
function detectDomainType(url) {
  const urlLower = url.toLowerCase();
  
  // E-commerce sites
  if (urlLower.includes('amazon') || urlLower.includes('ebay') || 
      urlLower.includes('walmart') || urlLower.includes('etsy')) {
    return 'ecommerce';
  }
  
  // Crypto sites
  if (urlLower.includes('coinbase') || urlLower.includes('coingecko') || 
      urlLower.includes('coinmarketcap') || urlLower.includes('binance') ||
      urlLower.includes('kraken')) {
    return 'crypto';
  }
  
  // Social media
  if (urlLower.includes('twitter') || urlLower.includes('facebook') ||
      urlLower.includes('instagram') || urlLower.includes('tiktok')) {
    return 'social';
  }
  
  // Default
  return 'general';
}

/**
 * Generate domain-specific extraction instructions
 * @param {string} domainType - Type of domain
 * @returns {string} - Domain-specific prompt
 */
function generateDomainSpecificPrompt(domainType) {
  switch (domainType) {
    case 'ecommerce':
      return `
ECOMMERCE SITE DETECTED: Pay special attention to:
- Product filters (size, color, price, brand, rating)
- Sort options (by price, relevance, rating)
- "Add to cart" and "Buy now" buttons
- Product variations (size selectors, color pickers)
- Delivery options
- "Save for later" or wishlist buttons
      `;
    
    case 'crypto':
      return `
CRYPTOCURRENCY SITE DETECTED: Pay special attention to:
- Timeframe selectors (1H, 4H, 1D, 1W, 1M, etc.)
- Chart type toggles (candlestick, line, bar)
- Technical indicators (MACD, RSI, Moving Averages, etc.)
- Market data filters (Market Cap, Volume, Supply)
- Price alerts or watchlist buttons
- Trading pair selectors
- Order book elements
- Buy/Sell interfaces
      `;
    
    case 'social':
      return `
SOCIAL MEDIA SITE DETECTED: Pay special attention to:
- Post creation tools
- Comment and reply buttons
- Reaction/like buttons
- Share or repost options
- Message or DM buttons
- Follow/unfollow controls
- Timeline filters (Latest, Top, Trending)
      `;
    
    default:
      return `
GENERAL SITE DETECTED: Be comprehensive in finding all interactive elements.
Pay special attention to small UI controls that might be easy to miss.
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
  console.log(`[Obstacles] Checking for page obstacles...`);
  const results = {
    obstacles: [],
    actionsAttempted: [],
    success: false
  };

  try {
    // Listen for new dialogs (alerts, confirms, prompts)
    page.on('dialog', async dialog => {
      console.log(`[Obstacles] Dialog detected: ${dialog.type()}, message: ${dialog.message()}`);
      results.obstacles.push(`Dialog: ${dialog.type()} - ${dialog.message()}`);
      
      // Accept dialogs by default
      await dialog.accept();
      results.actionsAttempted.push(`Accepted ${dialog.type()} dialog`);
    });

    // Check for common obstacles
    const obstacleCheck = `
      Analyze the current page for any of these common obstacles:
      1. Cookie consent banners or popups
      2. Newsletter signup or subscription modals
      3. Login walls or authentication prompts
      4. Age verification prompts
      5. GDPR or privacy notice banners
      6. "Allow notifications" prompts
      7. App download suggestions
      8. Survey or feedback requests
      9. Captcha or verification challenges
      10. Ads that block content

      For each obstacle found, identify:
      - The exact text on dismiss/accept buttons
      - The location on screen (top, bottom, center)
      - Whether it blocks the main content
      
      Return in a clear, structured format.
    `;
    
    // Execute the obstacle check
    const obstacles = await agent.aiQuery(obstacleCheck);
    
    if (typeof obstacles === 'string') {
      if (obstacles.toLowerCase().includes('no obstacles') || 
          obstacles.toLowerCase().includes('not found') ||
          obstacles.toLowerCase().includes('none detected')) {
        console.log(`[Obstacles] No obstacles detected`);
        results.success = true;
        return results;
      }
      
      // Log detected obstacles
      console.log(`[Obstacles] Detected: ${obstacles.slice(0, 150)}...`);
      results.obstacles.push(obstacles);
      
      // Try to handle the obstacles
      const dismissActions = [
        // Cookie consent
        "Find and click 'Accept', 'Accept All', 'I Accept', 'I Agree', or 'Agree' buttons for cookie notices",
        // Privacy notices
        "Find and click 'Continue', 'Close', 'Got it', 'I understand', or 'OK' buttons for privacy notices",
        // Modal closing
        "Look for and click 'X', 'Close', 'Skip', 'No thanks', or 'Maybe later' buttons on any popups or modals",
        // Captcha handling (basic)
        "If there's a CAPTCHA, look for a checkbox and click it"
      ];
      
      // Try each dismissal strategy
      for (const action of dismissActions) {
        try {
          console.log(`[Obstacles] Attempting: ${action}`);
          await agent.aiAction(action);
          results.actionsAttempted.push(action);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Check if the obstacle is still present
          const recheck = await agent.aiQuery("Are there still any popups, modals, or banners blocking the content?");
          if (recheck.toLowerCase().includes('no') || 
              recheck.toLowerCase().includes('gone') || 
              recheck.toLowerCase().includes('removed') ||
              recheck.toLowerCase().includes('cleared')) {
            console.log(`[Obstacles] Successfully cleared obstacles`);
            results.success = true;
            break;
          }
        } catch (actionError) {
          console.log(`[Obstacles] Action failed: ${actionError.message}`);
          continue; // Try next action
        }
      }
    } else if (typeof obstacles === 'object') {
      // Handle structured response
      console.log(`[Obstacles] Received structured obstacle data`);
      results.obstacles.push(JSON.stringify(obstacles));
      results.success = true; // Assume success for now
    }
    
    return results;
  } catch (error) {
    console.error(`[Obstacles] Error during obstacle handling:`, error);
    results.obstacles.push(`Error: ${error.message}`);
    return results;
  }
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