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

// Set strictQuery to avoid deprecation warnings
mongoose.set('strictQuery', true);

// Set up __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure puppeteer extra with the stealth plugin
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

// Create Express app and HTTP server
const app = express();
const server = createServer(app);

// === MIDDLEWARE SETUP (IMPORTANT ORDER) ===

// 1. Parse JSON bodies
app.use(express.json());

// 2. Register session middleware early so that every request gets a session
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dailAdmin:ua5^bRNFCkU*--c@operator.smeax.mongodb.net/dail?retryWrites=true&w=majority&appName=OPERATOR";
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    dbName: 'dail',
    collectionName: 'sessions',
    ttl: 24 * 60 * 60,         // 24 hours in seconds
    autoRemove: 'native',      // Use MongoDB's native TTL cleanup
    touchAfter: 24 * 3600      // Only update session if older than 24 hours
  }),
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours in milliseconds
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

// 3. Session logging middleware (for debugging)
app.use((req, res, next) => {
  console.log('Session ID:', req.sessionID);
  console.log('Session Data:', req.session);
  next();
});

// 4. Serve static files from production build (dist) and public assets
app.use(express.static(path.join(__dirname, 'dist')));
app.use('/src', express.static(path.join(__dirname, 'src'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));
app.use('/midscene_run', express.static(MIDSCENE_RUN_DIR));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// === WEB SOCKET SETUP ===

// === WEB SOCKET SETUP ===

const userConnections = new Map();
const wss = new WebSocketServer({ server, path: '/ws' });
const unsentMessages = new Map();

function sendWebSocketUpdate(userId, data) {
  // console.log(`[WebSocket] Sending to userId=${userId}:`, JSON.stringify(data, null, 2));
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
    console.warn(`[WebSocket] No active connections for userId=${userId}. Queuing message.`);
    if (!unsentMessages.has(userId)) {
      unsentMessages.set(userId, []);
    }
    unsentMessages.get(userId).push(data);
  }
}

wss.on('connection', (ws, req) => {
  let userIdParam = req.url.split('userId=')[1]?.split('&')[0];
  const userId = decodeURIComponent(userIdParam || '');
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

// === ROUTES ===

// Authentication middleware
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ success: false, error: 'Not logged in' });
  next();
}

// Define your routes here
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
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new Error('Invalid email or password');
    }
    req.session.user = user._id; // Save the MongoDB _id in the session
    res.json({ success: true, userId: user._id.toString() }); // Return the _id as a string
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

/*******************************
 * GET /history
 * Returns paginated "completed" tasks for the user
 *******************************/
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
        // Return the entire result so the front-end can see if needed
        result: task.result || {}
      })),
    });
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/*******************************
 * GET /history/:id
 * Returns a single completed task (or any task) with full details
 *******************************/
app.get('/history/:id', requireAuth, async (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/json');
    const task = await Task.findOne({ _id: req.params.id, userId: req.session.user }).lean();
    if (!task) {
      return res.status(404).json({ error: 'History item not found' });
    }

    // Return everything needed:
    res.json({
      _id: task._id,
      url: task.url || 'Unknown URL',
      command: task.command,
      timestamp: task.endTime,
      status: task.status,
      error: task.error,
      subTasks: task.subTasks,
      // Return the entire intermediateResults array
      intermediateResults: task.intermediateResults || [],
      // Return the entire "result" object, which might contain raw, aiPrepared, 
      // landingReportUrl, midsceneReportUrl, screenshot, etc.
      result: task.result || {}
    });
  } catch (err) {
    console.error('Error fetching history item:', err);
    res.status(500).json({ error: 'Failed to fetch history item' });
  }
});

/*******************************
 * DELETE /history/:id
 * Removes one completed task from the DB
 *******************************/
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

/*******************************
 * DELETE /history
 * Clears all "completed" tasks for the user
 *******************************/
