export function debugLog(message, data = null) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEBUG] ${message}`, data);
    
    // Also send to WebSocket for remote debugging
    try {
      const eventBus = window.__eventBus;
      if (eventBus) {
        eventBus.emit('debugLog', {
          message,
          data,
          timestamp: new Date().toISOString()
        });
      }
    } catch (e) {
      console.error('Debug log failed:', e);
    }
  }
}
