/* Spatial Navigation Polyfill
 *
 * Loosely follows the W3C specification
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
  const FOCUSABLE_SELECTOR = 'a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

  // Re-querying every focusable element and calling getComputedStyle on each one per keypress
  // costs hundreds of forced style recalcs on a TV, which is felt directly as input lag.
  // The candidate list is cached instead and invalidated when the DOM actually changes.
  let candidateCache = null;
  let cacheDirty = true;
  let invalidateScheduled = false;

  init();

  /**
   * Get the normalized direction from the keydown event
   * @param {Event} e - keydown event
   * @return {string|undefined} - 'up', 'down', 'left', 'right' or undefined
   */
  function getDirectionFromKey(e) {
    return ARROW_KEY_CODE[e.keyCode];
  }

  /**
   * Get the current focusable candidates, rebuilding the cache only when the DOM has changed
   * @return {HTMLElement[]}
   */
  function getCandidates() {
    if (cacheDirty || !candidateCache) {
      candidateCache = Array.prototype.slice.call(document.querySelectorAll(FOCUSABLE_SELECTOR));
      cacheDirty = false;
    }
    return candidateCache;
  }

  /**
   * Get the closest element in the specified direction
   * @param {HTMLElement} currentElement - starting element
   * @param {string} direction - 'up', 'down', 'left', 'right'
   * @return {HTMLElement|null} - the found element or null if not found
   */
  function findNextFocusableElement(currentElement, direction) {
    const candidates = getCandidates();
    if (!candidates.length) return null;

    const currentRect = currentElement.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    const currentCenterY = currentRect.top + currentRect.height / 2;

    let closestElement = null;
    let closestDistance = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (candidate === currentElement || candidate.disabled) continue;

      // A zero-area rect covers display:none and detached nodes without the cost of
      // getComputedStyle, and the rect is needed for the direction math anyway.
      const rect = candidate.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      let inDirection = false;
      switch (direction) {
        case 'up':
          inDirection = rect.bottom <= currentRect.top;
          break;
        case 'down':
          inDirection = rect.top >= currentRect.bottom;
          break;
        case 'left':
          inDirection = rect.right <= currentRect.left;
          break;
        case 'right':
          inDirection = rect.left >= currentRect.right;
          break;
      }
      if (!inDirection) continue;

      // Weight the off-axis offset less so navigation prefers the aligned neighbour.
      const dx = (rect.left + rect.width / 2) - currentCenterX;
      const dy = (rect.top + rect.height / 2) - currentCenterY;
      const distance = (direction === 'up' || direction === 'down')
        ? Math.abs(dy) + Math.abs(dx) * 0.5
        : Math.abs(dx) + Math.abs(dy) * 0.5;

      if (distance < closestDistance) {
        closestDistance = distance;
        closestElement = candidate;
      }
    }

    return closestElement;
  }

  /**
   * Move focus in a direction, updating the highlight
   * @param {string} direction - 'up', 'down', 'left', 'right'
   * @return {boolean} - whether focus moved
   */
  function moveFocus(direction) {
    const currentElement = document.activeElement || document.body;
    const nextElement = findNextFocusableElement(currentElement, direction);
    if (!nextElement) return false;

    const prevFocused = document.querySelector('.tflix-focused');
    if (prevFocused) {
      prevFocused.classList.remove('tflix-focused');
    }

    nextElement.classList.add('tflix-focused');
    nextElement.focus();
    ensureElementIsVisible(nextElement);
    return true;
  }

  /**
   * Handle key events for spatial navigation
   * @param {Event} e - keydown event
   */
  function handleKeydown(e) {
    const direction = getDirectionFromKey(e);
    if (!direction) return;

    // While a real player is open, arrow keys mean seek/volume (see ui.js's Cineby key
    // handling), not grid movement. Without this, both fired for the same keypress: focus
    // silently jumped around the (invisible, behind-the-player) grid while the player also
    // reacted, which is what read as "navigation and player controls happening at once".
    if (typeof window.__tflixPlayerActive === 'function' && window.__tflixPlayerActive()) return;

    e.preventDefault();
    moveFocus(direction);
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
      // Smooth scrolling animates for hundreds of ms on TV hardware and makes held-down
      // arrow presses feel unresponsive; an instant jump reads as faster.
      element.scrollIntoView({block: 'nearest', inline: 'nearest'});
    }
  }

  /**
   * Initialize the spatial navigation polyfill
   */
  function init() {
    document.addEventListener('keydown', handleKeydown);

    // Coalesce mutation bursts: React re-renders fire these continuously, and marking the
    // cache dirty is all that is needed - the rebuild happens lazily on the next keypress.
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(function () {
        if (invalidateScheduled) return;
        invalidateScheduled = true;
        setTimeout(function () {
          cacheDirty = true;
          invalidateScheduled = false;
        }, 200);
      });

      const startObserving = function () {
        if (document.body) {
          observer.observe(document.body, {childList: true, subtree: true});
        }
      };

      if (document.body) {
        startObserving();
      } else {
        document.addEventListener('DOMContentLoaded', startObserving);
      }
    }

    window.__spatialNavigation__ = {
      keyMode: 'ARROW',
      findNextFocusableElement,
      ensureElementIsVisible,
      invalidate: function () { cacheDirty = true; }
    };

    window.navigate = moveFocus;
  }
})();
