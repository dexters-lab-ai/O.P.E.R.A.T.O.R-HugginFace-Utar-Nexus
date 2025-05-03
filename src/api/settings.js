// src/api/settings.js
import { get, post, del } from '../utils/api-helpers.js';

// Get user settings
/**
 * Gets the user settings from the API
 * @returns {Promise<Object>} The user settings
 */
export async function getSettings() {
  try {
    const response = await fetch('/api/settings', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch settings: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching settings:', error);
    throw error;
  }
}

// Update user settings
/**
 * Saves an API key to the user settings
 * @param {string} provider - The API provider (e.g., 'openai', 'anthropic')
 * @param {string} key - The API key to save
 * @returns {Promise<Object>} Result of the operation
 */
export async function saveApiKey(provider, key) {
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'saveApiKey',
        provider,
        key
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to save API key: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error saving API key:', error);
    throw error;
  }
}

// Delete a specific API key
/**
 * Deletes an API key from the user settings
 * @param {string} provider - The API provider (e.g., 'openai', 'anthropic')
 * @returns {Promise<Object>} Result of the operation
 */
export async function deleteApiKey(provider) {
  try {
    const response = await fetch('/api/settings', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'deleteApiKey',
        provider
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete API key: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error deleting API key:', error);
    throw error;
  }
}

/**
 * Saves LLM model preferences
 * @param {Object} models - Object containing model preferences
 * @returns {Promise<Object>} Result of the operation
 */
export async function saveLlmPreferences(models) {
  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'saveLlmPreferences',
        models
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to save LLM preferences: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error saving LLM preferences:', error);
    throw error;
  }
}

/**
 * Gets the user settings from the API - alias for getSettings to maintain compatibility
 * @returns {Promise<Object>} The user settings
 */
export async function getUserSettings() {
  return getSettings();
}
