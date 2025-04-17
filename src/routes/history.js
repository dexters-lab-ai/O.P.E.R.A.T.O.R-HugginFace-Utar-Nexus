// src/routes/history.js
import express         from 'express';
import Task            from '../models/Task.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

/**
 * GET /history
 * Fetch paginated history of completed tasks
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const page  = Number(req.query.page)  || 1;
    const limit = Number(req.query.limit) || 20;
    const skip  = (page - 1) * limit;
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
        result: task.result || {}
      }))
    });
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * GET /history/:id
 * Fetch specific task details
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      userId: req.session.user
    }).lean();

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({
      _id: task._id,
      url: task.url || 'Unknown URL',
      command: task.command,
      timestamp: task.endTime,
      status: task.status,
      error: task.error,
      subTasks: task.subTasks,
      intermediateResults: task.intermediateResults || [],
      result: task.result || {}
    });
  } catch (err) {
    console.error('History item error:', err);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

/**
 * DELETE /history/:id
 * Delete a specific task from history
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { deletedCount } = await Task.deleteOne({
      _id: req.params.id,
      userId: req.session.user
    });

    if (!deletedCount) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete history item error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /history
 * Delete all completed tasks from user's history
 */
router.delete('/', requireAuth, async (req, res) => {
  try {
    await Task.deleteMany({
      userId: req.session.user,
      status: 'completed'
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Clear history error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
