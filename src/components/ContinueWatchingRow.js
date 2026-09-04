import { tmdb } from '../api/tmdb.js';
import { storage } from '../store/storage.js';
import { nav } from '../nav/spatialNav.js';
import { icon } from '../ui/icons.js';

function formatRemaining(item) {
  const dur = item.duration || 0;
  const cur = item.currentTime || 0;
  const remaining = Math.max(0, Math.round((dur - cur) / 60));
  if (remaining <= 0) return '';
  if (remaining >= 60) return `${Math.floor(remaining / 60)}h ${remaining % 60}m left`;
  return `${remaining}m left`;
}

/**
 * Continue Watching row: cards show a persistent progress bar + season/
 * episode + time-remaining overlay (not gated behind focus like other
 * rows), and support a long-press (hold OK / mouse-hold) context menu to
 * remove a single item without opening Details first.
 */
export function createContinueWatchingRow({ items, onItemSelect, onChanged }) {
  const section = document.createElement('div');
  section.className = 'media-section';

  const titleEl = document.createElement('h2');
  titleEl.className = 'section-title';
  titleEl.innerHTML = `${icon('clock', { size: 20 })} <span>Continue Watching</span>`;
  section.appendChild(titleEl);

  const carousel = document.createElement('div');
  carousel.className = 'media-carousel';
  section.appendChild(carousel);

  function renderCards() {
    carousel.innerHTML = '';
    const currentItems = storage.getHistory();
    if (currentItems.length === 0) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    currentItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'media-card continue-card focusable';
      card.setAttribute('tabindex', '0');
      card.setAttribute('data-hold', '1');

      const itemTitle = item.title || item.name || 'Untitled';
      const posterUrl = tmdb.getImageUrl(item.poster_path, 'w342');
      const isTv = item.media_type === 'tv' || item.mediaType === 'tv';
      const epBadge = isTv && item.season && item.episode ? `S${item.season} E${item.episode}` : '';
      const timeLabel = formatRemaining(item);

      card.innerHTML = `
        <img src="${posterUrl}" alt="${itemTitle}" loading="lazy" />
        ${epBadge || timeLabel ? `
          <div class="cw-badge">${[epBadge, timeLabel].filter(Boolean).join(' · ')}</div>
        ` : ''}
        <div class="cw-progress-track"><div class="cw-progress-fill" style="width:${item.progress || 0}%"></div></div>
        <div class="media-card-info">
          <div class="media-card-title">${itemTitle}</div>
          <div class="media-card-sub"><span>${epBadge || timeLabel || 'Resume'}</span></div>
        </div>
      `;

      card.addEventListener('click', () => onItemSelect(item));
      card.addEventListener('tflix:longpress', () => openContextMenu(item));
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(item); });

      // Mouse/touch hold support (keyboard hold is handled by spatialNav via data-hold)
      let pointerTimer = null;
      const clearPointerTimer = () => { if (pointerTimer) { clearTimeout(pointerTimer); pointerTimer = null; } };
      card.addEventListener('mousedown', () => {
        clearPointerTimer();
        pointerTimer = setTimeout(() => openContextMenu(item), 550);
      });
      ['mouseup', 'mouseleave'].forEach(evt => card.addEventListener(evt, clearPointerTimer));

      carousel.appendChild(card);
    });
  }

  function openContextMenu(item) {
    const itemTitle = item.title || item.name || 'Untitled';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay cw-context-overlay';
    overlay.innerHTML = `
      <div class="modal-container cw-context-menu">
        <h3 class="cw-context-title">${itemTitle}</h3>
        <button class="btn btn-primary focusable primary-focus" id="cw-ctx-play">${icon('play')} Continue Watching</button>
        <button class="btn btn-secondary focusable" id="cw-ctx-remove" style="color:#ef4444;">${icon('trash-2')} Remove from Continue Watching</button>
        <button class="btn btn-secondary focusable" id="cw-ctx-cancel">${icon('x')} Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);
    const backHandler = () => close();
    nav.setScope(overlay);
    nav.pushBackHandler(backHandler);

    function close() {
      nav.popBackHandler(backHandler);
      nav.clearScope(overlay);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.querySelector('#cw-ctx-play').addEventListener('click', () => {
      close();
      onItemSelect(item);
    });
    overlay.querySelector('#cw-ctx-remove').addEventListener('click', () => {
      storage.removeFromHistory(item.source || 'tmdb', item.id);
      close();
      renderCards();
      if (onChanged) onChanged();
    });
    overlay.querySelector('#cw-ctx-cancel').addEventListener('click', () => close());
  }

  renderCards();

  if (!items || items.length === 0) {
    section.style.display = 'none';
  }

  return section;
}
