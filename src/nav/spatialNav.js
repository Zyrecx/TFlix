/**
 * TFlix 10-Foot TV Spatial Navigation Engine
 * Optimized for Samsung Tizen TV remote controls and D-Pad navigation
 */

export const TIZEN_KEYS = {
  ENTER: 13,
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  BACK: 10009,
  ESCAPE: 27,
  BACKSPACE: 8,
  // Transport media keys
  MEDIA_PLAY_PAUSE: 10252,
  MEDIA_PLAY: 415,
  MEDIA_PAUSE: 19,
  MEDIA_STOP: 413,
  MEDIA_FAST_FORWARD: 417,
  MEDIA_REWIND: 412,
  MEDIA_TRACK_NEXT: 10233,
  MEDIA_TRACK_PREVIOUS: 10232
};

class SpatialNavigationManager {
  constructor() {
    this.currentFocusedElement = null;
    this.scopeStack = []; // Stack of active containers (e.g. modals, player screen)
    this.backHandlers = [];
    this.mediaKeyHandlers = [];
    this.isEnabled = true;
    this.lastNavTime = 0;
    this.throttleMs = 40; // Prevent remote key repeats from overflowing
    this.pressTimer = null;
    this.pressTarget = null;
    this.longPressFired = false;
    this.HOLD_MS = 550;
  }

  get activeScope() {
    while (this.scopeStack.length > 0) {
      const top = this.scopeStack[this.scopeStack.length - 1];
      if (document.body.contains(top)) {
        return top;
      }
      this.scopeStack.pop();
    }
    return null;
  }

  init() {
    this.registerTizenHardwareKeys();
    window.addEventListener('keydown', this.handleKeyDown.bind(this), { capture: true });
    // Keeps currentFocusedElement in sync when focus changes by a route
    // other than setFocus() — a mouse click (supported for desktop testing)
    // natively focuses an element without going through spatial nav, and
    // without this, subsequent D-Pad/keyboard input would navigate from a
    // stale reference point.
    window.addEventListener('focusin', this.handleFocusIn.bind(this));
    
    // Focus first available item on load
    setTimeout(() => {
      this.focusFirstAvailable();
    }, 150);
  }

  registerTizenHardwareKeys() {
    try {
      if (window.tizen && window.tizen.tvinputdevice) {
        const keysToRegister = [
          'MediaPlayPause',
          'MediaPlay',
          'MediaPause',
          'MediaStop',
          'MediaFastForward',
          'MediaRewind',
          'MediaTrackNext',
          'MediaTrackPrevious'
        ];
        keysToRegister.forEach(keyName => {
          try {
            window.tizen.tvinputdevice.registerKey(keyName);
          } catch (e) {
            // Key may already be registered or unsupported on this firmware
          }
        });
      }
    } catch (e) {
      console.warn('Tizen key registration skipped:', e);
    }
  }

  setScope(scopeElement) {
    if (!scopeElement) return;
    this.scopeStack = this.scopeStack.filter(s => s !== scopeElement);
    this.scopeStack.push(scopeElement);
    this.focusFirstAvailable();
  }

  clearScope(scopeElement) {
    if (scopeElement) {
      this.scopeStack = this.scopeStack.filter(s => s !== scopeElement);
    } else {
      this.scopeStack.pop();
    }
    this.focusFirstAvailable();
  }

  pushBackHandler(handler) {
    this.backHandlers.push(handler);
  }

  popBackHandler(handler) {
    if (handler) {
      this.backHandlers = this.backHandlers.filter(h => h !== handler);
    } else {
      this.backHandlers.pop();
    }
  }

  pushMediaKeyHandler(handler) {
    this.mediaKeyHandlers.push(handler);
  }

  popMediaKeyHandler(handler) {
    if (handler) {
      this.mediaKeyHandlers = this.mediaKeyHandlers.filter(h => h !== handler);
    } else {
      this.mediaKeyHandlers.pop();
    }
  }

