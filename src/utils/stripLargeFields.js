// src/utils/stripLargeFields.js
import path from 'path';

/**
 * Utility to limit a string’s length and add a note if trimmed.
 */
export function trimString(str, maxLen = 200) {
  if (typeof str !== 'string') return str;
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + `... [trimmed, original length: ${str.length}]`;
}

/**
 * Shallowly removes or truncates large fields in an “update” object
 * before sending over SSE / WebSocket / HTTP.
 */
export function stripLargeFields(originalUpdate) {
  const newUpdate = { ...originalUpdate };

  // 1) result
  if (newUpdate.result && typeof newUpdate.result === 'object') {
    if (newUpdate.result.screenshot) {
      newUpdate.result.screenshot = '[Screenshot omitted – use screenshotPath]';
    }
    if (typeof newUpdate.result.extractedInfo === 'string') {
      newUpdate.result.extractedInfo = trimString(newUpdate.result.extractedInfo, 300);
    }
    if (typeof newUpdate.result.rawResponse === 'string') {
      newUpdate.result.rawResponse = trimString(newUpdate.result.rawResponse, 300);
    }
    if (newUpdate.result.pageContext && typeof newUpdate.result.pageContext === 'object') {
      newUpdate.result.pageContext = '[pageContext too large]';
    }
    if (newUpdate.result.tree && typeof newUpdate.result.tree === 'object') {
      newUpdate.result.tree = '[DOM tree too large]';
    }
  }

  // 2) intermediateResults
  if (Array.isArray(newUpdate.intermediateResults)) {
    newUpdate.intermediateResults = newUpdate.intermediateResults.map(item => {
      const copy = { ...item };
      if (copy.screenshot) {
        copy.screenshot = '[Screenshot omitted – use screenshotPath]';
      }
      if (typeof copy.extractedInfo === 'string') {
        copy.extractedInfo = trimString(copy.extractedInfo, 300);
      }
      if (copy.pageContext && typeof copy.pageContext === 'object') {
        copy.pageContext = '[pageContext too large]';
      }
      return copy;
    });
  }

  // 3) steps
  if (Array.isArray(newUpdate.steps)) {
    newUpdate.steps = newUpdate.steps.map(step => {
      const s = { ...step };
      if (s.screenshot) {
        s.screenshot = '[Screenshot omitted – use screenshotPath]';
      }
      if (typeof s.extractedInfo === 'string') {
        s.extractedInfo = trimString(s.extractedInfo, 300);
      }
      if (s.pageContext && typeof s.pageContext === 'object') {
        s.pageContext = '[pageContext too large]';
      }
      return s;
    });
  }

  return newUpdate;
}
