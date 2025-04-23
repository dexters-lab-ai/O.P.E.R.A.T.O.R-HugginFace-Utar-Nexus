// src/api/settings.js
import { get, post } from '../utils/api-helpers.js';

export async function getSettings() {
  return get('/settings');
}

export async function saveSettings(data) {
  return post('/settings', data);
}
