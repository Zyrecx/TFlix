import { nav } from '../nav/spatialNav.js';
import { icon } from './icons.js';

/**
 * TV-safe server picker. Replaces a native <select> — Tizen's webview (and
 * Chrome, when the picker is opened via synthetic .click() rather than a
 * real pointer event) won't open the native dropdown UI from a keyboard
 * Enter, so OK on the remote silently does nothing. This is a focusable
 * modal list instead, consistent with the rest of the app's dialogs.
 */
export function openServerMenu({ providers, currentId, onSelect }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay server-menu-overlay';
  overlay.innerHTML = `
    <div class="modal-container server-menu">
      <h3 class="server-menu-title">Choose Server</h3>
      <div class="server-menu-list">
        ${providers.map(p => `
          <button class="server-menu-item focusable ${p.id === currentId ? 'active' : ''}" data-provider="${p.id}">
            <span class="server-menu-item-name">${p.name}</span>
            <span class="hud-badge-tag" style="font-size: 9px; background: ${p.type === 'direct' ? '#16a34a' : '#3f3f46'}; display:inline-flex; align-items:center; gap:3px;">
              ${p.type === 'direct' ? `${icon('zap', { size: 10 })} NATIVE HLS` : `${icon('tv', { size: 10 })} EMBED`}
            </span>
          </button>
        `).join('')}
      </div>
      <button class="btn btn-secondary focusable" id="server-menu-cancel">${icon('x')} Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const backHandler = () => { close(); return true; };
  nav.setScope(overlay);
  nav.pushBackHandler(backHandler);

  function close() {
    nav.popBackHandler(backHandler);
    nav.clearScope(overlay);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  overlay.querySelectorAll('.server-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.provider;
      close();
      onSelect(id);
    });
  });
  overlay.querySelector('#server-menu-cancel').addEventListener('click', close);

  return close;
}
