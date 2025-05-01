/**
 * API utilities for OPERATOR
 * Provides consistent interface for all API interactions
 */

/**
 * Configuration for API requests
 */
const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_BASE || window.location.origin);
const API_CONFIG = {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  }
};

/**
 * General fetch wrapper with error handling
 * @param {string} url - The API endpoint to call
 * @param {Object} options - Fetch options to include
 * @returns {Promise<any>} - Response data
 */
export async function fetchAPI(url, options = {}) {
  try {
    // Build full URL using proxy in dev and proper prefix
    const endpoint = url.startsWith('/api') ? url : `/api${url}`;
    const fullUrl = `${API_BASE}${endpoint}`;
    const response = await fetch(fullUrl, {
      ...API_CONFIG,
      ...options
    });

    // Handle error responses
    if (response.status === 401) {
      // Redirect to login page if not authenticated
      window.location.href = '/login.html';
      return;
    }
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error (${response.status}): ${errorText}`);
      // Try to parse as JSON if possible
      try {
        const errorJson = JSON.parse(errorText);
        throw new Error(errorJson.error || `API Error: ${response.status}`);
      } catch (parseError) {
        throw new Error(`API Error: ${response.status} - ${errorText.substring(0, 100)}`);
      }
    }

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }
    
    return response.text();
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}

/**
 * GET request helper
 * @param {string} url - The API endpoint
 * @param {Object} params - Query parameters to include
 * @returns {Promise<any>} - Response data
 */
export async function get(url, params = {}) {
  // Add query parameters if present
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, value);
    }
  });
  
  const queryString = queryParams.toString();
  const fullUrl = queryString ? `${url}?${queryString}` : url;
  
  return fetchAPI(fullUrl, { method: 'GET' });
}

/**
 * POST request helper
 * @param {string} url - The API endpoint
 * @param {Object} data - Data to send in request body
 * @returns {Promise<any>} - Response data
 */
export async function post(url, data = {}) {
  return fetchAPI(url, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

/**
 * PUT request helper
 * @param {string} url - The API endpoint
 * @param {Object} data - Data to send in request body
 * @returns {Promise<any>} - Response data
 */
export async function put(url, data = {}) {
  return fetchAPI(url, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

/**
 * DELETE request helper
 * @param {string} url - The API endpoint
 * @param {Object} data - Optional data to send in request body
 * @returns {Promise<any>} - Response data
 */
export async function del(url, data = null) {
  const options = { method: 'DELETE' };
  
  if (data) {
    options.body = JSON.stringify(data);
  }
  
  return fetchAPI(url, options);
}

/**
 * Delete the user's own account
 * @returns {Promise<any>} - Response data
 */
export async function deleteAccount() {
  return del('/api/auth/account');
}

/**
 * API service object with endpoint-specific methods
 */
export const api = {
  messages: {
    getHistory: (page = 1, limit = 50) => get('/messages/history', { page, limit }),
    send: (data = {}) => {
      const prompt = typeof data === 'string' ? data : data.content;
      return post('/nli', { prompt });
    }
  },
  tasks: {
    getActive: () => get('/tasks/active'),
    create: (command, url) => post('/tasks', { command, url }),
    cancel: (taskId) => post(`/tasks/${taskId}/cancel`)
  },
  history: {
    getAll: (page = 1, limit = 20) => get('/history', { page, limit }),
    getById: (id) => get(`/history/${id}`),
    delete: (id) => del(`/history/${id}`)
  },
  auth: {
    login: (email, password) => post('/api/auth/login', { email, password }),
    register: (email, password) => post('/api/auth/register', { email, password }),
    logout: () => get('/api/auth/logout'),
    deleteAccount: () => del('/api/auth/account')
  }
};

export default api;
