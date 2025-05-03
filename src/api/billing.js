/**
 * Billing API functions for the Nexus platform
 * 
 * Handles token balances, purchases, and usage tracking
 */

import { fetchWithAuth } from './fetch-utils.js';

/**
 * Get user's current token balance and usage statistics
 * @returns {Promise<Object>} Token balance and usage data
 */
export async function getUserTokenBalance() {
  try {
    const response = await fetchWithAuth('/api/billing/balance');
    return await response.json();
  } catch (error) {
    console.error('Error fetching token balance:', error);
    throw error;
  }
}

/**
 * Get detailed usage history for the user
 * @param {Object} options - Filter options
 * @param {string} options.timeframe - 'day', 'week', 'month', 'year'
 * @param {number} options.limit - Maximum number of records to return
 * @returns {Promise<Object>} Usage history data
 */
export async function getUsageHistory(options = {}) {
  try {
    const queryParams = new URLSearchParams();
    if (options.timeframe) queryParams.append('timeframe', options.timeframe);
    if (options.limit) queryParams.append('limit', options.limit.toString());
    
    const url = `/api/billing/usage-history?${queryParams.toString()}`;
    const response = await fetchWithAuth(url);
    return await response.json();
  } catch (error) {
    console.error('Error fetching usage history:', error);
    throw error;
  }
}

/**
 * Purchase tokens using the specified payment method
 * @param {Object} purchaseDetails - Details of the token purchase
 * @param {string} purchaseDetails.paymentMethod - 'rator', 'eth', 'usdc', 'btc'
 * @param {number} purchaseDetails.amount - Amount of tokens to purchase
 * @returns {Promise<Object>} Purchase confirmation data
 */
export async function purchaseTokens(purchaseDetails) {
  try {
    const response = await fetchWithAuth('/api/billing/purchase', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(purchaseDetails)
    });
    return await response.json();
  } catch (error) {
    console.error('Error purchasing tokens:', error);
    throw error;
  }
}

/**
 * Get current token pricing information
 * @returns {Promise<Object>} Token pricing data
 */
export async function getTokenPricing() {
  try {
    const response = await fetchWithAuth('/api/billing/pricing');
    return await response.json();
  } catch (error) {
    console.error('Error fetching token pricing:', error);
    throw error;
  }
}

/**
 * Get the cost estimate for a specific operation
 * @param {Object} operationDetails - Details of the operation
 * @param {string} operationDetails.operationType - 'text_generation', 'code_completion', etc.
 * @param {string} operationDetails.model - LLM model to use
 * @param {number} operationDetails.inputTokens - Number of input tokens
 * @param {number} operationDetails.outputTokens - Estimated number of output tokens
 * @returns {Promise<Object>} Cost estimate data
 */
export async function estimateOperationCost(operationDetails) {
  try {
    const response = await fetchWithAuth('/api/billing/estimate-cost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(operationDetails)
    });
    return await response.json();
  } catch (error) {
    console.error('Error estimating operation cost:', error);
    throw error;
  }
}
