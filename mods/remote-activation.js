/**
 * Samsung remotes deliver OK as a keydown event. WebKit only turns Enter into a click for
 * native interactive controls; Cineby frequently puts focus on a tabindex-enabled card
 * wrapper, so relying on the browser default leaves those cards inert.
 */

export function isEnterKey(event) {
  return event.key === 'Enter' || event.keyCode === 13 || event.which === 13;
}

function isEditable(element) {
  if (!element) return false;
  const tagName = element.tagName ? element.tagName.toLowerCase() : '';
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' ||
    element.isContentEditable === true;
}

export function getActivationTarget(element) {
  if (!element || element === document.body || element === document.documentElement) return null;
  if (element.disabled || element.getAttribute('aria-disabled') === 'true') return null;

  const tagName = element.tagName ? element.tagName.toLowerCase() : '';
  if (tagName === 'a' || tagName === 'button' || element.getAttribute('role') === 'button') {
    return element;
  }

  return element.querySelector && element.querySelector(
    'a[href], button:not([disabled]), [role="button"]:not([aria-disabled="true"])'
  );
}

export function activateFocusedElement(event) {
  if (!isEnterKey(event) || event.repeat) return false;
  if (typeof window.__tflixPlayerActive === 'function' && window.__tflixPlayerActive()) return false;

  const focused = document.activeElement;
  if (isEditable(focused)) return false;

  const target = getActivationTarget(focused);
  if (!target || typeof target.click !== 'function') return false;

  event.preventDefault();
  target.click();
  return true;
}

export function setupRemoteActivation() {
  // Capture phase makes OK reliable even when Cineby's React handlers stop bubbling.
  document.addEventListener('keydown', activateFocusedElement, true);
}
