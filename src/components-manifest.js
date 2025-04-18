export const components = [
  './components/base/Alert.js',
  './components/base/Button.js',
  './components/base/Card.js',
  './components/base/Dropdown.js',
  './components/base/ErrorBoundary.js',
  './components/base/Modal.js',
  './components/base/ProgressBar.js',
  './components/base/Tabs.js',
  './components/base/Tooltip.js',
  './components/LayoutManager.js'
].map(p => require('path').resolve(__dirname, p));
