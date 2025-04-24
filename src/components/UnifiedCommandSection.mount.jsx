// UnifiedCommandSection.mount.js
// Helper to mount the React UnifiedCommandSection into a vanilla JS app
import React from 'react';
import { createRoot } from 'react-dom/client';
import UnifiedCommandSection from './UnifiedCommandSection';

export function mountUnifiedCommandSection(parent) {
  // Create a container div for React
  const reactRoot = document.createElement('div');
  reactRoot.className = 'unified-command-section-mount';
  parent.appendChild(reactRoot);
  const root = createRoot(reactRoot);
  root.render(<UnifiedCommandSection />);
  // Return a destroy method for cleanup
  return () => {
    root.unmount();
    if (reactRoot.parentElement) reactRoot.parentElement.removeChild(reactRoot);
  };
}
