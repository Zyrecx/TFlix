import { nav } from '../nav/spatialNav.js';
import { icon } from './icons.js';

/**
 * TV-safe episode-range picker. A season with hundreds of episodes (e.g.
 * daily talk shows, long-running anime) chunks into dozens of "1-25",
 * "26-50"... buttons — rendered as a flat row that gets impossibly crowded
 * (wraps many rows deep) and slow to D-pad through. This collapses them
 * behind one button showing the active range, opening a scrollable focusable
 * list overlay instead — same pattern as serverMenu.js's provider picker.
 */
export function openRangeMenu({ ranges, currentStart, onSelect }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay range-menu-overlay';
  overlay.innerHTML = `
    <div class="modal-container range-menu">
      <h3 class="range-menu-title">Jump to Episode Range</h3>
      <div class="range-menu-list">
        ${ranges.map(r => `
          <button class="range-menu-item focusable ${r.start === currentStart ? 'active' : ''}" data-range-start="${r.start}">
            Episodes ${r.start}–${r.end}
          </button>
        `).join('')}
      </div>
      <button class="btn btn-secondary focusable" id="range-menu-cancel">${icon('x')} Cancel</button>
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

  overlay.querySelectorAll('.range-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const start = parseInt(btn.dataset.rangeStart, 10);
      close();
      onSelect(start);
    });
  });
  overlay.querySelector('#range-menu-cancel').addEventListener('click', close);

  // Land focus on the currently active range rather than the top of the
  // list, so re-opening the picker doesn't strand you at range 1 every time.
  const activeItem = overlay.querySelector('.range-menu-item.active');
  if (activeItem) nav.setFocus(activeItem);

  return close;
}
