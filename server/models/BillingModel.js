/**
 * Billing Model for Nexus
 * Handles token balance, transactions, and usage tracking
 */

const db = require('../database');
const logger = require('../logger');

class BillingModel {
  /**
   * Get a user's token balance
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Token balance info
   */
  async getUserBalance(userId) {
    try {
      const query = `
        SELECT 
          token_balance, 
          last_purchase_date,
          total_tokens_purchased,
          total_tokens_used
        FROM user_tokens
        WHERE user_id = ?
      `;
      
      const [rows] = await db.query(query, [userId]);
      
      if (rows.length === 0) {
        // Create a new balance record if one doesn't exist
        await this.initializeUserBalance(userId);
        return {
          tokenBalance: 0,
          lastPurchaseDate: null,
          totalTokensPurchased: 0,
          totalTokensUsed: 0
        };
      }
      
      return {
        tokenBalance: rows[0].token_balance,
        lastPurchaseDate: rows[0].last_purchase_date,
        totalTokensPurchased: rows[0].total_tokens_purchased,
        totalTokensUsed: rows[0].total_tokens_used
      };
    } catch (error) {
      logger.error('Error getting user token balance:', error);
      throw new Error('Failed to get token balance');
    }
  }
  
  /**
   * Initialize a new user's token balance
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async initializeUserBalance(userId) {
    try {
      const query = `
        INSERT INTO user_tokens (
          user_id, 
          token_balance, 
          last_purchase_date,
          total_tokens_purchased,
          total_tokens_used
        ) VALUES (?, 0, NULL, 0, 0)
      `;
      
      await db.query(query, [userId]);
      logger.info(`Initialized token balance for user ${userId}`);
    } catch (error) {
      logger.error('Error initializing user token balance:', error);
      throw new Error('Failed to initialize token balance');
    }
  }
  
  /**
   * Get a user's usage history
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @param {string} options.timeframe - Time period to retrieve (day, week, month, year)
   * @param {number} options.limit - Maximum number of records to retrieve
   * @returns {Promise<Array>} Usage history records
   */
  async getUserUsageHistory(userId, options = {}) {
    try {
      const { timeframe = 'month', limit = 100 } = options;
      
      let timeConstraint = '';
      
      switch (timeframe) {
        case 'day':
          timeConstraint = 'AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 DAY)';
          break;
        case 'week':
          timeConstraint = 'AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)';
          break;
        case 'year':
          timeConstraint = 'AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 YEAR)';
          break;
        case 'month':
        default:
          timeConstraint = 'AND timestamp >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
          break;
      }
      
      const query = `
        SELECT 
          id,
          operation_type,
          model_used,
          input_tokens,
          output_tokens,
          tokens_cost,
          timestamp
        FROM api_usage
        WHERE user_id = ? ${timeConstraint}
        ORDER BY timestamp DESC
        LIMIT ?
      `;
      
      const [rows] = await db.query(query, [userId, limit]);
      
      return rows.map(row => ({
        id: row.id,
        operationType: row.operation_type,
        modelUsed: row.model_used,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        tokensCost: row.tokens_cost,
        timestamp: row.timestamp
      }));
    } catch (error) {
      logger.error('Error getting user usage history:', error);
      throw new Error('Failed to get usage history');
    }
  }
  
