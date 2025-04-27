/**
 * ContentWrapper Component
 * Wraps message timeline and command center into a single container.
 */
export function ContentWrapper({ containerId = 'content-wrapper', children = [] } = {}) {
  const wrapper = document.createElement('div');
  wrapper.id = containerId;
  wrapper.className = 'content-wrapper';
  children.forEach(child => {
    if (child instanceof HTMLElement) {
      wrapper.appendChild(child);
    }
  });
  return wrapper;
}

export default ContentWrapper;
