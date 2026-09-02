import { tmdb } from '../api/tmdb.js';
import { storage } from '../store/storage.js';
import { nav } from '../nav/spatialNav.js';
import { icon } from '../ui/icons.js';

export class DetailsModal {
  constructor({ item, onPlay, onClose }) {
    this.item = item;
    this.onPlay = onPlay;
    this.onClose = onClose;
    this.details = null;
    this.selectedSeason = 1;
    this.episodes = [];
    this.modalEl = null;
    this.backHandler = this.close.bind(this);
  }

  async render() {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-overlay';

    const mediaType = this.item.media_type || this.item.mediaType || (this.item.first_air_date ? 'tv' : 'movie');
    
    // Show skeleton while loading full details
    this.modalEl.innerHTML = `
      <div class="modal-container">
        <div style="padding: 60px; text-align: center; color: #a1a1aa;">
          <div style="font-size: 24px; font-weight: 700; margin-bottom: 12px; color: #fff;">Loading Details...</div>
          <div>Connecting to TMDB</div>
        </div>
      </div>
    `;
    document.body.appendChild(this.modalEl);
    nav.setScope(this.modalEl);
    nav.pushBackHandler(this.backHandler);

    try {
      this.details = await tmdb.getDetails(mediaType, this.item.id);
      this.updateContent();
    } catch (err) {
      console.error('Failed to load details:', err);
      this.modalEl.innerHTML = `
        <div class="modal-container" style="padding: 40px; text-align: center;">
          <h2 style="color: #e50914; margin-bottom: 16px;">Error Loading Media Details</h2>
          <p style="color: #a1a1aa; margin-bottom: 24px;">${err.message}</p>
          <button class="btn btn-primary focusable" id="details-error-back">Go Back</button>
        </div>
      `;
      this.modalEl.querySelector('#details-error-back').addEventListener('click', () => this.close());
      nav.setScope(this.modalEl);
    }

    return this.modalEl;
  }

