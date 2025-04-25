// Simple proxy for src/utils/api.js for old.html compatibility
import('/src/utils/api.js').then(mod => {
  window.fetchAPI = mod.fetchAPI;
});
