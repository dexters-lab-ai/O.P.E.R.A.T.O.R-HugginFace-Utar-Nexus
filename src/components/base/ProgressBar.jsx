/**
 * Base Progress Bar Component
 * A reusable progress indicator for displaying completion status
 */

/**
 * Create a progress bar component
 * @param {Object} props - Component properties
 * @returns {HTMLElement} Progress bar element
 */
export function ProgressBar(props = {}) {
  const {
    value = 0,
    max = 100,
    showLabel = true,
    size = 'default', // 'small', 'default', 'large'
    variant = 'primary', // 'primary', 'secondary', 'success', 'warning', 'danger'
    striped = false,
    animated = false,
    vertical = false,
    className = '',
    id = '',
    labelFormatter = null
  } = props;

  // Create container element
  const container = document.createElement('div');
  container.className = `progress-container ${size} ${className} ${vertical ? 'vertical' : 'horizontal'}`;
  if (id) container.id = id;
  
  // Create progress bar
  const progressBar = document.createElement('div');
  progressBar.className = `progress-bar ${variant}${striped ? ' striped' : ''}${animated ? ' animated' : ''}`;
  
  // Set initial progress
  setProgress(value);
  
  // Create label if enabled
  let labelElement = null;
  if (showLabel) {
    labelElement = document.createElement('span');
    labelElement.className = 'progress-label';
    updateLabel();
    container.appendChild(labelElement);
  }
  
  // Add bar to container
  container.appendChild(progressBar);
  
  /**
   * Set progress value
   * @param {number} newValue - Progress value
   */
  function setProgress(newValue) {
    // Ensure value is within range
    const sanitizedValue = Math.min(Math.max(0, newValue), max);
    
    // Calculate percentage
    const percentage = (sanitizedValue / max) * 100;
    
    // Update progress bar width/height
    if (vertical) {
      progressBar.style.height = `${percentage}%`;
    } else {
      progressBar.style.width = `${percentage}%`;
    }
    
    // Update aria attributes
    progressBar.setAttribute('aria-valuenow', sanitizedValue);
    progressBar.setAttribute('aria-valuemin', 0);
    progressBar.setAttribute('aria-valuemax', max);
    
    // Store current value
    container.dataset.value = sanitizedValue;
    
    // Update label if visible
    if (showLabel && labelElement) {
      updateLabel();
    }
  }
  
  /**
   * Update progress label
   */
  function updateLabel() {
    const value = parseFloat(container.dataset.value || 0);
    
    if (labelFormatter && typeof labelFormatter === 'function') {
      labelElement.textContent = labelFormatter(value, max);
    } else {
      // Default formatting
      const percentage = Math.round((value / max) * 100);
      labelElement.textContent = `${percentage}%`;
    }
  }
  
  /**
   * Set progress bar variant
   * @param {string} newVariant - New variant name
   */
  function setVariant(newVariant) {
    // Remove existing variant class
    progressBar.classList.remove('primary', 'secondary', 'success', 'warning', 'danger');
    
    // Add new variant class
    progressBar.classList.add(newVariant);
  }
  
  /**
   * Toggle striped appearance
   * @param {boolean} isStriped - Whether to show stripes
   */
  function setStriped(isStriped) {
    progressBar.classList.toggle('striped', isStriped);
  }
  
  /**
   * Toggle animation
   * @param {boolean} isAnimated - Whether to animate the progress bar
   */
  function setAnimated(isAnimated) {
    progressBar.classList.toggle('animated', isAnimated);
  }
  
  // Expose public methods
  container.setProgress = setProgress;
  container.setVariant = setVariant;
  container.setStriped = setStriped;
  container.setAnimated = setAnimated;
  container.getValue = () => parseFloat(container.dataset.value || 0);

  return container;
}

/**
 * Create an indeterminate spinner
 * @param {Object} props - Spinner properties
 * @returns {HTMLElement} Spinner element
 */
ProgressBar.createSpinner = (props = {}) => {
  const {
    size = 'default', // 'small', 'default', 'large'
    variant = 'primary',
    inline = false,
    className = '',
    id = ''
  } = props;
  
  const spinner = document.createElement('div');
  spinner.className = `spinner ${size} ${variant} ${inline ? 'inline' : ''} ${className}`;
  if (id) spinner.id = id;
  
  return spinner;
};

/**
 * Create a circular progress indicator
 * @param {Object} props - Circle progress properties
 * @returns {HTMLElement} Circle progress element
 */
ProgressBar.createCircle = (props = {}) => {
  const {
    value = 0,
    max = 100,
    size = 60, // diameter in pixels
    strokeWidth = 4, // stroke width in pixels
    variant = 'primary',
    showLabel = true,
    className = '',
    id = ''
  } = props;
  
  // Create container
  const container = document.createElement('div');
  container.className = `circle-progress ${variant} ${className}`;
  container.style.width = `${size}px`;
  container.style.height = `${size}px`;
  if (id) container.id = id;
  
  // Calculate circle properties
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  
  // Create SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  
  // Create background circle
  const backgroundCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  backgroundCircle.setAttribute('cx', size / 2);
  backgroundCircle.setAttribute('cy', size / 2);
  backgroundCircle.setAttribute('r', radius);
  backgroundCircle.setAttribute('fill', 'none');
  backgroundCircle.setAttribute('stroke-width', strokeWidth);
  backgroundCircle.classList.add('circle-background');
  
  // Create progress circle
  const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  progressCircle.setAttribute('cx', size / 2);
  progressCircle.setAttribute('cy', size / 2);
  progressCircle.setAttribute('r', radius);
  progressCircle.setAttribute('fill', 'none');
  progressCircle.setAttribute('stroke-width', strokeWidth);
  progressCircle.setAttribute('stroke-linecap', 'round');
  progressCircle.classList.add('circle-progress-path');
  
  // Initialize progress
  setCircleProgress(value);
  
  // Add circles to SVG
  svg.appendChild(backgroundCircle);
  svg.appendChild(progressCircle);
  
  // Add SVG to container
  container.appendChild(svg);
  
  // Add label if enabled
  if (showLabel) {
    const label = document.createElement('span');
    label.className = 'circle-label';
    updateLabel();
    container.appendChild(label);
  }
  
  /**
   * Set circle progress
   * @param {number} newValue - New progress value
   */
  function setCircleProgress(newValue) {
    // Ensure value is within range
    const sanitizedValue = Math.min(Math.max(0, newValue), max);
    
    // Calculate percentage
    const percentage = sanitizedValue / max;
    
    // Calculate stroke dash
    const strokeDasharray = circumference;
    const strokeDashoffset = circumference * (1 - percentage);
    
    // Update progress circle
    progressCircle.style.strokeDasharray = circumference;
    progressCircle.style.strokeDashoffset = strokeDashoffset;
    
    // Store current value
    container.dataset.value = sanitizedValue;
    
    // Update label if present
    updateLabel();
  }
  
  /**
   * Update progress label
   */
  function updateLabel() {
    if (!showLabel) return;
    
    const label = container.querySelector('.circle-label');
    if (label) {
      const value = parseFloat(container.dataset.value || 0);
      const percentage = Math.round((value / max) * 100);
      label.textContent = `${percentage}%`;
    }
  }
  
  // Expose public methods
  container.setProgress = setCircleProgress;
  container.getValue = () => parseFloat(container.dataset.value || 0);
  
  return container;
};

export default ProgressBar;
