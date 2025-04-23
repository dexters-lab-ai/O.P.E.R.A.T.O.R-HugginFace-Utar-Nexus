import { get, del } from '../utils/api-helpers.js';

export const getAllHistory = (page = 1, limit = 20) => get('/history', { page, limit });
export const getHistoryById = (id) => get(`/history/${id}`);
export const deleteHistory = (id) => del(`/history/${id}`);
