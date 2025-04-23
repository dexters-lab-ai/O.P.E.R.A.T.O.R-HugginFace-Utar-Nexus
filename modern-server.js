// =========================
// OPERATOR Modern Interface Server
// =========================
// Organized for clarity and maintainability

// --- 0. IMPORTS & GLOBALS ---
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import mongoose from 'mongoose';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mime from 'mime';

// --- Routers & Models ---
import messagesRouter from './src/routes/messages.js';
import tasksRouter from './src/routes/tasks.js';
import authRouter from './src/routes/auth.js';
import ChatHistory from './src/models/ChatHistory.js';
import User from './src/models/User.js';

// --- Path helpers ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================
// 1. ENVIRONMENT CONFIG
// =========================
const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;

// =========================
// 2. APP INITIALIZATION
// =========================
const app = express();

// =========================
// 3. STATIC FILE MIDDLEWARE
// =========================
// Ensure correct MIME types for .js, .css, .glb, etc.
mime.define({'application/javascript': ['js']}, true);
mime.define({'text/css': ['css']}, true);
mime.define({'model/gltf-binary': ['glb']}, true);

// Serve static files
app.use('/css', express.static(path.join(__dirname, 'public/css'), { 
  setHeaders: (res) => {
    res.set('Content-Type', 'text/css');
  }
}));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/src', express.static(path.join(__dirname, 'src')));  // Only for development
app.use('/vendors', express.static(path.join(__dirname, 'public/vendors')));

app.use('/models', express.static(path.join(__dirname, 'public/models')));
// Serve /js/components for ES module imports
app.use('/js/components', express.static(path.join(__dirname, 'public/js/components')));
// --- End static file serving ---

// =========================
// 4. BODY PARSERS
// =========================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// 5. SESSION STORE
// =========================
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI, collectionName: 'sessions' }),
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// --- 5. DEBUG LOGGER FOR SESSIONS ---
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('👉 Session:', req.sessionID, req.session);
  }
  next();
});

// --- 6. STATIC ASSETS ---
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.set('Content-Type', 'text/javascript');
    }
  }
}));

// Serve Bruno Simon's original assets (models, environment)
app.use(
  '/bruno_demo_temp/static',
  express.static(path.join(__dirname, 'bruno_demo_temp', 'static'))
);

// Legacy compatibility for /styles -> /css
express.static.mime.define({'text/css': ['css']});
app.use('/styles', express.static(path.join(__dirname, 'src', 'styles')));

// Add static file serving for lib directory
app.use('/lib', express.static(path.join(__dirname, 'public', 'lib')));

// Serve OrbitControls from lib directory
app.get('/lib/OrbitControls.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lib', 'OrbitControls.js'), {
    headers: {
      'Content-Type': 'application/javascript'
    }
  });
});

// Serve GLTFLoader from lib directory
app.get('/lib/GLTFLoader.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lib', 'GLTFLoader.js'), {
    headers: {
      'Content-Type': 'application/javascript'
    }
  });
});

// Serve DRACOLoader from lib directory
app.get('/lib/DRACOLoader.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'lib', 'DRACOLoader.js'), {
    headers: {
      'Content-Type': 'application/javascript'
    }
  });
});

// --- SETTINGS, HISTORY, USER API (all routes must be registered after app is initialized) ---

// SETTINGS
app.get('/settings', (req, res) => {
  try {
    const settingsPath = path.join(__dirname, 'data', 'settings.json');
    if (!fs.existsSync(path.join(__dirname, 'data'))) {
      fs.mkdirSync(path.join(__dirname, 'data'));
    }
    if (!fs.existsSync(settingsPath)) {
      const defaultSettings = {
        theme: 'dark',
        layoutPreset: 'default',
        sidebarCollapsed: false,
        fontSize: 'medium'
      };
      fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
      res.json(defaultSettings);
      return;
    }
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    res.json(settings);
  } catch (error) {
    console.error('Error accessing settings:', error);
    res.status(500).json({ error: 'Failed to access settings' });
  }
});
app.post('/settings', (req, res) => {
  try {
    const settingsPath = path.join(__dirname, 'data', 'settings.json');
    if (!fs.existsSync(path.join(__dirname, 'data'))) {
      fs.mkdirSync(path.join(__dirname, 'data'));
    }
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    const updatedSettings = { ...settings, ...req.body };
    fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2));
    res.json(updatedSettings);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});
