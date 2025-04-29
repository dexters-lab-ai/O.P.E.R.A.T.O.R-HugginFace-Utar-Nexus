import Button from './base/Button.jsx';
import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';

// Nav item helper
function createNavItem(item, nav) {
  const navItem = document.createElement('div');
  navItem.className = 'sidebar-nav-item';
  const btn = Button({
    text: item.text,
    icon: item.icon,
    variant: Button.VARIANTS.TEXT,
    className: 'sidebar-nav-btn',
    onClick: () => {
      if (item.onClick) item.onClick();
      else if (item.action) eventBus.emit(item.action, item);
    }
  });
  navItem.appendChild(btn);
  nav.appendChild(navItem);
}

export default function Sidebar(props = {}) {
  const {
    width = '300px',
    minWidth = '80px',
    collapsed = false,
    containerId = 'sidebar',
    items = []
  } = props;
  let isCollapsed = (typeof localStorage !== 'undefined' && localStorage.getItem('sidebarDefault'))
    ? localStorage.getItem('sidebarDefault') === 'collapsed'
    : collapsed;

  // Default active section for tabs
  let activeSection = 'liveMaps';

  // Create container
  const container = document.createElement('div');
  container.className = `sidebar${isCollapsed ? ' collapsed' : ''}`;
  container.style.width = isCollapsed ? minWidth : width;
  if (containerId) container.id = containerId;

  // Refactor header: toggle only remains in header
  const header = document.createElement('div');
  header.className = 'sidebar-header';
  const toggleButton = Button({
    icon: isCollapsed ? 'fa-chevron-left' : 'fa-chevron-right',
    variant: Button.VARIANTS.ICON_ONLY,
    className: 'sidebar-toggle',
    onClick: toggleCollapse
  });
  header.appendChild(toggleButton);
  container.appendChild(header);

  // Header content: tabs implementation
  const headerContent = document.createElement('div');
  headerContent.className = 'sidebar-header-content';
  const tabs = { liveMaps: 'Live Maps', myMaps: 'My Maps' };
  const sectionMenu = document.createElement('div');
  sectionMenu.className = 'sidebar-header-menu';
  const tabButtons = {};
  Object.entries(tabs).forEach(([key, label]) => {
    const btn = Button({
      text: label,
      icon: key === 'liveMaps' ? 'fa-globe' : 'fa-map',
      variant: Button.VARIANTS.TEXT,
      className: 'sidebar-menu-btn' + (key === activeSection ? ' active' : ''),
      onClick: () => setSection(key)
    });
    sectionMenu.appendChild(btn);
    tabButtons[key] = btn;
  });
  headerContent.appendChild(sectionMenu);

  // Dynamic content area
  const content = document.createElement('div');
  content.className = 'sidebar-content';

  // Footer nav area (move original nav items here)
  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';
  footer.style.position = 'absolute';
  footer.style.bottom = '0';
  footer.style.width = '100%';
  footer.style.height = 'var(--footer-height, 48px)';
  footer.style.background = 'rgba(30, 34, 44, 0.7)';
  footer.style.backdropFilter = 'blur(10px)';
  footer.style.borderTop = '1px solid rgba(255,255,255,0.08)';
  footer.style.zIndex = '2';
  const footerNav = document.createElement('nav');
  footerNav.className = 'sidebar-nav';
  // Only include Documentation and Extensions in footer
  items.filter(item => ['Documentation','Extensions'].includes(item.text))
       .forEach(item => createNavItem(item, footerNav));
  footer.appendChild(footerNav);

  // Wrapper for headerContent, content, and footer
  const wrapper = document.createElement('div');
  wrapper.className = `sidebar-wrapper${isCollapsed ? ' collapsed' : ''}`;
  wrapper.appendChild(headerContent);
  wrapper.appendChild(content);

  // Intermediate Results Container
  const intermediateContainer = document.createElement('div');
  intermediateContainer.id = 'intermediate-results-container';
  intermediateContainer.className = 'intermediate-results';
  intermediateContainer.innerHTML = '<h4>Intermediate Results</h4>';
  wrapper.appendChild(intermediateContainer);

  wrapper.appendChild(footer);
  container.appendChild(wrapper);

  // Section change handler
  function setSection(section) {
    if (section === activeSection) return;
    activeSection = section;
    Object.entries(tabButtons).forEach(([k, btn]) => {
      btn.classList.toggle('active', k === section);
    });
    content.classList.add('loading');
    setTimeout(() => {
      content.innerHTML = `<p>Dummy content for ${tabs[section]}</p>`;
      content.classList.remove('loading');
    }, 200);
  }
  // Initialize default section
  setSection(activeSection);

  // Toggle collapse behavior
  function toggleCollapse() {
    isCollapsed = !isCollapsed;
    container.classList.toggle('collapsed', isCollapsed);
    wrapper.classList.toggle('collapsed', isCollapsed);
    content.classList.toggle('collapsed', isCollapsed);
    const iconEl = toggleButton.querySelector('i');
    if (iconEl) iconEl.className = `fas ${isCollapsed ? 'fa-chevron-left' : 'fa-chevron-right'}`;
    stores.ui.setState({ taskResultsCollapsed: isCollapsed });
    eventBus.emit('sidebar-toggled', { collapsed: isCollapsed });
  }

  return container;
}