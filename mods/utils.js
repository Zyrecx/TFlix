/**
 * TFlix utility functions
 */

/**
 * Create and show a toast notification
 * @param {string} message - Message to display
 * @param {number} duration - Duration in milliseconds
 */
export function showToast(message, duration = 2000) {
  // Check if a toast already exists
  let toast = document.querySelector('.tflix-toast');
  
  // If not, create one
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'tflix-toast';
    document.body.appendChild(toast);
  }
  
  // Update message and show
  toast.textContent = message;
  toast.classList.add('show');
  
  // Hide after specified duration
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * Add debug logging for development
 * @param {string} message - Log message
 * @param {any} data - Optional data to log
 */
export function log(message, data = null) {
  if (typeof console !== 'undefined') {
    console.log(`TFlix: ${message}`);
    if (data) {
      console.log(data);
    }
  }
}

/**
 * Ensure an element is visible in the viewport
 * @param {HTMLElement} element - Element to make visible
 * @param {string} position - Position within viewport (start, center, end, nearest)
 */
export function ensureElementIsVisible(element, position = 'nearest') {
  if (!element) return;
  
  element.scrollIntoView({
    behavior: 'smooth',
    block: position,
    inline: position
  });
}

/**
 * Check if a specified key is being pressed
 * @param {Event} event - Remote control event
 * @param {string} key - Key name
 * @returns {boolean} - True if specified key is pressed
 */
export function isKeyPressed(event, key) {
  return event.key === key;
}

/**
 * Throttle function to limit execution rate
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} - Throttled function
 */
export function throttle(func, limit) {
  let lastFunc;
  let lastRan;
  
  return function() {
    const context = this;
    const args = arguments;
    
    if (!lastRan) {
      func.apply(context, args);
      lastRan = Date.now();
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(function() {
        if ((Date.now() - lastRan) >= limit) {
          func.apply(context, args);
          lastRan = Date.now();
        }
      }, limit - (Date.now() - lastRan));
    }
  };
}

/**
 * Add event listener with automatic cleanup
 * @param {Element} element - DOM element to attach listener to
 * @param {string} type - Event type (e.g., 'click', 'keydown')
 * @param {Function} listener - Event handler function
 * @param {boolean|object} options - Event listener options
 * @returns {Function} - Function to remove the listener
 */
export function addSafeEventListener(element, type, listener, options = false) {
  if (!element) return () => {};
  
  element.addEventListener(type, listener, options);
  
  // Return a function to remove the listener
  return () => {
    element.removeEventListener(type, listener, options);
  };
}