app.get('/api/settings', (req, res) => {
  req.url = '/settings';
  app._router.handle(req, res);
});
app.post('/api/settings', (req, res) => {
  req.url = '/settings';
  app._router.handle(req, res);
});

// HISTORY
app.get('/history', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const userId = req.session.user._id || req.session.user.id || req.session.user;
    const history = await ChatHistory.find({ userId }).sort({ _id: -1 }).limit(20);
    res.json({ items: history, success: true });
  } catch (error) {
    console.error('Error loading history:', error);
    res.status(500).json({ error: 'Failed to load history' });
  }
});
app.get('/api/history', (req, res) => {
  req.url = '/history';
  app._router.handle(req, res);
});

// USER PROFILE
app.get('/api/user', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    let user;
    if (req.session.user._id) {
      user = await User.findById(req.session.user._id).lean();
    } else if (req.session.user.email) {
      user = await User.findOne({ email: req.session.user.email }).lean();
    } else {
      user = await User.findById(req.session.user).lean();
    }
    if (!user) return res.status(404).json({ error: 'User not found' });
    delete user.password;
    res.json({ user, success: true });
  } catch (error) {
    console.error('Error loading user:', error);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// Mount existing routes
// Mount at both /api/messages and /messages for legacy compatibility
app.use('/api/messages', messagesRouter);
app.use('/messages', messagesRouter);
app.use('/api/tasks', tasksRouter);
app.use('/auth', authRouter);
app.use('/tasks', tasksRouter);

// Set proper MIME types for JavaScript modules
app.use((req, res, next) => {
  // Set proper content type for ES modules
  if (req.path.endsWith('.js')) {
    res.setHeader('Content-Type', 'text/javascript');
  } else if (req.path.endsWith('.mjs')) {
    res.setHeader('Content-Type', 'text/javascript');
  } else if (req.path.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css');
  }
  next();
});

// Serve static files from src directory with appropriate mime types
app.use('/src', express.static(path.join(__dirname, 'src'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'text/javascript');
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

// Serve 3D experience scripts
app.use('/js/3d', express.static(path.join(__dirname, 'src', '3d'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'text/javascript');
    }
  }
}));

// Three.js CDN middleware
app.use((req, res, next) => {
  const threePaths = [
    '/three/examples/jsm',
    '/three/build/three.module.js',
    '/jsm/controls/OrbitControls.js',
    '/jsm/loaders/GLTFLoader.js',
    '/jsm/loaders/DRACOLoader.js'
  ];
  
  if (threePaths.some(path => req.url.includes(path))) {
    return res.redirect(302, `https://cdn.jsdelivr.net/npm/three@0.132.2${req.url}`);
  }
  next();
});

// Add global Three.js CDN mapping
app.use((req, res, next) => {
  // Map bare specifier requests to CDN
  if (req.url.includes('/three/examples/jsm/')) {
    const modulePath = req.url.split('/three/examples/jsm/')[1];
    return res.redirect(`https://cdn.jsdelivr.net/npm/three@0.132.2/examples/jsm/${modulePath}`);
  }
  next();
});

// Add CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Add security headers
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "img-src 'self' data:; " +
    "script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline'"
  );
  next();
});

// --- 10. SPA GUARD (protect SPA shell routes) ---
const guard = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login.html');
  next();
};

// --- 11. HTML ENDPOINTS & FALLBACK ---
const spaPages = ['history', 'guide', 'settings'];
spaPages.forEach(page => {
  app.get(`/${page}.html`, guard, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Support '/login' path by redirecting to login.html
app.get('/login', (req, res) => {
  res.redirect('/login.html');
});

// Redirect root to modern interface
app.get('/', guard, (req, res) => {
  res.redirect('/modern.html');
});

// Support '/modern' path by redirecting to modern.html
app.get('/modern', guard, (req, res) => {
  res.redirect('/modern.html');
});

// --- 12. 404 HANDLER ---
app.use((req, res) => {
  res.status(404).send('Not found');
});

// --- 13. MONGODB CONNECT & SERVER STARTUP ---
mongoose.set('strictQuery', true);

async function startApp() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => {
      console.log(`\n--- OPERATOR Modern Interface Server ---\nServer running at http://localhost:${PORT}\nModern interface available at http://localhost:${PORT}/modern.html\nSPA shell at / (protected)\n`);
    });
  } catch (err) {
    console.error('Failed to start application:', err);
    process.exit(1);
  }
}

startApp();