  /**
   * Record API usage for billing purposes
   * @param {Object} usageData - Details of the API usage
   * @param {string} usageData.userId - User ID
   * @param {string} usageData.operationType - Type of operation (text_generation, code_completion, etc.)
   * @param {string} usageData.modelUsed - LLM model used
   * @param {number} usageData.inputTokens - Number of input tokens
   * @param {number} usageData.outputTokens - Number of output tokens
   * @param {number} usageData.tokensCost - Cost in tokens
   * @returns {Promise<Object>} The created usage record
   */
  async recordApiUsage(usageData) {
    try {
      const {
        userId,
        operationType,
        modelUsed,
        inputTokens,
        outputTokens,
        tokensCost
      } = usageData;
      
      // Insert usage record
      const insertQuery = `
        INSERT INTO api_usage (
          user_id,
          operation_type,
          model_used,
          input_tokens,
          output_tokens,
          tokens_cost,
          timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, NOW())
      `;
      
      const [result] = await db.query(insertQuery, [
        userId,
        operationType,
        modelUsed,
        inputTokens,
        outputTokens,
        tokensCost
      ]);
      
      // Update user's token balance
      const updateBalanceQuery = `
        UPDATE user_tokens
        SET 
          token_balance = token_balance - ?,
          total_tokens_used = total_tokens_used + ?
        WHERE user_id = ?
      `;
      
      await db.query(updateBalanceQuery, [tokensCost, tokensCost, userId]);
      
      return {
        id: result.insertId,
        ...usageData,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error recording API usage:', error);
      throw new Error('Failed to record API usage');
    }
  }
  
  /**
   * Record a token purchase
   * @param {Object} purchaseData - Details of the purchase
   * @param {string} purchaseData.userId - User ID
   * @param {string} purchaseData.paymentMethod - Payment method used (rator, eth, usdc, btc)
   * @param {number} purchaseData.tokenAmount - Number of tokens purchased
   * @param {number} purchaseData.amountPaid - Amount paid in the source currency
   * @param {string} purchaseData.currency - Currency used for payment
   * @param {string} purchaseData.transactionId - External transaction ID
   * @returns {Promise<Object>} The created purchase record
   */
  async recordTokenPurchase(purchaseData) {
    try {
      const {
        userId,
        paymentMethod,
        tokenAmount,
        amountPaid,
        currency,
        transactionId
      } = purchaseData;
      
      // Insert purchase record
      const insertQuery = `
        INSERT INTO token_purchases (
          user_id,
          payment_method,
          token_amount,
          amount_paid,
          currency,
          transaction_id,
          purchase_date
        ) VALUES (?, ?, ?, ?, ?, ?, NOW())
      `;
      
      const [result] = await db.query(insertQuery, [
        userId,
        paymentMethod,
        tokenAmount,
        amountPaid,
        currency,
        transactionId
      ]);
      
      // Update user's token balance
      const updateBalanceQuery = `
        UPDATE user_tokens
        SET 
          token_balance = token_balance + ?,
          last_purchase_date = NOW(),
          total_tokens_purchased = total_tokens_purchased + ?
        WHERE user_id = ?
      `;
      
      await db.query(updateBalanceQuery, [tokenAmount, tokenAmount, userId]);
      
      return {
        id: result.insertId,
        ...purchaseData,
        purchaseDate: new Date()
      };
    } catch (error) {
      logger.error('Error recording token purchase:', error);
      throw new Error('Failed to record token purchase');
    }
  }
  
  /**
   * Get token pricing information
   * @returns {Promise<Object>} Current token pricing
   */
  async getTokenPricing() {
    try {
      const query = `
        SELECT 
          model_name,
          input_token_price,
          output_token_price
        FROM model_pricing
        WHERE active = 1
      `;
      
      const [rows] = await db.query(query);
      
      const modelPricing = {};
      rows.forEach(row => {
        modelPricing[row.model_name] = {
          inputTokenPrice: row.input_token_price,
          outputTokenPrice: row.output_token_price
        };
      });
      
      // Get token exchange rates
      const ratesQuery = `
        SELECT 
          currency,
          exchange_rate
        FROM token_exchange_rates
        WHERE active = 1
      `;
      
      const [ratesRows] = await db.query(ratesQuery);
      
      const exchangeRates = {};
      ratesRows.forEach(row => {
        exchangeRates[row.currency] = row.exchange_rate;
      });
      
      return {
        modelPricing,
        exchangeRates,
        ratorDiscount: 0.5 // 50% discount when using RATOR tokens
      };
    } catch (error) {
      logger.error('Error getting token pricing:', error);
      throw new Error('Failed to get token pricing');
    }
  }
  
  /**
   * Get the user's recent transactions
   * @param {string} userId - User ID
   * @param {number} limit - Maximum number of transactions to retrieve
   * @returns {Promise<Array>} Recent transactions
   */
  async getUserTransactions(userId, limit = 10) {
    try {
      const query = `
        (SELECT 
          'purchase' as type,
          p.id,
          p.token_amount as amount,
          p.payment_method,
          p.purchase_date as timestamp
        FROM token_purchases p
        WHERE p.user_id = ?)
        
        UNION ALL
        
        (SELECT 
          'usage' as type,
          u.id,
          u.tokens_cost as amount,
          u.operation_type as payment_method,
          u.timestamp
        FROM api_usage u
        WHERE u.user_id = ?)
        
        ORDER BY timestamp DESC
        LIMIT ?
      `;
      
      const [rows] = await db.query(query, [userId, userId, limit]);
      
      return rows.map(row => ({
        type: row.type,
        id: row.id,
        amount: row.amount,
        method: row.payment_method,
        timestamp: row.timestamp
      }));
    } catch (error) {
      logger.error('Error getting user transactions:', error);
      throw new Error('Failed to get user transactions');
    }
  }
}

module.exports = new BillingModel();
