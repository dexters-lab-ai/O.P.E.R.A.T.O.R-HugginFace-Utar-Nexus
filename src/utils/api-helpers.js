const API_BASE = import.meta.env.DEV
  ? '' // Use Vite dev proxy
  : (import.meta.env.VITE_API_BASE || window.location.origin);
console.log('[api-helpers] API_BASE:', API_BASE);
const API_CONFIG = {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  }
};

export async function fetchAPI(url, options = {}) {
  // Ensure API path uses /api prefix for Vite proxy
  const endpoint = url.startsWith('/api') ? url : `/api${url}`;
  const fullUrl = `${API_BASE}${endpoint}`;
  console.log('[api-helpers] fetchAPI called:', fullUrl);
  try {
    const response = await fetch(fullUrl, {
      ...API_CONFIG,
      ...options
    });

    // Handle error responses
    if (response.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error (${response.status}): ${errorText}`);
      try {
        const errorJson = JSON.parse(errorText);
        throw new Error(errorJson.error || `API Error: ${response.status}`);
      } catch (parseError) {
        throw new Error(`API Error: ${response.status} - ${errorText.substring(0, 100)}`);
      }
    }
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

export async function get(url, params = {}) {
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

export async function post(url, data = {}) {
  return fetchAPI(url, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function put(url, data = {}) {
  return fetchAPI(url, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function del(url, data = null) {
  const options = { method: 'DELETE' };
  if (data) {
    options.body = JSON.stringify(data);
  }
  return fetchAPI(url, options);
}
