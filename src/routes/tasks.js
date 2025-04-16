// src/routes/tasks.js
import express              from 'express';
import Task                 from '../models/Task.js';   
import { requireAuth }      from '../middleware/requireAuth.js';
import { stripLargeFields } from '../utils/stripLargeFields.js'; 

const router = express.Router();

/**
 * PUT /tasks/:id/progress
 */
router.put('/tasks/:id/progress', requireAuth, async (req, res) => {
  const { progress } = req.body;
  try {
    const { modifiedCount } = await Task.updateOne(
      { _id: req.params.id, userId: req.session.user },
      { $set: { progress } }
    );
    if (!modifiedCount) {
      return res.status(404).json({ success: false, error: 'Task not found or not updated' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Update progress error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks/active
 */
router.get('/tasks/active', requireAuth, async (req, res) => {
  try {
    const act = await Task.find({
      userId: req.session.user,
      status: { $in: ['pending','processing'] }
    }).lean();
    res.json(act);
  } catch (err) {
    console.error('Active tasks error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks/:id/stream
 */
router.get('/tasks/:id/stream', requireAuth, async (req, res) => {
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

export default router;