app.delete('/history', requireAuth, async (req, res) => {
  try {
    await Task.deleteMany({ userId: req.session.user, status: 'completed' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/*******************************
 * GET /chat-history
 * Returns the chat history for the user
 *******************************/
app.get('/chat-history', requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database not connected');
    }
    // Ensure the user is logged in.
    if (!req.session.user) {
      // Alternatively, you could send a 401 error.
      return res.json({ messages: [] });
    }
    
    // Find the user's chat history.
    const chatHistory = await ChatHistory.findOne({ userId: req.session.user }).lean();
    if (!chatHistory) {
      // Return empty messages if no history exists.
      return res.json({ messages: [] });
    }
    // Optionally, you could include a success flag.
    res.json({ success: true, messages: chatHistory.messages });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch chat history' });
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

/**
 * Utility to limit a string’s length and add a note if trimmed.
 * @param {string} str - The string to trim.
 * @param {number} maxLen - Maximum length before truncation.
 * @return {string} - Trimmed string (with appended note if truncated).
 */
function trimString(str, maxLen = 200) {
  if (typeof str !== 'string') return str;
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + `... [trimmed, original length: ${str.length}]`;
}

/**
 * A thorough function to remove or shorten large fields in an “update” object
 * before sending logs or SSE data to the client.
 * 
 * “update” typically has structure:
 *   {
 *     status, progress, intermediateResults[], steps[],
 *     error, result, done
 *   }
 * This function:
 *   - Removes base64 screenshot data in favor of screenshot *paths*
 *   - Trims large text fields: extractedInfo, rawResponse, etc.
 *   - Replaces big nested DOM data (tree, pageContext) with placeholders
 *   - Works shallowly in result & intermediateResults[] but not deep recursion.
 * 
 * @param {Object} originalUpdate - The raw update object from the DB or code.
 * @returns {Object} - A copy of “originalUpdate” with large fields trimmed.
 */
function stripLargeFields(originalUpdate) {
  // Clone so we don't mutate the original object
  const newUpdate = { ...originalUpdate };

  // --- 1) TRIM FIELDS IN "result" ---

  if (newUpdate.result && typeof newUpdate.result === 'object') {
    // If there's raw screenshot data, remove or replace with a short note.
    if (newUpdate.result.screenshot) {
      newUpdate.result.screenshot = '[Screenshot Omitted - use screenshotPath instead]';
    }

    // If there's a screenshotPath, keep it (that’s presumably just a short URL).
    // newUpdate.result.screenshotPath is fine.

    // If there's large text fields like extractedInfo or rawResponse, trim them
    if (typeof newUpdate.result.extractedInfo === 'string') {
      newUpdate.result.extractedInfo = trimString(newUpdate.result.extractedInfo, 300);
    }
    if (typeof newUpdate.result.rawResponse === 'string') {
      newUpdate.result.rawResponse = trimString(newUpdate.result.rawResponse, 300);
    }

    // If there's a potentially huge nested object like pageContext or tree, replace with a note
    if (newUpdate.result.pageContext && typeof newUpdate.result.pageContext === 'object') {
      newUpdate.result.pageContext = '[pageContext omitted - too large]';
    }
    if (newUpdate.result.tree && typeof newUpdate.result.tree === 'object') {
      newUpdate.result.tree = '[DOM tree omitted - too large]';
    }
  }

  // --- 2) TRIM FIELDS IN "intermediateResults" ARRAY ---

  if (Array.isArray(newUpdate.intermediateResults)) {
    newUpdate.intermediateResults = newUpdate.intermediateResults.map((item) => {
      const trimmed = { ...item };

      // If there's a raw screenshot, remove or replace it
      if (trimmed.screenshot) {
        trimmed.screenshot = '[Screenshot Omitted - use screenshotPath instead]';
      }

      // Keep screenshotPath if present (that’s a short string).
      // if (trimmed.screenshotPath) ...

      // If there's big text fields, trim them
      if (typeof trimmed.extractedInfo === 'string') {
        trimmed.extractedInfo = trimString(trimmed.extractedInfo, 300);
      }
      if (typeof trimmed.rawResponse === 'string') {
        trimmed.rawResponse = trimString(trimmed.rawResponse, 300);
      }

      // Potential heavy fields
      if (trimmed.pageContext && typeof trimmed.pageContext === 'object') {
        trimmed.pageContext = '[pageContext omitted - too large]';
      }
      if (trimmed.tree && typeof trimmed.tree === 'object') {
        trimmed.tree = '[DOM tree omitted - too large]';
      }

      return trimmed;
    });
  }

  // --- 3) (Optional) TRIM FIELDS IN "steps" IF YOU USE THAT ---

  if (Array.isArray(newUpdate.steps)) {
    // If you store big logs or screenshot data in steps, do something similar:
    newUpdate.steps = newUpdate.steps.map((step) => {
      const s = { ...step };
      // For example, if step has “screenshot”:
      if (s.screenshot) {
        s.screenshot = '[Screenshot Omitted - use screenshotPath instead]';
      }
      // If step has big text fields:
      if (typeof s.extractedInfo === 'string') {
        s.extractedInfo = trimString(s.extractedInfo, 300);
      }
      if (s.pageContext && typeof s.pageContext === 'object') {
        s.pageContext = '[pageContext omitted - too large]';
      }
      return s;
    });
  }

  // That’s enough for a shallow pass. Return the trimmed copy.
  return newUpdate;
}

// Task Stream Endpoint
app.get('/tasks/:id/stream', requireAuth, async (req, res) => {
  logger.info('Task stream started', { taskId: req.params.id });

  const sendUpdate = async () => {
    try {
      const task = await Task.findById(req.params.id).lean();
      if (!task) {
        res.write(`data: ${JSON.stringify({ done: true, error: 'Task not found' })}\n\n`);
        res.end();
        return;
      }

      const update = stripLargeFields({
        status: task.status || 'unknown',
        progress: task.progress || 0,
        intermediateResults: task.intermediateResults || [],
        steps: task.steps || [],
        error: task.error || null,
        result: task.result || null,
        done: ['completed', 'error'].includes(task.status),
      });
      res.write(`data: ${JSON.stringify(update)}\n\n`);
      logger.info('Task update sent', { taskId: req.params.id, update });

      if (update.done) res.end();
    } catch (err) {
      logger.error('Task stream error', err);
      res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
      res.end();
    }
  };

  await sendUpdate();
  const interval = setInterval(sendUpdate, 5000);
  req.on('close', () => {
    clearInterval(interval);
    res.end();
    logger.info('Task stream closed', { taskId: req.params.id });
  });
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

// Fallback route: send index.html for any unmatched routes (for client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

import { Schema } from 'mongoose';
import { error } from 'console';

const userSchema = new Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  customUrls: [{ type: String }],
});
userSchema.index({ email: 1 }, { unique: true });
const User = mongoose.model('User', userSchema);

const chatHistorySchema = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messages: [{
    role: { 
      type: String, 
      enum: ['user', 'assistant', 'system', 'function'], 
      required: true 
    },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }]
});
chatHistorySchema.index({ userId: 1 });
const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);

// Task schema definition
const taskSchema = new Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  command: String,
  status: { type: String, enum: ['pending', 'processing', 'completed', 'error'], default: 'pending' },
  progress: { type: Number, default: 0 },
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  result: Schema.Types.Mixed,
  error: String,
  url: String,
  runId: String,
  isComplex: { type: Boolean, default: false },
  subTasks: [{
    id: { type: String },
    command: String,
    status: { type: String, enum: ['pending', 'processing', 'completed', 'error'], default: 'pending' },
    result: Schema.Types.Mixed,
    progress: { type: Number, default: 0 },
    error: String
  }],
  intermediateResults: [Schema.Types.Mixed],
  plan: String,
  steps: [String],
  totalSteps: Number,
  currentStep: Number,
  stepMap: Schema.Types.Mixed,
  currentStepDescription: String,
  currentStepFunction: String,
  currentStepArgs: Schema.Types.Mixed,
  planAdjustment: String,
  lastAction: String,
  lastQuery: String
});
taskSchema.index({ endTime: 1 }, { expireAfterSeconds: 604000 });
const Task = mongoose.model('Task', taskSchema);

