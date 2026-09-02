import { tmdb } from '../api/tmdb.js';
import { icon } from '../ui/icons.js';

export function createHeroBanner({ item, onPlay, onDetails }) {
  const container = document.createElement('div');
  container.className = 'hero-banner';

  if (!item) {
    container.style.display = 'none';
    return container;
  }

  const title = item.title || item.name || 'Featured Title';
  const backdropUrl = tmdb.getBackdropUrl(item.backdrop_path, 'w1280');
  const year = (item.release_date || item.first_air_date || '').substring(0, 4);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
  const overview = item.overview || 'No description available.';
  const isTv = item.media_type === 'tv' || item.mediaType === 'tv' || Boolean(item.first_air_date);
  const typeLabel = isTv ? 'TV SERIES' : 'MOVIE';

  if (backdropUrl) {
    container.style.backgroundImage = `url('${backdropUrl}')`;
  }

  container.innerHTML = `
    <div class="hero-backdrop-gradient"></div>
    <div class="hero-content">
      <div class="hero-tag">${icon('star', { size: 13 })} SPOTLIGHT ${typeLabel}</div>
      <h1 class="hero-title">${title}</h1>
      <div class="hero-meta">
        <span class="rating-badge">${icon('star', { size: 14 })} ${rating}</span>
        ${year ? `<span>•</span><span>${year}</span>` : ''}
        <span>•</span><span>TMDB HD</span>
      </div>
      <p class="hero-overview">${overview}</p>
      <div class="hero-actions">
        <button class="btn btn-primary focusable primary-focus" id="hero-play-btn">
          ${icon('play')} Play Now
        </button>
        <button class="btn btn-secondary focusable" id="hero-details-btn">
          ${icon('info')} More Info
        </button>
      </div>
    </div>
  `;

  container.querySelector('#hero-play-btn').addEventListener('click', () => {
    onPlay({
      ...item,
      media_type: isTv ? 'tv' : 'movie',
      mediaType: isTv ? 'tv' : 'movie',
      title
    });
  });

  container.querySelector('#hero-details-btn').addEventListener('click', () => {
    onDetails(item);
  });

  return container;
}
