// src/routes/auth.js
import express  from 'express';
import bcrypt   from 'bcrypt';
import User     from '../models/User.js';

const router = express.Router();

// POST /register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    if (await User.exists({ email })) throw new Error('Email already exists');
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed });
    req.session.user = user._id;
    res.json({ success: true, userId: user._id.toString() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password)) {
      throw new Error('Invalid email or password');
    }
    
    console.log('User logged in:', user.email); // Log user email on successful login
    req.session.user = user._id;    
    console.log('Session user ID set:', req.session.user); // Log session user ID
    res.json({ success: true, userId: user._id.toString() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error('Logout error:', err);
    res.redirect('/login.html');
  });
});

export default router;