  async updateContent() {
    const isTv = this.details.media_type === 'tv' || this.details.mediaType === 'tv';
    const title = this.details.title || this.details.name;
    const backdropUrl = tmdb.getBackdropUrl(this.details.backdrop_path, 'w1280');
    const posterUrl = tmdb.getImageUrl(this.details.poster_path, 'w500');
    const year = (this.details.release_date || this.details.first_air_date || '').substring(0, 4);
    const rating = this.details.vote_average ? this.details.vote_average.toFixed(1) : 'N/A';
    const runtime = this.details.runtime ? `${this.details.runtime} mins` : (this.details.number_of_seasons ? `${this.details.number_of_seasons} Seasons` : '');
    const genres = (this.details.genres || []).map(g => `<span class="genre-tag">${g.name}</span>`).join('');
    const inWatchlist = storage.isInWatchlist(this.details.id);

    // Get last watched season/episode for resume
    const historyItem = storage.getHistory().find(h => h.id === this.details.id);
    const resumeSeason = historyItem ? historyItem.season : 1;
    const resumeEpisode = historyItem ? historyItem.episode : 1;

    let seasonsHtml = '';
    if (isTv && this.details.seasons && this.details.seasons.length > 0) {
      const validSeasons = this.details.seasons.filter(s => s.season_number > 0);
      seasonsHtml = `
        <div style="margin-top: 24px;">
          <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">Seasons</h3>
          <div class="season-tabs" id="season-tabs-container">
            ${validSeasons.map(s => `
              <button class="season-btn focusable ${s.season_number === this.selectedSeason ? 'active' : ''}" data-season="${s.season_number}">
                ${s.name || `Season ${s.season_number}`}
              </button>
            `).join('')}
          </div>
          <div class="episodes-grid" id="episodes-container">
            <div style="color: #71717a; padding: 20px;">Loading episodes...</div>
          </div>
        </div>
      `;
    }

    this.modalEl.innerHTML = `
      <div class="modal-container">
        <div class="details-hero" style="${backdropUrl ? `background-image: url('${backdropUrl}')` : ''}">
          <div class="details-gradient"></div>
        </div>
        <div class="details-content">
          <div class="details-header">
            <div class="details-poster">
              <img src="${posterUrl}" alt="${title}" />
            </div>
            <div class="details-info">
              <h1 class="details-title">${title}</h1>
              <div class="details-genres">${genres}</div>
              <div class="hero-meta" style="margin-bottom: 18px;">
                <span class="rating-badge">${icon('star', { size: 14 })} ${rating}</span>
                ${year ? `<span>•</span><span>${year}</span>` : ''}
                ${runtime ? `<span>•</span><span>${runtime}</span>` : ''}
                <span>•</span><span>${isTv ? 'TV Series' : 'Movie'}</span>
              </div>
              <p class="hero-overview" style="-webkit-line-clamp: 4; margin-bottom: 20px;">${this.details.overview || 'No synopsis available.'}</p>
              <div class="hero-actions">
                <button class="btn btn-primary focusable primary-focus" id="details-play-btn">
                  ${icon('play')} ${isTv ? `Play S${resumeSeason} E${resumeEpisode}` : 'Play Movie'}
                </button>
                <button class="btn btn-secondary focusable" id="details-watchlist-btn">
                  ${icon(inWatchlist ? 'bookmark-check' : 'bookmark-plus')} ${inWatchlist ? 'In Watchlist' : 'Watchlist'}
                </button>
                <button class="btn btn-secondary focusable" id="details-close-btn">
                  ${icon('x')} Close
                </button>
              </div>
            </div>
          </div>
          ${seasonsHtml}
        </div>
      </div>
    `;

    // Event listeners
    this.modalEl.querySelector('#details-play-btn').addEventListener('click', () => {
      const mediaToPlay = {
        id: this.details.id,
        media_type: isTv ? 'tv' : 'movie',
        mediaType: isTv ? 'tv' : 'movie',
        title,
        season: resumeSeason,
        episode: resumeEpisode,
        poster_path: this.details.poster_path,
        backdrop_path: this.details.backdrop_path,
        vote_average: this.details.vote_average
      };
      this.close();
      this.onPlay(mediaToPlay);
    });

    const watchlistBtn = this.modalEl.querySelector('#details-watchlist-btn');
    watchlistBtn.addEventListener('click', () => {
      if (storage.isInWatchlist(this.details.id)) {
        storage.removeFromWatchlist(this.details.id);
        watchlistBtn.innerHTML = `${icon('bookmark-plus')} Watchlist`;
      } else {
        storage.addToWatchlist(this.details);
        watchlistBtn.innerHTML = `${icon('bookmark-check')} In Watchlist`;
      }
    });

    this.modalEl.querySelector('#details-close-btn').addEventListener('click', () => this.close());

    // TV Seasons episode loading
    if (isTv) {
      const seasonButtons = this.modalEl.querySelectorAll('.season-btn');
      seasonButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const sNum = parseInt(e.currentTarget.dataset.season, 10);
          this.loadSeasonEpisodes(sNum);
        });
      });
      this.loadSeasonEpisodes(this.selectedSeason);
    }

    nav.setScope(this.modalEl);
  }

  async loadSeasonEpisodes(seasonNumber) {
    this.selectedSeason = seasonNumber;
    
    // Update active tab button
    const seasonButtons = this.modalEl.querySelectorAll('.season-btn');
    seasonButtons.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.season, 10) === seasonNumber);
    });

    const epContainer = this.modalEl.querySelector('#episodes-container');
    if (!epContainer) return;
    epContainer.innerHTML = '<div style="color: #71717a; padding: 20px;">Loading episodes...</div>';

    try {
      this.episodes = await tmdb.getSeasonDetails(this.details.id, seasonNumber);
      if (this.episodes.length === 0) {
        epContainer.innerHTML = '<div style="color: #71717a; padding: 20px;">No episodes found for this season.</div>';
        return;
      }

      epContainer.innerHTML = '';
      this.episodes.forEach(ep => {
        const epCard = document.createElement('div');
        epCard.className = 'episode-card focusable';
        epCard.setAttribute('tabindex', '0');

        const stillUrl = ep.still_path ? tmdb.getImageUrl(ep.still_path, 'w500') : tmdb.getImageUrl(this.details.backdrop_path, 'w500');

        epCard.innerHTML = `
          <div class="episode-thumb">
            <img src="${stillUrl}" alt="Episode ${ep.episode_number}" loading="lazy" />
            <div class="episode-number">EP ${ep.episode_number}</div>
          </div>
          <div class="episode-info">
            <div class="episode-title">${ep.name || `Episode ${ep.episode_number}`}</div>
            <div class="episode-desc">${ep.overview || 'No episode description.'}</div>
          </div>
        `;

        epCard.addEventListener('click', () => {
          const mediaToPlay = {
            id: this.details.id,
            media_type: 'tv',
            mediaType: 'tv',
            title: `${this.details.name || this.details.title} - S${seasonNumber}E${ep.episode_number}`,
            season: seasonNumber,
            episode: ep.episode_number,
            poster_path: this.details.poster_path,
            backdrop_path: this.details.backdrop_path,
            vote_average: this.details.vote_average
          };
          this.close();
          this.onPlay(mediaToPlay);
        });

        epContainer.appendChild(epCard);
      });
    } catch (err) {
      console.error('Failed to load season episodes:', err);
      epContainer.innerHTML = `<div style="color: #e50914; padding: 20px;">Failed to load episodes: ${err.message}</div>`;
    }
  }

  close() {
    nav.popBackHandler(this.backHandler);
    nav.clearScope(this.modalEl);
    if (this.modalEl && this.modalEl.parentNode) {
      this.modalEl.parentNode.removeChild(this.modalEl);
    }
    if (this.onClose) this.onClose();
  }
}
