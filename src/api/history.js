import { get, del } from '../utils/api-helpers.js';

export const getAllHistory = (params = {}) => get('/history', params);
export const getHistoryById = (id) => get(`/history/${id}`);
export const deleteHistory = (id) => del(`/history/${id}`);