  getFocusableElements() {
    const root = this.activeScope || document.body;
    const candidates = Array.from(root.querySelectorAll(
      'button, a, input, select, textarea, [tabindex="0"], .focusable'
    ));

    return candidates.filter(el => {
      if (el.disabled || el.getAttribute('aria-hidden') === 'true' || el.getAttribute('tabindex') === '-1') return false;
      if (el.offsetParent === null && window.getComputedStyle(el).position !== 'fixed') return false;
      const style = window.getComputedStyle(el);
      // For elements inside active scope, allow them if not display:none or visibility:hidden
      if (this.activeScope && this.activeScope.contains(el)) {
        return style.display !== 'none' && style.visibility !== 'hidden';
      }
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    });
  }

  focusFirstAvailable() {
    const focusables = this.getFocusableElements();
    if (focusables.length > 0) {
      // Prioritize primary action or first item
      const primary = focusables.find(el => el.classList.contains('primary-focus')) || focusables[0];
      this.setFocus(primary);
    }
  }

  focusElement(element, scroll = true) {
    return this.setFocus(element, scroll);
  }

  setFocus(element, scroll = true) {
    if (!element) return;
    
    if (this.currentFocusedElement && this.currentFocusedElement !== element) {
      this.currentFocusedElement.classList.remove('tflix-focused');
      this.currentFocusedElement.blur();
    }

    this.currentFocusedElement = element;
    element.classList.add('tflix-focused');
    // Giving a text input real DOM focus pops the TV's on-screen keyboard
    // immediately — spatial navigation should only highlight it and wait for
    // an explicit OK press (see handleKeyDown's Enter branch) before opening
    // the keyboard.
    if (!this.isTextInput(element)) {
      try {
        element.focus({ preventScroll: true });
      } catch (e) {
        element.focus();
      }
    }

    if (scroll) {
      // Smooth scroll horizontally and vertically
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }

    // Dispatch custom event for HUD/dev tools
    window.dispatchEvent(new CustomEvent('tflix:focuschange', {
      detail: { element, text: element.innerText || element.getAttribute('aria-label') || element.tagName }
    }));
  }

  handleFocusIn(e) {
    const el = e.target;
    if (!el || el === this.currentFocusedElement || !el.classList || !el.classList.contains('focusable')) return;
    if (this.currentFocusedElement) {
      this.currentFocusedElement.classList.remove('tflix-focused');
    }
    this.currentFocusedElement = el;
    el.classList.add('tflix-focused');
  }

