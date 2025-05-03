/**
 * Event utilities for OPERATOR
 * Provides custom event bus for component communication
 */

import { EventEmitter } from 'https://cdn.skypack.dev/events@3.3.0';

// Simple event bus for in-app events
const listeners = {};
export const eventBus = {
  on(event, cb) {
    (listeners[event] = listeners[event] || []).push(cb);
  },
  once(event, cb) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      cb.apply(this, args);
    };
    this.on(event, wrapper);
  },
  off(event, cb) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(fn => fn !== cb);
  },
  emit(event, payload) {
    (listeners[event] || []).forEach(cb => cb(payload));
  },
  // Listen to all events
  onAny(listener) {
    this._anyListeners = this._anyListeners || [];
    this._anyListeners.push(listener);
    return this;
  },
  // Remove all events listener
  offAny(listener) {
    if (!this._anyListeners) return this;
    if (listener) {
      this._anyListeners = this._anyListeners.filter(l => l !== listener);
    } else {
      this._anyListeners = [];
    }
    return this;
  }
};

// Override the emit method to also call any listeners
const originalEmit = eventBus.emit;
eventBus.emit = function(event, payload) {
  originalEmit.call(this, event, payload);
  
  // Notify any listeners
  if (this._anyListeners && this._anyListeners.length) {
    this._anyListeners.forEach(listener => listener(event, payload));
  }
};

/**
 * DOM-specific utilities for event handling
 */

/**
 * Add event listener with automatic cleanup
 * @param {HTMLElement} element - DOM element
 * @param {string} eventType - Event type (e.g., 'click')
 * @param {Function} handler - Event handler
 * @param {Object} options - Event listener options
 * @returns {Function} Cleanup function
 */
function addEvent(element, eventType, handler, options = {}) {
  if (!element) return () => {};
  
  element.addEventListener(eventType, handler, options);
  
  return () => {
    element.removeEventListener(eventType, handler, options);
  };
}

/**
 * Add multiple event listeners with single cleanup
 * @param {Array} listeners - Array of [element, eventType, handler, options] tuples
 * @returns {Function} Cleanup function for all listeners
 */
function addEvents(listeners = []) {
  const cleanupFns = listeners.map(
    ([element, eventType, handler, options]) => addEvent(element, eventType, handler, options)
  );
  
  return () => {
    cleanupFns.forEach(cleanup => cleanup());
  };
}

/**
 * Create a debounced version of a function
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(fn, delay = 300) {
  let timeoutId;
  
  return function(...args) {
    clearTimeout(timeoutId);
    
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

/**
 * Create a throttled version of a function
 * @param {Function} fn - Function to throttle
 * @param {number} limit - Throttle limit in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(fn, limit = 300) {
  let inThrottle = false;
  
  return function(...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

export { EventEmitter };
export { addEvent, addEvents, debounce, throttle };
