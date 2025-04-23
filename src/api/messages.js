import { get } from '../utils/api-helpers.js';

export const getMessageHistory = (page = 1, limit = 50) => get('/messages/history', { page, limit });
