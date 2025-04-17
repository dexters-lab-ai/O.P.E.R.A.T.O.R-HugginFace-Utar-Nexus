// src/routes/tasks.js
import express              from 'express';
import Task                 from '../models/Task.js';
import { requireAuth }      from '../middleware/requireAuth.js';
import { stripLargeFields } from '../utils/stripLargeFields.js';
import winston              from 'winston'; // Added to fix logger undefined

const router = express.Router();

// Logger setup (since you were using logger previously)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [new winston.transports.Console()]
});

/**
 * PUT /tasks/:id/progress
 * Update task progress
 */
router.put('/:id/progress', requireAuth, async (req, res) => {
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
    logger.error('Update progress error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks/active
 * Fetch active tasks for user
 */
router.get('/active', requireAuth, async (req, res) => {
  try {
    const activeTasks = await Task.find({
      userId: req.session.user,
      status: { $in: ['pending', 'processing'] }
    }).lean();
    res.json(activeTasks);
  } catch (err) {
    logger.error('Active tasks error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks/:id/stream
 * Stream task updates via SSE
 */
router.get('/:id/stream', requireAuth, async (req, res) => {
  logger.info(`Task stream started for taskId: ${req.params.id}`);

  // Set headers for Server-Sent Events (SSE)
  res.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive'
  });

  const sendUpdate = async () => {
    try {
      const task = await Task.findById(req.params.id).lean();
      if (!task) {
        res.write(`data: ${JSON.stringify({ done: true, error: 'Task not found' })}\n\n`);
        return res.end();
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
      logger.info(`Task update sent: ${req.params.id}`, update);

      if (update.done) {
        clearInterval(interval);
        res.end();
        logger.info(`Task stream closed (task complete): ${req.params.id}`);
      }
    } catch (err) {
      logger.error('Task stream error:', err);
      res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  };

  await sendUpdate();  // Send initial update immediately
  const interval = setInterval(sendUpdate, 5000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
    logger.info(`Task stream closed (client disconnected): ${req.params.id}`);
  });
});

export default router;
