// src/api/tasks.js
import { get, post, del } from '../utils/api-helpers.js';

// Fetch all active tasks
export async function getActiveTasks() {
  return get('/tasks/active');
}

// Cancel a task by ID
export async function cancelTask(taskId) {
  return del(`/tasks/${taskId}`);
}
