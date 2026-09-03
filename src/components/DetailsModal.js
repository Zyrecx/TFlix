import { tmdb } from '../api/tmdb.js';
import { storage } from '../store/storage.js';
import { nav } from '../nav/spatialNav.js';
import { icon } from '../ui/icons.js';
import { openRangeMenu } from '../ui/rangeMenu.js';
import { getProviders } from '../api/providers.js';
import { listAvailableEpisodes } from '../api/streamScraper.js';

// Shows with very large seasons (e.g. daily talk shows with 1000+ episodes)
// are chunked into fixed-size ranges so the carousel never has to render
// (or the remote never has to D-pad through) more than this many cards at
// once — mirrors how TMDB/most trackers paginate long seasons.
const EP_CHUNK_SIZE = 25;

export class DetailsModal {
  constructor({ item, onPlay, onClose }) {
    this.item = item;
    this.onPlay = onPlay;
    this.onClose = onClose;
    this.details = null;
    this.selectedSeason = 1;
    this.episodes = []; // full episode list for the selected season
    this.ranges = null; // chunked ranges for the selected season, or null if not chunked
    this.selectedRangeStart = 1;
    this.modalEl = null;
    this.backHandler = this.close.bind(this);
    // Episode-availability badges (see docs/PROVIDER_PACKS.md's "Optional
    // capabilities") — null means "unknown/don't show badges", a Set means
    // "known, badge anything not in it". Only ever reflects the default
    // provider, since availability is provider-specific — see loadAvailability.
    this.availableEpisodes = null;
    this.availabilityProviderId = null;
  }

