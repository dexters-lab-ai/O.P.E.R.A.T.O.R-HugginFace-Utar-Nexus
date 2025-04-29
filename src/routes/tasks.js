import express from 'express';
import Task from '../models/Task.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { stripLargeFields } from '../utils/stripLargeFields.js';
import winston from 'winston';

const router = express.Router();

// Logger setup
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
    return res.json({ success: true });
  } catch (err) {
    logger.error('Update progress error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks/active
 * Fetch active tasks for authenticated user
 */
router.get('/active', requireAuth, async (req, res) => {
  try {
    const activeTasks = await Task.find({
      userId: req.session.user,
      status: { $in: ['pending', 'processing'] }
    }).lean();
    return res.json({ tasks: activeTasks });
  } catch (err) {
    logger.error('Active tasks error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks/:id/stream
 * Stream task updates via Server-Sent Events (SSE)
 */
router.get('/:id/stream', requireAuth, (req, res) => {
  logger.info(`Task stream started for taskId: ${req.params.id}`);

  // Set headers for SSE
  res.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive'
  });

  // Helper to send updates
  const sendUpdate = async () => {
    try {
      const task = await Task.findById(req.params.id).lean();
      if (!task) {
        res.write(`data: ${JSON.stringify({ done: true, error: 'Task not found' })}\n\n`);
        clearInterval(interval);
        return res.end();
      }

      const update = stripLargeFields({
        status: task.status || 'unknown',
        progress: task.progress || 0,
        intermediateResults: task.intermediateResults || [],
        steps: task.steps || [],
        error: task.error || null,
        result: task.result || null,
        done: ['completed', 'error'].includes(task.status)
      });

      res.write(`data: ${JSON.stringify(update)}\n\n`);
      logger.debug(`Task update sent for ${req.params.id}`, update);

      if (update.done) {
        clearInterval(interval);
        res.end();
        logger.info(`Task stream closed (completed): ${req.params.id}`);
      }
    } catch (err) {
      logger.error('Task stream error:', err);
      res.write(`data: ${JSON.stringify({ done: true, error: err.message })}\n\n`);
      clearInterval(interval);
      res.end();
    }
  };

  // Send initial update and then at intervals
  sendUpdate();
  const interval = setInterval(sendUpdate, 5000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
    res.end();
    logger.info(`Task stream closed (client disconnected): ${req.params.id}`);
  });
});

/**
 * DELETE /tasks/:id
 * Cancel or remove a task
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { deletedCount } = await Task.deleteOne({ _id: req.params.id, userId: req.session.user });
    if (!deletedCount) return res.status(404).json({ success: false, error: 'Task not found' });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Delete task error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /tasks/:id/cancel
 * Cancel a running task
 */
router.put('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { 
        _id: req.params.id, 
        userId: req.session.user,
        status: { $in: ['pending', 'processing'] }
      },
      { 
        $set: { 
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: req.body.reason || 'User requested cancellation',
          progress: 0,
          endTime: new Date()
        }
      },
      { new: true }
    );

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found or not cancellable' });
    }

    // Trigger cleanup if browser session exists
    if (task.browserSessionId) {
      await cleanupBrowserSession(task.browserSessionId);
    }

    return res.json({ 
      success: true,
      taskId: task._id,
      status: 'cancelled'
    });
  } catch (err) {
    logger.error('Task cancellation error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

async function cleanupBrowserSession(sessionId) {
  try {
    // Implementation would depend on your browser session management
    // This is a placeholder for actual cleanup logic
    console.log(`Cleaning up browser session ${sessionId}`);
    return true;
  } catch (err) {
    console.error('Cleanup failed:', err);
    return false;
  }
}

/**
 * POST /tasks
 * Create a new task for the authenticated user
 */
router.post('/', requireAuth, async (req, res) => {
  const { command, url } = req.body;
  if (!command) return res.status(400).json({ success: false, error: 'Task command is required' });
  try {
    const task = new Task({
      userId: req.session.user,
      command,
      url,
      status: 'pending',
      progress: 0,
      startTime: new Date()
    });
    await task.save();
    logger.info('New task created', { taskId: task._id, userId: req.session.user });
    return res.json({ success: true, taskId: task._id });
  } catch (err) {
    logger.error('Create task error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;