// Function to clear the database once
async function clearDatabaseOnce() {
  const flagFile = path.join(__dirname, 'db_cleared.flag');
  if (fs.existsSync(flagFile)) {
    console.log('Database already cleared, skipping clear operation.');
    return;
  }

  try {
    await User.deleteMany({});
    await ChatHistory.deleteMany({});
    await Task.deleteMany({});
    console.log('Successfully cleared User, ChatHistory, and Task collections.');

    // Create flag file to prevent future clears
    fs.writeFileSync(flagFile, 'Database cleared on ' + new Date().toISOString());
    console.log('Created db_cleared.flag to mark database clear completion.');
  } catch (err) {
    console.error('Error clearing database:', err);
  }
}

// MongoDB Connection and Startup
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
    await ChatHistory.ensureIndexes();
    console.log('ChatHistory indexes ensured');
    await Task.ensureIndexes();
    console.log('Task indexes ensured');
  } catch (err) {
    console.error('Error ensuring indexes:', err);
  }
}

async function startApp() {
  try {
    await pRetry(connectToMongoDB, {
      retries: 5,
      minTimeout: 2000,
      onFailedAttempt: error => {
        console.log(`MongoDB connection attempt ${error.attemptNumber} failed. Retrying...`);
      }
    });
    // await clearDatabaseOnce(); // Run one-time database clear
    await ensureIndexes();
    console.log('Application started successfully');
  } catch (err) {
    console.error('Failed to start application:', err);
    process.exit(1);
  }
}
await startApp();

