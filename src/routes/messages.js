// src/routes/messages.js
import express from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

/**
 * GET /messages
 * Fetch recent messages for the logged-in user
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database is not connected');
    }
    const userId = req.session.user;
    const limit = parseInt(req.query.limit, 10) || 100;

    const messages = await Message.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, messages });
  } catch (err) {
    console.error('Messages fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /messages/history
 * Fetch unified message history (chat + commands) for the logged-in user, paginated.
 * Query: ?page=1&limit=30
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database is not connected');
    }
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 30;
    const skip = (page - 1) * limit;
    const userId = req.session.user;

    const totalItems = await Message.countDocuments({ userId });
    const items = await Message.find({ userId })
      .sort({ timestamp: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      success: true,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
      items
    });
  } catch (err) {
    console.error('Unified message history fetch error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch message history' });
  }
});

// Deprecated: Use /nli for sending messages
router.post('/', requireAuth, (req, res) => {
  return res.status(405).json({ success: false, error: 'Use POST /nli for sending messages' });
});

export default router;