  // Fire-and-forget: badges are a bonus, never block or slow down browsing.
  // listAvailableEpisodes already refuses to do anything (returns null, no
  // network call) unless this exact provider+show has an already-confirmed
  // identity — see its own comment for why that's required for safety.
  async loadAvailability() {
    const providerId = storage.getDefaultProvider();
    if (!providerId) return;
    const provider = getProviders().find(p => p.id === providerId);
    if (!provider || !provider.supportsAvailability) return;

    const episodes = await listAvailableEpisodes(providerId, this.details.id);
    if (!episodes) return;

    this.availableEpisodes = new Set(episodes);
    this.availabilityProviderId = providerId;
    if (this.modalEl && document.body.contains(this.modalEl)) {
      this.renderEpisodeCards();
    }
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
      if (mediaType === 'tv') this.loadAvailability();
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
                ${s.name || `Season ${s.season_number}`}${s.episode_count ? ` <span class="season-ep-count">(${s.episode_count})</span>` : ''}
              </button>
            `).join('')}
          </div>
          <button class="range-picker-btn focusable" id="details-range-btn" hidden></button>
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

      const rangeBtn = this.modalEl.querySelector('#details-range-btn');
      if (rangeBtn) {
        rangeBtn.addEventListener('click', () => this.openRangePicker());
      }

      this.loadSeasonEpisodes(this.selectedSeason, resumeSeason === this.selectedSeason ? resumeEpisode : null);
    }

    nav.setScope(this.modalEl);
  }

  /**
   * Splits episodes into fixed-size ranges (e.g. "1-25", "26-50"), returning
   * null when the season is short enough that chunking would just be noise.
   */
  computeRanges(episodes) {
    if (episodes.length <= EP_CHUNK_SIZE) return null;
    const nums = episodes.map(e => e.episode_number);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const ranges = [];
    for (let start = min; start <= max; start += EP_CHUNK_SIZE) {
      ranges.push({ start, end: Math.min(start + EP_CHUNK_SIZE - 1, max) });
    }
    return ranges;
  }

  rangeContaining(episodeNumber) {
    if (!this.ranges) return null;
    return this.ranges.find(r => episodeNumber >= r.start && episodeNumber <= r.end) || this.ranges[0];
  }

  async loadSeasonEpisodes(seasonNumber, focusEpisode = null) {
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

      this.ranges = this.computeRanges(this.episodes);
      const targetEpisode = focusEpisode !== null ? focusEpisode : this.episodes[0].episode_number;
      const initialRange = this.rangeContaining(targetEpisode);
      this.selectedRangeStart = initialRange ? initialRange.start : this.episodes[0].episode_number;

      this.updateRangeButton();
      this.renderEpisodeCards(focusEpisode);
    } catch (err) {
      console.error('Failed to load season episodes:', err);
      epContainer.innerHTML = `<div style="color: #e50914; padding: 20px;">Failed to load episodes: ${err.message}</div>`;
    }
  }

  updateRangeButton() {
    const rangeBtn = this.modalEl.querySelector('#details-range-btn');
    if (!rangeBtn) return;

    // Only a long, chunked season needs a range picker at all — a normal
    // ~20-episode season is just as fast to D-pad through directly.
    if (!this.ranges) {
      rangeBtn.hidden = true;
      return;
    }

    const current = this.rangeContaining(this.selectedRangeStart);
    rangeBtn.hidden = false;
    rangeBtn.innerHTML = `Episodes ${current.start}–${current.end} ${icon('chevron-down', { size: 14 })}`;
  }

  openRangePicker() {
    if (!this.ranges) return;
    openRangeMenu({
      ranges: this.ranges,
      currentStart: this.selectedRangeStart,
      onSelect: (start) => {
        this.selectedRangeStart = start;
        this.updateRangeButton();
        this.renderEpisodeCards();
      }
    });
  }

  renderEpisodeCards(focusEpisode = null) {
    const epContainer = this.modalEl.querySelector('#episodes-container');
    if (!epContainer) return;

    const currentRange = this.rangeContaining(this.selectedRangeStart);
    const visibleEpisodes = currentRange
      ? this.episodes.filter(ep => ep.episode_number >= currentRange.start && ep.episode_number <= currentRange.end)
      : this.episodes;

    const seasonNumber = this.selectedSeason;

    epContainer.innerHTML = '';
    visibleEpisodes.forEach(ep => {
      const epCard = document.createElement('div');
      epCard.className = 'episode-card focusable';
      epCard.setAttribute('tabindex', '0');
      epCard.dataset.episodeNumber = ep.episode_number;
      // Escape hatch for spatial nav: from anywhere in this horizontally
      // scrolling row, UP always returns to the range picker button (if
      // chunked), else the active season tab — otherwise a card in the
      // middle of a wide row can have no header control directly above it
      // and UP does nothing (see spatialNav.js's data-nav-up handling).
      epCard.dataset.navUp = this.ranges ? '#details-range-btn' : '.season-btn.active';

      const stillUrl = ep.still_path ? tmdb.getImageUrl(ep.still_path, 'w500') : tmdb.getImageUrl(this.details.backdrop_path, 'w500');

      // Only render a badge once availability is actually known (see
      // loadAvailability) — absence of data means "unknown", never "missing".
      const isUnavailable = this.availableEpisodes && !this.availableEpisodes.has(ep.episode_number);
      if (isUnavailable) epCard.classList.add('episode-unavailable');
      const providerName = isUnavailable
        ? (getProviders().find(p => p.id === this.availabilityProviderId) || {}).name || this.availabilityProviderId
        : '';

      epCard.innerHTML = `
        <div class="episode-thumb">
          <img src="${stillUrl}" alt="Episode ${ep.episode_number}" loading="lazy" />
          <div class="episode-number">EP ${ep.episode_number}</div>
          ${isUnavailable ? `<div class="episode-unavailable-badge" title="Not found on ${providerName}">${icon('flag', { size: 12 })} Not on ${providerName}</div>` : ''}
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

    if (focusEpisode !== null) {
      setTimeout(() => {
        const target = epContainer.querySelector(`.episode-card[data-episode-number="${focusEpisode}"]`);
        if (target) nav.setFocus(target);
      }, 50);
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