// === START THE SERVER ===

const PORT = process.env.PORT || 3400;
server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});

// Graceful shutdown on SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  try {
    // Close the HTTP server if available
    server.close(() => {
      console.log('HTTP server closed.');
    });
    // Close your Mongoose connection
    await mongoose.connection.close();
    console.log('Mongoose connection closed.');
  } catch (error) {
    console.error('Error during shutdown:', error);
  } finally {
    // Exit the process explicitly
    process.exit(0);
  }
});

process.on('uncaughtException', (err) => { console.error('Uncaught Exception:', err); process.exit(1); });
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Utility functions
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      runId
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

    // Compile all intermediate extracted info into one raw page text.
    const rawPageText = intermediateResults
      .map(step => (step && step.result && step.result.extractedInfo) || '')
      .join('\n');

    // Use the last intermediate result for the final URL and summary.
    const currentUrl = (intermediateResults[intermediateResults.length - 1]?.result?.currentUrl) || 'N/A';
    const summary = intermediateResults[intermediateResults.length - 1]?.result?.actionOutput ||
      `Task execution completed for: ${originalPrompt}`;

    // Unified final result object.
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
      midsceneReportUrl: midsceneReportUrl || null
    };

    return finalResult;
  } catch (error) {
    console.error(`[TaskCompletion] Error:`, error);
    const errorReportFile = `error-report-${Date.now()}.html`;
    const errorReportPath = path.join(REPORT_DIR, errorReportFile);
    fs.writeFileSync(errorReportPath, `Error Report: ${error.message}`);
    return {
      success: false,
      taskId,
      error: error.message,
      reportUrl: `/midscene_run/report/${errorReportFile}`
    };
  } finally {
    // Clean up active browser sessions.
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
          ${results
            .slice(0, 10) // Only include up to 10 steps in the report
            .map((result, index) => {
              let resultDisplay = '';
              if (result.error) {
                resultDisplay = `
                  <div class="task error">
                    <div class="task-header">Step ${index + 1} - Error</div>
                    <pre>${JSON.stringify(result, null, 2).substring(0, 500)}</pre>
                  </div>`;
              } else if (result.screenshot) {
                const screenshotUrl = result.screenshotPath || `/midscene_run/${runId}/${result.screenshot}`;
                resultDisplay = `
                  <div class="task">
                    <div class="task-header">Step ${index + 1} - Screenshot</div>
                    <img src="${screenshotUrl}" class="screenshot" alt="Step ${index + 1} Screenshot">
                    ${result.summary ? `<p>${result.summary.substring(0, 300)}...</p>` : ''}
                  </div>`;
              } else {
                resultDisplay = `
                  <div class="task">
                    <div class="task-header">Step ${index + 1}</div>
                    <pre>${JSON.stringify(result, null, 2).substring(0, 500)}</pre>
                  </div>`;
              }
              return resultDisplay;
            }).join('')
          }         
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
  constructor(userId, taskId, prompt, initialUrl, runDir, runId, maxSteps = 10) {
    this.userId = userId;
    this.taskId = taskId;
    this.prompt = prompt; // Main Task description
    this.initialUrl = initialUrl;
    this.runDir = runDir;
    this.runId = runId; // For file URLs
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
  }

  log(message, metadata = {}) {
    const entry = { timestamp: new Date().toISOString(), message, ...metadata };
    this.planLog.push(entry);
    console.log(`[Task ${this.taskId}] ${message}`, metadata);
  }

  /**
   * Create a new step in the plan.
   * After execution, a short step summary (max ~5 tokens) is generated
   * and stored in the step's `stepSummary` property.
   * @param {string} type - Step type: 'action' or 'query'
   * @param {string} instruction - Instruction for the step
   * @param {Object} args - Associated arguments
   * @returns {PlanStep} - The created step.
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
          // Update currentUrl using the returned value (or fallback to previous)
          plan.currentUrl = result.currentUrl || plan.currentUrl;
          // Update the current state using the new "state" property from the result.
          if (result.state) {
            plan.currentState = result.state;
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
   * Mark the plan as completed
   * @param {string} summary - Completion summary
   */
  markCompleted(summary) {
    this.completed = true;
    this.summary = summary;
    this.log(`Task marked as completed: ${summary}`);
  }

   /**
   * Helper method to update globals when a result is received.
   * This method ensures that:
   * - The currentState array gets the new state appended.
   * - The extractedInfo and navigatableElements are updated (or appended) consistently.
   */
   updateGlobalState(result) {
    // Update currentState: Append the new assertion.
    if (result.state && result.state.assertion) {
      this.currentState.push({ assertion: result.state.assertion });
    } else if (this.currentState.length === 0) {
      this.currentState.push({ assertion: 'No assertion available' });
    }
    
    // Extract and update extractedInfo: handle if it's an object with a pageContent property.
    let extracted = 'No extracted info available';
    if (result.extractedInfo) {
      if (typeof result.extractedInfo === 'object' && result.extractedInfo.pageContent) {
        extracted = result.extractedInfo.pageContent;
      } else if (typeof result.extractedInfo === 'string') {
        extracted = result.extractedInfo;
      }
    }
    this.extractedInfo.push(extracted);
    
    // Update navigatableElements: append new elements to the existing array.
    if (result.navigableElements && Array.isArray(result.navigableElements)) {
      this.navigatableElements = this.navigatableElements.concat(result.navigableElements);
    } else if (this.navigatableElements.length === 0) {
      this.navigatableElements = [];
    }
  }

  /**
   * Generate a system prompt that now includes a PROGRESS SUMMARY section
   * based on the last step's short summary.
   * @returns {string} - The generated system prompt.
   */
  generateSystemPrompt() {
    const latestState = (Array.isArray(this.currentState) && this.currentState.length)
      ? this.currentState[this.currentState.length - 1]
      : { assertion: 'No assertion available' };
    const assertionSummary = latestState.assertion || 'No assertion available';

    // For extracted info, get the latest entry (assuming string content)
    const latestExtracted = (Array.isArray(this.extractedInfo) && this.extractedInfo.length)
      ? this.extractedInfo[this.extractedInfo.length - 1]
      : 'No extracted info available';
    const extractedSummary = latestExtracted
      ? latestExtracted.substring(0, 700) + '...'
      : 'No extracted info available';

    // Rest of your progress summary from steps
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

    // NOTE: The starting URL now shows properly if provided.
    return `
You are an AI assistant automating browser tasks with resilience and adaptability. 
You never fail to accomplish the task and reason all steps until you accomplish it. 
You always instruct towards achieving the "Main Task".

GUIDELINES:
1. PERSISTENCE: Never give up on a task. If one approach fails, try alternative methods.
2. AUTONOMY: You must determine steps needed without user input after initial request.
3. PLANNING: You can take in a plan and execute it, or you can create a step-by-step plan based on the result of each step you take. You are smart and can figure out how to navigate towards the goal.
4. ADAPTABILITY: Review each result and adjust your plan based on new information.
5. COMMUNICATION: Explain what you're doing and why in simple language.
6. PROGRESS TRACKING: Clearly indicate task progress and status.
7. EXTRACTING DATA: Always provide a high level instruction which includes scrolling to extract all data on the page. E.g., "Scroll down and list 5 trending tokens based on volume"
8. NAVIGATION EFFICIENCY: Before deciding to navigate, check if the current page is already the required one for the step. Only navigate if the step requires a different page or if the current page cannot fulfill the step’s goal.
9. NEXT STEP PRECISION: You plan incremental steps based on what you see or is extracted. 
CAPABILITIES:
- You can call functions to interact with web browsers.
- You maintain context between function calls to track task progress.
- You make decisions based on function results to determine next steps, you never predict but try to click what is visible or extracted info.

FUNCTIONS AVAILABLE:
- browser_action: Execute actions on websites or navigate to URL (clicking, typing, navigating, scrolling, etc. browser_action has not data extraction capabilities, never use for data extraction).
- browser_query: Extract information from websites (it can navigate autonomously to desired page, click elements on page to navigate or filter products or charts, or select, extract info).
- Use these functions interchangeably where relevant.

ERROR RECOVERY:
- When stuck on a page, try URL construction with query parameters, or instruct browser_action to navigate through main menu or sidebar.
- When element selection fails, treat them as decoration images and try different selectors.
- If clicking a button or element does not work, use top menu options or sidebar menus to navigate.
- Overlays can affect navigation: check for them and try to dismiss if found.
- If you navigate to the wrong page or URL or Domain which does not have desired info & content relevant to our main goal, navigate using menus or go back to the last known URL using browser_action.

**Instructions**:
- Use 'browser_action' for navigation, clicks, or input (e.g., {"command": "navigate to https://example.com"}). This function is for high-level commands.
- Use 'browser_query' to analyze the page or extract info (e.g., {"query": "What is on the page?"}). This function extracts visible data.
- Break complex commands into simpler steps only when necessary.
- If the starting URL is 'Not specified', include the 'url' parameter in your first call.
- Use 'task_complete' with a summary to finish (e.g., {"summary": "Task done"}).
- If stuck, propose a new approach based on the current state and navigatable elements, you can navigate other ways.
- DONT SIGN UP or SIGN IN to crypto, shopping, news, or other open sites to read and view data. Only sign in if user specifies it in the instructions.

**Rules**:
- Only navigate by clicking elements. Read extracted info from the current page below, then determine what is useful in navigating towards goal.
- For example if extracted info shows "a page showing crypto currencies like bitocin and prices. navigatable elements: ALL CHAINS, Pairs, News etc" then choose a relevant natigatable element like clicking all chains instead of trying to sign up or sign in or go somewhere useless.
- Always check full progress summary before making decisions. Get the full picture of where you are and overall progress first, dont guess, dont go offside.
- Always return a function call in JSON format.
- Keep actions specific and goal-oriented toward "Main Task".
- Avoid repeating failed actions without new information.
- When scrolling, ensure the desired content remains in view.
- Avoid going beyond Main Task. Always check current url, state summary, progress summary to see if the main goal or Main Task as been achieved, then mark as complete by firing task_complete.

CONSIDER THESE TASK DETAILS IN FULL TO PLAN FOR YOUR NEXT STEP FORWARD TOWARDS ACHIEVING THE 'Main Task':
**Main Task**: "${this.prompt}"
**Starting URL**: ${this.initialUrl || 'Not specified'}
**Current Step**: ${this.currentStepIndex + 1} of ${this.maxSteps} max
**Current URL**: ${this.currentUrl || 'Not yet navigated'}

PROGRESS SUMMARY (based on previous step): ${lastStepSummary}
- FULL STEP SUMMARY:
**Progress Summary**:
${progressSummary}
**Recent Failures**:
${recentFailures}
**Extracted Useful Infomation from Prev Step**:
- ${extractedSummary}
**Previous Step's Assertion (Page State)**:
- ${assertionSummary}

[END OF SUMMARY]

Aim for the Main Task with maximum efficiency, navigation awareness, smart prompt crafting & function calling, and accuracy: "${this.prompt}".
Now proceed.

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
    // Only generate a summary if not present.
    if (this.stepSummary) return this.stepSummary;
    try {
      // Call OpenAI with a prompt to summarize the step very briefly.
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
      } else if (this.type === 'query') {
        result = await plan.executeBrowserQuery(this.args, this.index);
      } else {
        throw new Error(`Unknown step type: ${this.type}`);
      }
  
      this.result = result;
      this.status = result.success ? 'completed' : 'failed';
      this.endTime = new Date();
      
      // Update the plan’s global state:
      // 1. Store the assertion under currentState
      // 2. Store the extracted info separately
      plan.updateGlobalState(result);

      plan.extractedInfo = result.extractedInfo || 'No content extracted';
      // Update browser session and global state using result.state
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
      
      // Generate and store a short step summary if not already set.
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

    // Update task status in database.
    await updateTaskInDatabase(taskId, {
      status: 'processing',
      progress: 50,
      lastAction: command
    });

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
        activeBrowsers.set(task_id, { browser, agent, page, release, closed: false, hasReleased: false });
      }

      // Force navigation if a navigation command is provided and the current URL differs from the target.
      const currentPageUrl = await page.url();
      if (isNavigationCommand && effectiveUrl && currentPageUrl !== effectiveUrl) {
        logAction(`Navigating from ${currentPageUrl} to new URL: ${effectiveUrl}`);
        await page.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
        logAction("Navigation completed successfully");
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
        activeBrowsers.set(task_id, { browser, agent, page, release, closed: false, hasReleased: false });
      }
    } else {
      // Create new session and navigate.
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
      activeBrowsers.set(task_id, { browser, agent, page, release, closed: false, hasReleased: false });
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
          agent = new PuppeteerAgent(page, { 
            provider: 'huggingface', 
            apiKey: process.env.HF_API_KEY, 
            model: 'bytedance/ui-tars-72b'
          });
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
      task_id,
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
      task_id,
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
  const { query, url: providedUrl, task_id } = args;
  let browser, agent, page, release;
  const actionLog = [];

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

  await updateTaskInDatabase(taskId, {
    status: 'processing',
    progress: 50,
    lastAction: query
  });

  try {
    logQuery(`Starting query: "${query}"`);

    const taskKey = task_id || taskId;

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
        activeBrowsers.set(taskKey, { browser, agent, page, release, closed: false, hasReleased: false });
      }
    } else if (taskKey && activeBrowsers.has(taskKey)) {
      const session = activeBrowsers.get(taskKey);
      if (!session || !session.browser) {
        logQuery("Browser session not valid, creating a new one.");
        browser = await puppeteerExtra.launch({ 
          headless: false,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
          defaultViewport: { width: 1280, height: 720 }
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
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
      browser = await puppeteerExtra.launch({ 
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
        defaultViewport: { width: 1280, height: 720 }
      });
      logQuery("Browser launched successfully");
      page = await browser.newPage();
      logQuery("New page created");
      await page.setDefaultNavigationTimeout(60000);
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
      task_id,
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
      task_id,
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
 * A minimal classifier that calls your LLM to see if the user wants “chat” or “task”.
 * You can replace with simpler logic (regex, keywords, etc.) if you like.
 */
async function openaiClassifyPrompt(prompt) {
  const classification = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You classify user messages as "task" or "chat". Respond ONLY with "task" or "chat".' },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    max_tokens: 5,
  });
  const content = classification.choices?.[0]?.message?.content?.toLowerCase() || '';
  if (content.includes('task')) return 'task';
  return 'chat';
}


/**
 * Unified NLI endpoint:
 * - If we detect it's a “task,” do your existing logic.
 * - If we detect it's “chat,” stream partial output from the LLM directly.
 */
app.post('/nli', requireAuth, async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    logger.warn('Missing prompt in request');
    return res.status(400).json({ success: false, error: 'Prompt is required' });
  }

  const userId = req.session.user;
  const user = await User.findById(userId).select('email').lean();
  if (!user) {
    logger.error('User not found', { userId });
    return res.status(400).json({ success: false, error: 'User not found' });
  }

  let classification;
  try {
    classification = await openaiClassifyPrompt(prompt);
    logger.info('Prompt classified', { prompt, classification });
  } catch (err) {
    logger.error('Classification error, defaulting to task', err);
    classification = 'task';
  }

  if (classification === 'task') {
    logger.info('Processing as task');

    // Save the user command to ChatHistory even for tasks.
    let chatHistory = await ChatHistory.findOne({ userId });
    if (!chatHistory) {
      chatHistory = new ChatHistory({ userId, messages: [] });
    }
    chatHistory.messages.push({
      role: 'user',
      content: prompt,
      timestamp: new Date()
    });
    await chatHistory.save();

    const taskId = new mongoose.Types.ObjectId();
    const runId = uuidv4();
    const runDir = path.join(MIDSCENE_RUN_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    try {
      const newTask = new Task({
        _id: taskId,
        userId,
        command: prompt,
        status: 'pending',
        progress: 0,
        startTime: new Date(),
        runId
      });
      await newTask.save();
      await User.updateOne({ _id: userId }, { 
        $push: { 
          activeTasks: { _id: taskId.toString(), command: prompt, status: 'pending', startTime: new Date() } 
        } 
      });
      logger.info('Task created', { taskId, runId });
    } catch (err) {
      logger.error('Database error creating task', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }

    processTask(userId, user.email, taskId.toString(), runId, runDir, prompt, null);
    return res.json({ success: true, taskId: taskId.toString(), runId });
  } else {
    // --- Chat branch (non-streaming) ---
    logger.info('Processing as chat, using normal JSON response');

    let chatHistory = await ChatHistory.findOne({ userId });
    if (!chatHistory) {
      chatHistory = new ChatHistory({ userId, messages: [] });
    }
    chatHistory.messages.push({
      role: 'user',
      content: prompt,
      timestamp: new Date()
    });
    await chatHistory.save();

    const lastMessages = chatHistory.messages
      .filter(m => ['user', 'assistant'].includes(m.role))
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: lastMessages,
        temperature: 0.7,
        stream: false
      });

      const assistantReply = completion.choices[0].message.content;
      chatHistory.messages.push({
        role: 'assistant',
        content: assistantReply,
        timestamp: new Date()
      });
      await chatHistory.save();

      res.json({ success: true, assistantReply });
      logger.info('Chat response sent', { userId });
    } catch (err) {
      logger.error('Chat error', err);
      res.status(500).json({ success: false, error: err.message });
    }
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
  console.log(`[ProcessTask] Starting task ${taskId} with prompt: "${prompt}"`);
  
  const plan = new TaskPlan(userId, taskId, prompt, url, runDir, runId);
  plan.log("Task plan created.");
  
  try {
    await Task.updateOne({ _id: taskId }, { $set: { status: 'processing', progress: 5 } });
    plan.log("Task status updated to processing in DB (progress 5%).");
    
    sendWebSocketUpdate(userId, { event: 'taskStart', taskId, prompt, url });
    plan.log("Sent taskStart update over WebSocket.");

    let taskCompleted = false;
    let consecutiveFailures = 0;

    while (!taskCompleted && plan.currentStepIndex < plan.maxSteps - 1) {
      const systemPrompt = plan.generateSystemPrompt();
      plan.log(`Generated system prompt: ${systemPrompt}`);
      
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
                  ? cleanForPrompt(step.result.extractedInfo)
                  : "No extraction",
                navigableElements: Array.isArray(step.result.navigableElements)
                  ? step.result.navigableElements.map(el => cleanForPrompt(el))
                  : "No navigable elements"
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
      
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        stream: true,
        temperature: 0.2,
        max_tokens: 700,
        tools: [
          {
            type: "function",
            function: {
              name: "browser_action",
              description: "Executes a browser action (e.g., click, scroll, type) on the page.",
              parameters: {
                type: "object",
                properties: {
                  command: { type: "string" },
                  url: { type: "string" },
                  task_id: { type: "string" }
                },
                required: ["command"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "browser_query",
              description: "Extracts information from the webpage.",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  url: { type: "string" },
                  task_id: { type: "string" }
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
                      { $set: { status: 'completed', progress: 100, result: cleanedFinal, endTime: new Date() } }
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
        }
      }
      
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
  } finally {
    if (plan.browserSession) {
      try {
        const { browser, release, hasReleased } = plan.browserSession;
        if (browser && !browser.process()?.killed) {
          await browser.close();
        }
        if (!hasReleased && typeof release === 'function') {
          release();
          plan.browserSession.hasReleased = true;
        } else {
          console.warn(`[ProcessTask] Expected release as function but got ${typeof release} for session ${plan.taskId}.`);
        }
        plan.browserSession.closed = true;
        activeBrowsers.delete(plan.taskId);
        console.log(`[ProcessTask] Closed browser session ${plan.taskId}`);
        plan.log("Browser session closed and removed from active browsers.");
      } catch (error) {
        console.error(`[ProcessTask] Error closing browser session ${plan.taskId}:`, error);
      }
    }
    
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
