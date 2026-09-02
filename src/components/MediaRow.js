import { tmdb } from '../api/tmdb.js';
import { icon as renderIcon } from '../ui/icons.js';

export function createMediaRow({ title, items, icon = 'film', onItemSelect }) {
  const section = document.createElement('div');
  section.className = 'media-section';

  if (!items || items.length === 0) {
    section.style.display = 'none';
    return section;
  }

  const titleEl = document.createElement('h2');
  titleEl.className = 'section-title';
  titleEl.innerHTML = `${renderIcon(icon, { size: 20 })} <span>${title}</span>`;
  section.appendChild(titleEl);

  const carousel = document.createElement('div');
  carousel.className = 'media-carousel';

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'media-card focusable';
    card.setAttribute('tabindex', '0');

    const itemTitle = item.title || item.name || 'Untitled';
    const posterUrl = tmdb.getImageUrl(item.poster_path, 'w500');
    const isTv = item.media_type === 'tv' || item.mediaType === 'tv';
    const year = (item.release_date || item.first_air_date || '').substring(0, 4);
    const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
    const epBadge = (isTv && item.season && item.episode) ? `S${item.season} E${item.episode}` : '';

    card.innerHTML = `
      <img src="${posterUrl}" alt="${itemTitle}" loading="lazy" />
      <div class="media-card-info">
        <div class="media-card-title">${itemTitle}</div>
        <div class="media-card-sub">
          <span>${epBadge || year}</span>
          ${rating ? `<span style="color:#fbbf24; font-weight:700; display:inline-flex; align-items:center; gap:3px;">${renderIcon('star', { size: 11 })} ${rating}</span>` : ''}
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      onItemSelect(item);
    });

    carousel.appendChild(card);
  });

  section.appendChild(carousel);
  return section;
}
