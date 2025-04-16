// settings.js
import express from 'express';
import User from './models/User.js';

const router = express.Router();

// GET /settings - Retrieve the user's current settings (API key, preferred engine, etc.)
router.get('/', async (req, res) => {
  try {
    const userId = req.session.user;
    const user = await User.findById(userId).select('email preferredEngine openaiApiKey').lean();
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.json({ success: true, settings: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /settings - Update the user's settings (e.g. OpenAI API key)
router.post('/', async (req, res) => {
  try {
    const userId = req.session.user;
    const { openaiApiKey, preferredEngine } = req.body;
    const updateData = {};
    if (openaiApiKey) updateData.openaiApiKey = openaiApiKey;
    if (preferredEngine) updateData.preferredEngine = preferredEngine;
    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('email preferredEngine openaiApiKey');
    res.json({ success: true, settings: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
