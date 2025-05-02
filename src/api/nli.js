/* DEPRECATED FILE - we open a SEE stream for a chat when form submits instead, to allow streams */
import { post } from '../utils/api.js';

/**
 * Send a prompt to the NLI endpoint and retrieve both user and assistant messages.
 * @param {string} prompt
 * @returns {Promise<{success: boolean, userMsg: object, aiMsg: object}>}
 */
export async function submitNLI(prompt) {
  // call backend and log raw response
  const res = await post('/nli', { prompt });
  console.debug('[DEBUG] submitNLI raw response:', res);
  if (!res.success) {
    throw new Error(res.error || 'NLI request failed');
  }
  // backend now returns `message` (user message) and `assistantReply` (string)
  const raw = res.message;
  // build user message object for frontend timeline
  const userMsg = {
    id: raw._id,
    userId: raw.userId,
    role: raw.role,
    type: raw.type,
    content: raw.content,
    timestamp: raw.timestamp
  };
  // build assistant message object
  const aiMsg = {
    id: `reply-${Date.now()}`,
    userId: raw.userId,
    role: 'assistant',
    type: raw.type,
    content: res.assistantReply,
    timestamp: new Date().toISOString()
  };
  return { userMsg, aiMsg };
}
