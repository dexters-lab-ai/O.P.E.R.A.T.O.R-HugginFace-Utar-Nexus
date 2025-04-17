// src/routes/settings.js
import express from 'express';
import bcrypt from 'bcrypt';
import User from '../models/User.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

// GET /settings - Retrieve user's current settings
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user)
      .select('email preferredEngine apiKeys privacyMode')
      .lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    res.json({
      success: true,
      settings: {
        email: user.email,
        preferredEngine: user.preferredEngine || 'gpt-4o-mini',
        apiKeys: user.apiKeys || [],
        privacyMode: user.privacyMode || false,
      },
    });
  } catch (error) {
    console.error('Settings retrieval error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /settings - Update user's settings (LLM, API keys, privacy mode)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { preferredEngine, privacyMode } = req.body;

    const updateData = {};
    if (preferredEngine) updateData.preferredEngine = preferredEngine;
    if (typeof privacyMode === 'boolean') updateData.privacyMode = privacyMode;

    const user = await User.findByIdAndUpdate(
      req.session.user,
      { $set: updateData },
      { new: true, select: 'preferredEngine privacyMode' }
    );

    res.json({ success: true, settings: user });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /settings/api-keys - Add a new API key
router.post('/api-keys', requireAuth, async (req, res) => {
  const { engine, key } = req.body;
  if (!engine || !key) {
    return res.status(400).json({ success: false, error: 'Engine and key required' });
  }
  try {
    await User.updateOne(
      { _id: req.session.user },
      { $push: { apiKeys: { engine, key } } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('API key addition error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /settings/api-keys/:key - Remove an API key
router.delete('/api-keys/:key', requireAuth, async (req, res) => {
  const { key } = req.params;
  try {
    await User.updateOne(
      { _id: req.session.user },
      { $pull: { apiKeys: { key } } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('API key removal error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /settings/password - Change user's password
router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Both passwords required' });
  }

  try {
    const user = await User.findById(req.session.user);
    if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ success: false, error: 'Invalid current password' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
