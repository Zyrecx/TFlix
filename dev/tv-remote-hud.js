/**
 * Interactive TV Remote Simulator & HUD for Desktop Testing
 * Translates desktop keyboard presses to real Tizen key events
 * Provides a floating on-screen TV remote controller
 */

export function setupTvRemoteSimulator() {
  if (typeof window === 'undefined') return;

  // 1. Keyboard translator for desktop
  window.addEventListener('keydown', (e) => {
    // If user is typing in a real input, pass through
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      return;
    }

    const key = e.key.toLowerCase();
    
    // Desktop shortcut 'b' -> Tizen Back (10009)
    if (key === 'b' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      dispatchKeyEvent(10009, 'Back');
      return;
    }

    // Space / 'p' -> MediaPlayPause (10252)
    if ((key === ' ' || key === 'p') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      dispatchKeyEvent(10252, 'MediaPlayPause');
      return;
    }

    // 'f' -> MediaFastForward (417)
    if (key === 'f' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      dispatchKeyEvent(417, 'MediaFastForward');
      return;
    }

    // 'r' -> MediaRewind (412)
    if (key === 'r' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      dispatchKeyEvent(412, 'MediaRewind');
      return;
    }
  }, { capture: false });

  // 2. Build on-screen visual TV remote & HUD
  const hudContainer = document.createElement('div');
  hudContainer.id = 'dev-tv-remote-hud';
  hudContainer.innerHTML = `
    <style>
      #dev-tv-remote-hud {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 12px;
        color: #fff;
        user-select: none;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
      }
      .remote-toggle-btn {
        background: rgba(229, 9, 20, 0.9);
        color: #fff;
        border: none;
        border-radius: 20px;
        padding: 8px 16px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .remote-panel {
        background: #181820;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 16px;
        padding: 16px;
        width: 220px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.8);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .remote-panel.collapsed {
        display: none;
      }
      .remote-title {
        font-weight: 800;
        font-size: 13px;
        color: #e50914;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .hud-stats {
        background: #111116;
        padding: 8px;
        border-radius: 6px;
        font-family: monospace;
        font-size: 11px;
        color: #a1a1aa;
      }
      .hud-stats span {
        color: #4ade80;
      }
      .dpad-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(3, 1fr);
        gap: 6px;
        margin: 6px 0;
      }
      .remote-btn {
        background: #272732;
        border: 1px solid rgba(255,255,255,0.1);
        color: #fff;
        border-radius: 8px;
        padding: 10px 0;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.1s ease;
      }
      .remote-btn:hover {
        background: #3f3f50;
      }
      .remote-btn:active {
        background: #e50914;
      }
      .remote-btn.ok-btn {
        background: #e50914;
        font-weight: 800;
      }
      .actions-row {
        display: flex;
        gap: 6px;
      }
      .actions-row .remote-btn {
        flex: 1;
      }
    </style>

    <div class="remote-panel collapsed" id="tv-remote-panel">
      <div class="remote-title">
        <span>SAMSUNG TV REMOTE</span>
        <span style="font-size: 10px; color: #71717a;">DEV SHIM</span>
      </div>

      <div class="hud-stats" id="remote-hud-stats">
        <div>Focused: <span id="hud-focused-name">None</span></div>
        <div>Last Key: <span id="hud-last-key">None</span></div>
      </div>

      <div class="dpad-grid">
        <div></div>
        <button class="remote-btn" id="rm-up">▲</button>
        <div></div>
        <button class="remote-btn" id="rm-left">◀</button>
        <button class="remote-btn ok-btn" id="rm-ok">OK</button>
        <button class="remote-btn" id="rm-right">▶</button>
        <div></div>
        <button class="remote-btn" id="rm-down">▼</button>
        <div></div>
      </div>

      <div class="actions-row">
        <button class="remote-btn" id="rm-rewind" style="font-size: 11px;">⏪ -10s</button>
        <button class="remote-btn" id="rm-playpause">⏯ Play</button>
        <button class="remote-btn" id="rm-ff" style="font-size: 11px;">⏩ +10s</button>
      </div>
      <div class="actions-row" style="margin-top: -6px;">
        <button class="remote-btn" id="rm-back" style="background: #3b2024; color: #f87171;">⮌ Back</button>
      </div>
      <div style="font-size: 10px; color: #71717a; text-align: center; margin-top: 2px;">
        Keyboard: Arrows, Enter, 'b' (Back), Space (Play), 'r' (-10s), 'f' (+10s)
      </div>
    </div>

    <button class="remote-toggle-btn" id="tv-remote-toggle">
      <span>📺</span> TV Remote Simulator
    </button>
  `;

  document.body.appendChild(hudContainer);

  const panel = hudContainer.querySelector('#tv-remote-panel');
  const toggleBtn = hudContainer.querySelector('#tv-remote-toggle');

  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
  });

  // Attach D-pad buttons
  hudContainer.querySelector('#rm-up').addEventListener('click', () => dispatchKeyEvent(38, 'ArrowUp'));
  hudContainer.querySelector('#rm-down').addEventListener('click', () => dispatchKeyEvent(40, 'ArrowDown'));
  hudContainer.querySelector('#rm-left').addEventListener('click', () => dispatchKeyEvent(37, 'ArrowLeft'));
  hudContainer.querySelector('#rm-right').addEventListener('click', () => dispatchKeyEvent(39, 'ArrowRight'));
  hudContainer.querySelector('#rm-ok').addEventListener('click', () => dispatchKeyEvent(13, 'Enter'));
  hudContainer.querySelector('#rm-back').addEventListener('click', () => dispatchKeyEvent(10009, 'Back'));
  hudContainer.querySelector('#rm-playpause').addEventListener('click', () => dispatchKeyEvent(10252, 'MediaPlayPause'));
  hudContainer.querySelector('#rm-rewind').addEventListener('click', () => dispatchKeyEvent(412, 'MediaRewind'));
  hudContainer.querySelector('#rm-ff').addEventListener('click', () => dispatchKeyEvent(417, 'MediaFastForward'));

  // Listen to focus changes
  window.addEventListener('tflix:focuschange', (e) => {
    const focusedName = hudContainer.querySelector('#hud-focused-name');
    if (focusedName && e.detail) {
      focusedName.textContent = (e.detail.text || e.detail.element.tagName).slice(0, 16);
    }
  });
}

function dispatchKeyEvent(keyCode, keyName) {
  const lastKeyEl = document.querySelector('#hud-last-key');
  if (lastKeyEl) {
    lastKeyEl.textContent = `${keyName} (${keyCode})`;
  }

  const event = new KeyboardEvent('keydown', {
    keyCode: keyCode,
    which: keyCode,
    key: keyName,
    bubbles: true,
    cancelable: true
  });

  // Dispatch on the currently focused element (falling back to window) so the
  // event bubbles through it first — components that attach their own
  // keydown listener directly to a focused element (e.g. the seek bar) only
  // ever see events whose path includes that element. Dispatching at window
  // skips it entirely, even though window-level capture listeners (nav)
  // still receive it either way.
  const target = (document.activeElement && document.activeElement !== document.body)
    ? document.activeElement
    : window;
  target.dispatchEvent(event);
}
