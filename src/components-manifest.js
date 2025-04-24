export const components = [
  './components/base/Alert.jsx',
  './components/base/Button.jsx',
  './components/base/Card.jsx',
  './components/base/Dropdown.jsx',
  './components/base/ErrorBoundary.jsx',
  './components/base/Modal.jsx',
  './components/base/ProgressBar.jsx',
  './components/base/Tabs.jsx',
  './components/base/Tooltip.jsx',
  './components/LayoutManager.jsx'
].map(p => require('path').resolve(__dirname, p));
