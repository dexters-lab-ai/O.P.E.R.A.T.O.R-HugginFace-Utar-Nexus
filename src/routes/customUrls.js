// src/routes/customUrls.js
import express          from 'express';
import User             from '../models/User.js';
import { requireAuth }  from '../middleware/requireAuth.js';

const router = express.Router();

// GET /custom‑urls
router.get('/custom-urls', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user).lean();
    res.json({ success: true, customUrls: user.customUrls });
  } catch (err) {
    console.error('Error fetching custom URLs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /custom‑urls
router.post('/custom-urls', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

  try {
    await User.updateOne({ _id: req.session.user }, { $addToSet: { customUrls: url } });
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving custom URL:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /custom‑urls/:url
router.delete('/custom-urls/:url', requireAuth, async (req, res) => {
  const { url } = req.params;
  try {
    await User.updateOne({ _id: req.session.user }, { $pull: { customUrls: url } });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting custom URL:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
