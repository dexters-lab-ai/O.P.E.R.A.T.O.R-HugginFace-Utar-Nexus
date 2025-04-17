// src/routes/chat.js
import express from 'express';
import mongoose from 'mongoose';
import ChatHistory from '../models/ChatHistory.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

/** 
 * GET /
 * Fetch chat history for the logged-in user.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database is not connected');
    }

    const history = await ChatHistory.findOne({ userId: req.session.user }).lean();

    res.json({
      success: true,
      messages: history?.messages || []
    });

  } catch (err) {
    console.error('Chat history fetch error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chat history'
    });
  }
});

export default router;
