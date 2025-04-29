/**
 * PreferencesModal Component
 * Provides a modal interface for configuring application preferences
 */

import { eventBus } from '../utils/events.js';
import { stores } from '../store/index.js';
import Button from './base/Button.jsx';
import { getSettings, saveSettings } from '../api/settings.js';

// Helper: Save to localStorage and store
function persistSettings(settings) {
  localStorage.setItem('userPreferences', JSON.stringify(settings));
  stores.ui.setState({ preferences: settings });
}

function loadPersistedSettings() {
  let fromStorage = localStorage.getItem('userPreferences');
  if (fromStorage) return JSON.parse(fromStorage);
  let fromStore = stores.ui.getState().preferences;
  if (fromStore) return fromStore;
  return null;
}

export function PreferencesModal(props = {}) {
  const containerId = props.containerId || 'preferences-modal';
  let isVisible = false;
  let currentTab = 'profile';
  let settings = loadPersistedSettings() || {
    profile: { username: '', email: '' },
    llm: { engine: 'gpt-4' },
    notifications: { enabled: true },
    apps: { telegram: false, whatsapp: false },
    interface: {
      sidebarDefault: localStorage.getItem('sidebarDefault') || 'open',
      theme: 'dark',
      fontSize: 'medium',
      compactMode: false,
      showTimestamps: true
    },
    accessibility: {
      highContrast: false,
      largeText: false,
      screenReader: false,
      focusOutlines: true
    }
  };

  // Modal container
  const container = document.createElement('div');
  container.className = 'preferences-modal glassmorphic';
  container.id = containerId;

  // Modal dialog
  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog glassy-modal animated-modal';

  // Modal header
  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h2');
  title.innerHTML = '<i class="fas fa-sliders-h"></i> Preferences';
  header.appendChild(title);
  const closeButton = Button({ icon: 'fa-times', variant: Button.VARIANTS.TEXT, onClick: () => hide() });
  header.appendChild(closeButton);
  dialog.appendChild(header);

  // Modal tabs
  const tabs = [
    { id: 'profile', label: 'Profile', icon: 'fa-user' },
    { id: 'llm', label: 'LLM Engine', icon: 'fa-brain' },
    { id: 'notifications', label: 'Notifications', icon: 'fa-bell' },
    { id: 'apps', label: 'Apps', icon: 'fa-plug' },
    { id: 'interface', label: 'Interface', icon: 'fa-desktop' },
    { id: 'accessibility', label: 'Accessibility', icon: 'fa-universal-access' }
  ];
  const tabBar = document.createElement('div');
  tabBar.className = 'preferences-tabs';
  tabs.forEach(tab => {
    const btn = Button({
      text: tab.label,
      icon: tab.icon,
      variant: tab.id === currentTab ? Button.VARIANTS.PRIMARY : Button.VARIANTS.SECONDARY,
      className: tab.id === currentTab ? 'active' : '',
      onClick: () => { currentTab = tab.id; renderTabContent(); updateTabBar(); }
    });
    tabBar.appendChild(btn);
  });
  dialog.appendChild(tabBar);

  // Modal content
  const content = document.createElement('div');
  content.className = 'preferences-content';
  dialog.appendChild(content);

  // Modal footer
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const saveBtn = Button({ text: 'Save', icon: 'fa-save', variant: Button.VARIANTS.PRIMARY, onClick: saveAll });
  const resetBtn = Button({ text: 'Reset', icon: 'fa-undo', variant: Button.VARIANTS.SECONDARY, onClick: resetAll });
  const closeBtn = Button({ text: 'Close', icon: 'fa-times', variant: Button.VARIANTS.TEXT, onClick: hide });
  footer.appendChild(saveBtn);
  footer.appendChild(resetBtn);
  footer.appendChild(closeBtn);
  dialog.appendChild(footer);
  container.appendChild(dialog);

  // Tab content render
  function renderTabContent() {
    content.innerHTML = '';
    if (currentTab === 'profile') {
      // Profile Section
      const username = document.createElement('input');
      username.type = 'text';
      username.value = settings.profile.username;
      username.placeholder = 'Username';
      username.oninput = e => { settings.profile.username = e.target.value; persistSettings(settings); };
      const email = document.createElement('input');
      email.type = 'email';
      email.value = settings.profile.email;
      email.placeholder = 'Email';
      email.oninput = e => { settings.profile.email = e.target.value; persistSettings(settings); };
      content.appendChild(username);
      content.appendChild(email);
      // Password change (optional)
      const pw = document.createElement('input');
      pw.type = 'password';
      pw.placeholder = 'New Password';
      content.appendChild(pw);
      // Could add save logic for password separately
    } else if (currentTab === 'llm') {
      // LLM Engine
      const engines = ['gpt-4', 'gpt-3.5', 'claude', 'llama2'];
      const select = document.createElement('select');
      engines.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e; opt.textContent = e.toUpperCase();
        if (settings.llm.engine === e) opt.selected = true;
        select.appendChild(opt);
      });
      select.onchange = ev => { settings.llm.engine = ev.target.value; persistSettings(settings); };
      content.appendChild(select);
    } else if (currentTab === 'notifications') {
      // Notifications
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = settings.notifications.enabled;
      toggle.onchange = e => { settings.notifications.enabled = e.target.checked; persistSettings(settings); };
      content.appendChild(toggle);
      content.appendChild(document.createTextNode(' Enable notifications'));
    } else if (currentTab === 'apps') {
      // Connected Apps
      ['telegram', 'whatsapp'].forEach(app => {
        const btn = Button({
          text: settings.apps[app] ? `Disconnect ${app}` : `Connect ${app}`,
          icon: app === 'telegram' ? 'fa-telegram' : 'fa-whatsapp',
          variant: settings.apps[app] ? Button.VARIANTS.DANGER : Button.VARIANTS.PRIMARY,
          onClick: () => { settings.apps[app] = !settings.apps[app]; persistSettings(settings); renderTabContent(); }
        });
        content.appendChild(btn);
      });
    } else if (currentTab === 'interface') {
      // Interface
      // Sidebar default
      const sidebarLabel = document.createElement('label');
      sidebarLabel.textContent = 'Sidebar default:';
      const openRadio = document.createElement('input');
      openRadio.type = 'radio';
      openRadio.name = 'sidebarDefault';
      openRadio.value = 'open';
      openRadio.checked = settings.interface.sidebarDefault === 'open';
      openRadio.onchange = () => { settings.interface.sidebarDefault = 'open'; localStorage.setItem('sidebarDefault', 'open'); persistSettings(settings); eventBus.emit('sidebar-toggled', { collapsed: false }); };
      const collapsedRadio = document.createElement('input');
      collapsedRadio.type = 'radio';
      collapsedRadio.name = 'sidebarDefault';
      collapsedRadio.value = 'collapsed';
      collapsedRadio.checked = settings.interface.sidebarDefault === 'collapsed';
      collapsedRadio.onchange = () => { settings.interface.sidebarDefault = 'collapsed'; localStorage.setItem('sidebarDefault', 'collapsed'); persistSettings(settings); eventBus.emit('sidebar-toggled', { collapsed: true }); };
      sidebarLabel.appendChild(openRadio);
      sidebarLabel.appendChild(document.createTextNode('Open '));
      sidebarLabel.appendChild(collapsedRadio);
      sidebarLabel.appendChild(document.createTextNode('Collapsed'));
      content.appendChild(sidebarLabel);
      // Theme
      const themeLabel = document.createElement('label');
      themeLabel.textContent = 'Theme:';
      const themeSelect = document.createElement('select');
      ['dark', 'light'].forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
        if (settings.interface.theme === t) opt.selected = true;
        themeSelect.appendChild(opt);
      });
      themeSelect.onchange = e => { settings.interface.theme = e.target.value; document.documentElement.setAttribute('data-theme', e.target.value); persistSettings(settings); };
      themeLabel.appendChild(themeSelect);
      content.appendChild(themeLabel);
      // Font size
      const fontSizeLabel = document.createElement('label');
      fontSizeLabel.textContent = 'Font size:';
      const fontSizeSelect = document.createElement('select');
      ['small', 'medium', 'large'].forEach(f => {
        const opt = document.createElement('option');
        opt.value = f; opt.textContent = f.charAt(0).toUpperCase() + f.slice(1);
        if (settings.interface.fontSize === f) opt.selected = true;
        fontSizeSelect.appendChild(opt);
      });
      fontSizeSelect.onchange = e => { settings.interface.fontSize = e.target.value; document.body.style.fontSize = (e.target.value === 'medium' ? '' : (e.target.value === 'small' ? '13px' : '18px')); persistSettings(settings); };
      fontSizeLabel.appendChild(fontSizeSelect);
      content.appendChild(fontSizeLabel);
      // Compact mode
      const compactToggle = document.createElement('input');
      compactToggle.type = 'checkbox';
      compactToggle.checked = settings.interface.compactMode;
      compactToggle.onchange = e => { settings.interface.compactMode = e.target.checked; document.body.classList.toggle('compact-mode', e.target.checked); persistSettings(settings); };
      content.appendChild(compactToggle);
      content.appendChild(document.createTextNode(' Compact mode'));
      // Timestamps
      const tsToggle = document.createElement('input');
      tsToggle.type = 'checkbox';
      tsToggle.checked = settings.interface.showTimestamps;
      tsToggle.onchange = e => { settings.interface.showTimestamps = e.target.checked; persistSettings(settings); eventBus.emit('toggle-timestamps', { enabled: e.target.checked }); };
      content.appendChild(tsToggle);
      content.appendChild(document.createTextNode(' Show timestamps'));
    } else if (currentTab === 'accessibility') {
      // Accessibility
      ['highContrast','largeText','screenReader','focusOutlines'].forEach(key => {
        const label = document.createElement('label');
        label.textContent = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = settings.accessibility[key];
        toggle.onchange = e => { settings.accessibility[key] = e.target.checked; persistSettings(settings); eventBus.emit('accessibility-changed', { key, value: e.target.checked }); };
        label.appendChild(toggle);
        content.appendChild(label);
      });
    }
  }

  function updateTabBar() {
    tabBar.querySelectorAll('button').forEach((btn, idx) => {
      btn.classList.toggle('active', tabs[idx].id === currentTab);
      btn.className = btn.className.replace(/btn-\w+/g, '');
      btn.classList.add(tabs[idx].id === currentTab ? 'btn-primary' : 'btn-secondary');
    });
  }

  function saveAll() {
    persistSettings(settings);
    saveSettings(settings);
    eventBus.emit('notification', { message: 'Preferences saved', type: 'success' });
    hide();
  }
  function resetAll() {
    localStorage.removeItem('userPreferences');
    localStorage.removeItem('sidebarDefault');
    settings = loadPersistedSettings() || {};
    renderTabContent();
    eventBus.emit('notification', { message: 'Preferences reset', type: 'info' });
  }
  function show() {
    renderTabContent();
    container.style.display = 'flex';
    isVisible = true;
    document.body.classList.add('modal-open');
  }
  function hide() {
    container.style.display = 'none';
    isVisible = false;
    document.body.classList.remove('modal-open');
  }

  // Listen for global open event
  eventBus.on('toggle-settings', show);

  // Mount to body if not already
  if (!document.getElementById(containerId)) document.body.appendChild(container);
  // Expose methods
  container.show = show;
  container.hide = hide;
  container.toggle = () => (isVisible ? hide() : show());
  return container;
}

export default PreferencesModal;
