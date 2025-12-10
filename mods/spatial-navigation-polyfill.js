/* Spatial Navigation Polyfill
 *
 * It follows W3C official specification
 * https://drafts.csswg.org/css-nav-1/
 *
 * Copyright (c) 2018-2019 LG Electronics Inc.
 * https://github.com/WICG/spatial-navigation/polyfill
 *
 * Licensed under the MIT license (MIT)
 */

(function () {
  // The polyfill must not be executed, if it's already enabled via browser engine or browser extensions.
  if ('navigate' in window) {
    return;
  }

  const ARROW_KEY_CODE = {37: 'left', 38: 'up', 39: 'right', 40: 'down'};
  const TAB_KEY_CODE = 9;
  let mapOfBoundRect = null;
  let startingPoint = null; // Saves spatial navigation starting point
  let savedSearchOrigin = {element: null, rect: null};  // Saves previous search origin
  let searchOriginRect = null;  // Rect of current search origin

  // Initiate when the polyfill is loaded
  init();

  /**
   * Get the normalized direction from the keydown event
   * @param {Event} e - keydown event
   * @return {string|undefined} - 'up', 'down', 'left', 'right' or undefined
   */
  function getDirectionFromKey(e) {
    const key = ARROW_KEY_CODE[e.keyCode];
    return key;
  }

  /**
   * Get the closest element in the specified direction
   * @param {HTMLElement} currentElement - starting element
   * @param {string} direction - 'up', 'down', 'left', 'right'
   * @return {HTMLElement|null} - the found element or null if not found
   */
  function findNextFocusableElement(currentElement, direction) {
    const candidateElements = document.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const visibleCandidates = Array.from(candidateElements).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled;
    });

    if (!visibleCandidates.length) return null;

    const currentRect = currentElement.getBoundingClientRect();
    let closestElement = null;
    let closestDistance = Infinity;

    for (const candidate of visibleCandidates) {
      if (candidate === currentElement) continue;
      
      const candidateRect = candidate.getBoundingClientRect();
      
      // Check if the candidate is in the right direction
      let inDirection = false;
      switch (direction) {
        case 'up':
          inDirection = candidateRect.bottom < currentRect.top;
          break;
        case 'down':
          inDirection = candidateRect.top > currentRect.bottom;
          break;
        case 'left':
          inDirection = candidateRect.right < currentRect.left;
          break;
        case 'right':
          inDirection = candidateRect.left > currentRect.right;
          break;
      }
      
      if (inDirection) {
        // Calculate distance based on the centers of the elements
        const dx = (candidateRect.left + candidateRect.width/2) - (currentRect.left + currentRect.width/2);
        const dy = (candidateRect.top + candidateRect.height/2) - (currentRect.top + currentRect.height/2);
        
        // Distance formula adjusted for direction priority
        let distance;
        switch (direction) {
          case 'up':
          case 'down':
            distance = Math.abs(dy) + Math.abs(dx) * 0.5;
            break;
          case 'left':
          case 'right':
            distance = Math.abs(dx) + Math.abs(dy) * 0.5;
            break;
        }
        
        if (distance < closestDistance) {
          closestDistance = distance;
          closestElement = candidate;
        }
      }
    }
    
    return closestElement;
  }

  /**
   * Handle key events for spatial navigation
   * @param {Event} e - keydown event
   */
  function handleKeydown(e) {
    // Only handle arrow keys
    const direction = getDirectionFromKey(e);
    if (!direction) return;
    
    // Prevent default arrow key behavior
    e.preventDefault();
    
    const currentElement = document.activeElement || document.body;
    const nextElement = findNextFocusableElement(currentElement, direction);
    
    if (nextElement) {
      // Remove previous focus styling
      const prevFocused = document.querySelector('.tflix-focused');
      if (prevFocused) {
        prevFocused.classList.remove('tflix-focused');
      }
      
      // Add focus styling to new element
      nextElement.classList.add('tflix-focused');
      
      // Ensure the element is visible by scrolling if needed
      ensureElementIsVisible(nextElement);
      
      // Focus the element
      nextElement.focus();
    }
  }

  /**
   * Ensure the element is visible in the viewport
   * @param {HTMLElement} element - element to make visible
   */
  function ensureElementIsVisible(element) {
    const rect = element.getBoundingClientRect();
    const isInViewport = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
    
    if (!isInViewport) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    }
  }

  /**
   * Initialize the spatial navigation polyfill
   */
  function init() {
    // Setup key event listeners
    document.addEventListener('keydown', handleKeydown);
    
    // Add a global object for spatial navigation
    window.__spatialNavigation__ = {
      keyMode: 'ARROW',
      findNextFocusableElement,
      ensureElementIsVisible
    };
    
    // Add navigate function to window
    window.navigate = function(direction) {
      const currentElement = document.activeElement || document.body;
      const nextElement = findNextFocusableElement(currentElement, direction);
      
      if (nextElement) {
        // Remove previous focus styling
        const prevFocused = document.querySelector('.tflix-focused');
        if (prevFocused) {
          prevFocused.classList.remove('tflix-focused');
        }
        
        // Add focus styling to new element
        nextElement.classList.add('tflix-focused');
        
        // Ensure the element is visible by scrolling if needed
        ensureElementIsVisible(nextElement);
        
        // Focus the element
        nextElement.focus();
        
        return true;
      }
      
      return false;
    };
  }
})();
