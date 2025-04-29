// src/api/tasks.js
import { get, post, put, del } from '../utils/api-helpers.js';

// Fetch all active tasks
export async function getActiveTasks() {
  return get('/tasks/active');
}

// Cancel a task by ID
export async function cancelTask(taskId) {
  return del(`/tasks/${taskId}`);
}

// Create a new task
export async function createTask(command, url) {
  return post('/tasks', { command, url });
}

// Update progress on a task
export async function updateTaskProgress(taskId, progress) {
  return put(`/tasks/${taskId}/progress`, { progress });
}
