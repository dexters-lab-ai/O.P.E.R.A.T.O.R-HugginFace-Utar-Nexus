// src/routes/chat.js
import express          from 'express';
import mongoose         from 'mongoose';
import ChatHistory      from '../models/ChatHistory.js';
import { requireAuth }  from '../middleware/requireAuth.js';

const router = express.Router();

/** 
 * GET /chat-history
 */
router.get('/chat-history', requireAuth, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('DB not connected');
    }
    const hist = await ChatHistory.findOne({ userId: req.session.user }).lean();
    res.json({ success: true, messages: (hist?.messages) || [] });
  } catch (err) {
    console.error('Chat history error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch chat history' });
  }
});

export default router;