  handleKeyDown(e) {
    if (!this.isEnabled) return;

    const now = Date.now();
    if (now - this.lastNavTime < this.throttleMs) {
      return;
    }

    const keyCode = e.keyCode || e.which;
    const key = e.key;

    // Handle Back key
    if (keyCode === TIZEN_KEYS.BACK || key === 'Escape' || (keyCode === TIZEN_KEYS.BACKSPACE && !this.isTextInput(document.activeElement))) {
      e.preventDefault();
      e.stopPropagation();
      this.handleBack();
      return;
    }

    // Handle Media transport keys
    if (
      keyCode === TIZEN_KEYS.MEDIA_PLAY_PAUSE ||
      keyCode === TIZEN_KEYS.MEDIA_PLAY ||
      keyCode === TIZEN_KEYS.MEDIA_PAUSE ||
      keyCode === TIZEN_KEYS.MEDIA_STOP ||
      keyCode === TIZEN_KEYS.MEDIA_FAST_FORWARD ||
      keyCode === TIZEN_KEYS.MEDIA_REWIND ||
      keyCode === TIZEN_KEYS.MEDIA_TRACK_NEXT ||
      keyCode === TIZEN_KEYS.MEDIA_TRACK_PREVIOUS ||
      key === 'MediaPlayPause' ||
      key === 'MediaPlay' ||
      key === 'MediaPause'
    ) {
      if (this.mediaKeyHandlers.length > 0) {
        e.preventDefault();
        const activeHandler = this.mediaKeyHandlers[this.mediaKeyHandlers.length - 1];
        activeHandler(keyCode, key);
        return;
      }
    }

    // Handle Enter / Click
    if (keyCode === TIZEN_KEYS.ENTER || key === 'Enter') {
      if (this.currentFocusedElement && document.body.contains(this.currentFocusedElement)) {
        if (this.isTextInput(this.currentFocusedElement)) {
          e.preventDefault();
          if (document.activeElement !== this.currentFocusedElement) {
            // First OK press on a spatially-highlighted-but-not-yet-real-
            // focused input: give it real focus now, which is what opens
            // the on-screen keyboard.
            try {
              this.currentFocusedElement.focus({ preventScroll: true });
            } catch (err) {
              this.currentFocusedElement.focus();
            }
          } else {
            // Already focused (keyboard open) — treat OK as submit/confirm.
            this.currentFocusedElement.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return;
        }
        e.preventDefault();
        if (this.currentFocusedElement.dataset.hold === '1') {
          this.handleHoldableEnter(e, this.currentFocusedElement);
          return;
        }
        // Elements marked `data-manual-enter="1"` handle Enter themselves via
        // their own keydown listener (e.g. the seek timeline committing a
        // scrub) — calling .click() here would also synthesize a click at
        // (0,0), which a position-based click handler would misread as a
        // seek-to-start.
        if (this.currentFocusedElement.dataset.manualEnter === '1') {
          return;
        }
        this.currentFocusedElement.click();
        return;
      } else {
        this.focusFirstAvailable();
        if (this.currentFocusedElement) {
          e.preventDefault();
          this.currentFocusedElement.click();
          return;
        }
      }
    }

    // Handle 2D Spatial Directions
    let direction = null;
    if (keyCode === TIZEN_KEYS.UP || key === 'ArrowUp') direction = 'UP';
    else if (keyCode === TIZEN_KEYS.DOWN || key === 'ArrowDown') direction = 'DOWN';
    else if (keyCode === TIZEN_KEYS.LEFT || key === 'ArrowLeft') direction = 'LEFT';
    else if (keyCode === TIZEN_KEYS.RIGHT || key === 'ArrowRight') direction = 'RIGHT';

    if (direction) {
      // If typing inside an active text input on desktop, allow left/right cursor movement
      if (this.isTextInput(document.activeElement) && (direction === 'LEFT' || direction === 'RIGHT')) {
        const input = document.activeElement;
        const len = (input.value || '').length;
        const pos = input.selectionStart;
        if (len > 0 && ((direction === 'LEFT' && pos > 0) || (direction === 'RIGHT' && pos < len))) {
          // Allow native cursor navigation inside the text
          return;
        }
      }

      // Elements marked `data-lock-horizontal="1"` (e.g. the seek timeline)
      // own LEFT/RIGHT entirely — without this, spatial navigate() would
      // shift focus to a neighboring button on the same keypress that the
      // element's own listener is using to scrub/seek.
      if (
        this.currentFocusedElement &&
        this.currentFocusedElement.dataset.lockHorizontal === '1' &&
        (direction === 'LEFT' || direction === 'RIGHT')
      ) {
        return;
      }

      e.preventDefault();
      this.lastNavTime = now;
      this.navigate(direction);
    }
  }

  /**
   * Long-press support for elements marked `data-hold="1"` (e.g. Continue
   * Watching cards). A short press still fires a normal click; holding OK
   * past HOLD_MS dispatches `tflix:longpress` on the element instead, so a
   * card can open a context menu without every focusable element paying
   * for the extra keyup bookkeeping.
   */
  handleHoldableEnter(e, el) {
    if (e.repeat || this.pressTimer) return; // already tracking this hold

    this.longPressFired = false;
    this.pressTarget = el;
    this.pressTimer = setTimeout(() => {
      this.longPressFired = true;
      this.pressTimer = null;
      if (this.pressTarget && document.body.contains(this.pressTarget)) {
        this.pressTarget.dispatchEvent(new CustomEvent('tflix:longpress', { bubbles: true }));
      }
    }, this.HOLD_MS);

    const keyupHandler = (upEvent) => {
      const upKeyCode = upEvent.keyCode || upEvent.which;
      if (upKeyCode !== TIZEN_KEYS.ENTER && upEvent.key !== 'Enter') return;
      window.removeEventListener('keyup', keyupHandler, { capture: true });
      if (this.pressTimer) {
        clearTimeout(this.pressTimer);
        this.pressTimer = null;
      }
      if (!this.longPressFired && this.pressTarget && document.body.contains(this.pressTarget)) {
        this.pressTarget.click();
      }
      this.pressTarget = null;
    };
    window.addEventListener('keyup', keyupHandler, { capture: true });
  }

  isTextInput(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea';
  }

  handleBack() {
    if (this.backHandlers.length > 0) {
      const topHandler = this.backHandlers[this.backHandlers.length - 1];
      const handled = topHandler();
      if (handled !== false) {
        return;
      }
    }

    // Nothing consumed it — app.js registers a permanent root handler that
    // shows an exit-confirmation dialog, so this only runs as a fallback if
    // that handler was never installed.
    this.exitApp();
  }

  /**
   * Actually terminates the app — call only after the user has confirmed.
   * Returns true if an exit mechanism was actually invoked, false if none
   * was available (so the caller can at least close its own UI rather than
   * leave a "did nothing" dialog on screen).
   *
   * window.tizen is the real Tizen Web API and is the only mechanism
   * guaranteed to actually terminate the app — but it is NOT reliably
   * present here: TizenBrew doesn't expose it to dynamically-loaded npm
   * modules (see the desktop-shim detection bug this app previously had).
   * window.close() is tried as a fallback on the chance the host webview
   * honors it, but most browsers only allow it on script-opened windows,
   * so it may be a no-op. TizenBrew currently documents no module-level
   * "close/return to module list" API to call instead.
   */
  exitApp() {
    if (window.tizen && window.tizen.application) {
      try {
        window.tizen.application.getCurrentApplication().exit();
        return true;
      } catch (e) {
        console.warn('tizen.application.exit() failed:', e);
      }
    }
    try {
      window.close();
      return true;
    } catch (e) {
      console.warn('window.close() failed:', e);
    }
    return false;
  }

  navigate(direction) {
    const focusables = this.getFocusableElements();
    if (focusables.length === 0) return;

    if (!this.currentFocusedElement || !focusables.includes(this.currentFocusedElement)) {
      this.setFocus(focusables[0]);
      return;
    }

    const currentRect = this.currentFocusedElement.getBoundingClientRect();
    const candidates = focusables.filter(el => el !== this.currentFocusedElement);

    let bestCandidate = null;
    let shortestDistance = Infinity;

    for (const candidate of candidates) {
      const targetRect = candidate.getBoundingClientRect();

      if (!this.isInDirection(currentRect, targetRect, direction)) {
        continue;
      }

      const distance = this.calculateDistance(currentRect, targetRect, direction);
      if (distance < shortestDistance) {
        shortestDistance = distance;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      this.setFocus(bestCandidate);
    }
  }

  isInDirection(fromRect, toRect, direction) {
    const fromCenter = { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 };
    const toCenter = { x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 };

    const threshold = 8; // Coordinate leeway
    switch (direction) {
      case 'UP':
        return toCenter.y < fromCenter.y - threshold;
      case 'DOWN':
        return toCenter.y > fromCenter.y + threshold;
      case 'LEFT':
        return toCenter.x < fromCenter.x - threshold;
      case 'RIGHT':
        return toCenter.x > fromCenter.x + threshold;
      default:
        return false;
    }
  }

  calculateDistance(fromRect, toRect, direction) {
    const fromCenter = { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 };
    const toCenter = { x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 };

    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;

    // Weight the orthogonal distance heavily to prioritize natural linear grid rows
    if (direction === 'LEFT' || direction === 'RIGHT') {
      return Math.abs(dx) + Math.abs(dy) * 2.5;
    } else {
      return Math.abs(dy) + Math.abs(dx) * 2.5;
    }
  }
}

export const nav = new SpatialNavigationManager();
