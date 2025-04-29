import { post } from '../utils/api.js';

/**
 * Send a prompt to the NLI endpoint.
 * @param {string} prompt - The user input to process.
 * @returns {Promise<any>} - The server response.
 */
export const submitNLI = (prompt) => post('/nli', { prompt });
