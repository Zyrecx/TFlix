/**
 * In-Player Season & Episode Drawer for TFlix
 * 10-foot TV UI for browsing and previewing episodes while watching
 */

import { tmdb } from '../api/tmdb.js';
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

export class EpisodeDrawer {
  constructor({ media, providerId = '', currentSeason = 1, currentEpisode = 1, onSelectEpisode, onClose }) {
    this.media = media; // { id, title, name, ... }
    this.providerId = providerId; // the actively-playing provider — see loadAvailability
    this.currentSeason = currentSeason;
    this.currentEpisode = currentEpisode;
    this.selectedSeason = currentSeason;
    this.onSelectEpisode = onSelectEpisode;
    this.onClose = onClose;

    this.drawerEl = null;
    this.episodes = []; // full episode list for the selected season
    this.ranges = null; // chunked ranges for the selected season, or null if not chunked
    this.selectedRangeStart = 1;
    this.details = null;
    this.backHandler = this.close.bind(this);
    // See DetailsModal.js's identical fields — same badge mechanism, but
    // reflects the provider actually playing right now, not the default.
    this.availableEpisodes = null;
    this.availabilityProviderId = null;
  }

  async loadAvailability() {
    if (!this.providerId) return;
    const provider = getProviders().find(p => p.id === this.providerId);
    if (!provider || !provider.supportsAvailability) return;

    const episodes = await listAvailableEpisodes(this.providerId, this.media.id, this.currentSeason);
    if (!episodes) return;

    this.availableEpisodes = new Set(episodes);
    this.availabilityProviderId = this.providerId;
    if (this.drawerEl && document.body.contains(this.drawerEl)) {
      this.renderEpisodeCards();
    }
  }

  async render() {
    this.drawerEl = document.createElement('div');
    this.drawerEl.className = 'in-player-episode-drawer';

    const title = this.media.name || this.media.title || 'TV Series';

    this.drawerEl.innerHTML = `
      <div class="drawer-backdrop" id="drawer-backdrop"></div>
      <div class="drawer-content">
        <div class="drawer-header">
          <div class="drawer-header-left">
            <h3 class="drawer-title">Episodes — ${title}</h3>
            <div class="drawer-season-tabs" id="drawer-season-tabs">
              <span style="color:#71717a; font-size:14px;">Loading seasons...</span>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm focusable" id="btn-close-drawer">
            ${icon('x')} Close
          </button>
        </div>

        <button class="range-picker-btn focusable" id="drawer-range-btn" hidden></button>

        <div class="drawer-episodes-carousel" id="drawer-episodes-list">
          <div style="padding: 40px; color: #a1a1aa; font-size: 16px;">Loading episodes...</div>
        </div>
      </div>
    `;

    document.body.appendChild(this.drawerEl);
    nav.setScope(this.drawerEl);
    nav.pushBackHandler(this.backHandler);

    this.drawerEl.querySelector('#btn-close-drawer').addEventListener('click', () => this.close());
    this.drawerEl.querySelector('#drawer-backdrop').addEventListener('click', () => this.close());
    this.drawerEl.querySelector('#drawer-range-btn').addEventListener('click', () => this.openRangePicker());

    await this.loadSeasonsAndEpisodes();
    this.loadAvailability();
    return this.drawerEl;
  }

  async loadSeasonsAndEpisodes() {
    try {
      this.details = await tmdb.getDetails('tv', this.media.id);
      const validSeasons = (this.details.seasons || []).filter(s => s.season_number > 0);

      const tabsContainer = this.drawerEl.querySelector('#drawer-season-tabs');
      if (!tabsContainer) return;

      if (validSeasons.length > 0) {
        tabsContainer.innerHTML = validSeasons.map(s => `
          <button class="season-tab-btn focusable ${s.season_number === this.selectedSeason ? 'active' : ''}" data-season="${s.season_number}">
            ${s.name || `Season ${s.season_number}`}${s.episode_count ? ` <span class="season-ep-count">(${s.episode_count})</span>` : ''}
          </button>
        `).join('');

        const seasonButtons = tabsContainer.querySelectorAll('.season-tab-btn');
        seasonButtons.forEach(btn => {
          btn.addEventListener('click', (e) => {
            const sNum = parseInt(e.currentTarget.dataset.season, 10);
            this.loadEpisodes(sNum);
          });
        });
      } else {
        tabsContainer.innerHTML = `<span style="color:#a1a1aa;">Season ${this.selectedSeason}</span>`;
      }

      await this.loadEpisodes(this.selectedSeason, this.currentEpisode);
    } catch (err) {
      console.error('Failed to load TV details for drawer:', err);
      const list = this.drawerEl.querySelector('#drawer-episodes-list');
      if (list) {
        list.innerHTML = `<div style="padding: 30px; color: #e50914;">Failed to load seasons: ${err.message}</div>`;
      }
    }
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

  async loadEpisodes(seasonNumber, focusEpisode = null) {
    this.selectedSeason = seasonNumber;

    // Update active season tab button
    const seasonButtons = this.drawerEl.querySelectorAll('.season-tab-btn');
    seasonButtons.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.season, 10) === seasonNumber);
    });

    const epList = this.drawerEl.querySelector('#drawer-episodes-list');
    if (!epList) return;
    epList.innerHTML = '<div style="padding: 40px; color: #a1a1aa;">Loading Season ' + seasonNumber + ' episodes...</div>';

    try {
      this.episodes = await tmdb.getSeasonDetails(this.media.id, seasonNumber);
      if (this.episodes.length === 0) {
        epList.innerHTML = '<div style="padding: 40px; color: #a1a1aa;">No episodes found for Season ' + seasonNumber + '.</div>';
        return;
      }

      this.ranges = this.computeRanges(this.episodes);

      const targetEpisode = focusEpisode !== null
        ? focusEpisode
        : (seasonNumber === this.currentSeason ? this.currentEpisode : this.episodes[0].episode_number);
      const initialRange = this.rangeContaining(targetEpisode);
      this.selectedRangeStart = initialRange ? initialRange.start : this.episodes[0].episode_number;

      this.updateRangeButton();
      this.renderEpisodeCards(focusEpisode);
    } catch (err) {
      console.error('Failed to load season episodes:', err);
      epList.innerHTML = `<div style="padding: 40px; color: #e50914;">Error loading episodes: ${err.message}</div>`;
    }
  }

  updateRangeButton() {
    const rangeBtn = this.drawerEl.querySelector('#drawer-range-btn');
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
    const epList = this.drawerEl.querySelector('#drawer-episodes-list');
    if (!epList) return;

    const currentRange = this.rangeContaining(this.selectedRangeStart);
    const visibleEpisodes = currentRange
      ? this.episodes.filter(ep => ep.episode_number >= currentRange.start && ep.episode_number <= currentRange.end)
      : this.episodes;

    epList.innerHTML = '';
    visibleEpisodes.forEach(ep => {
      const isCurrent = (this.selectedSeason === this.currentSeason && ep.episode_number === this.currentEpisode);
      const card = document.createElement('div');
      card.className = `drawer-ep-card focusable ${isCurrent ? 'current-playing' : ''}`;
      card.setAttribute('tabindex', '0');
      card.dataset.episodeNumber = ep.episode_number;
      // Escape hatch for spatial nav: from anywhere in this horizontally
      // scrolling carousel, UP always returns to the range picker button
      // (if chunked) or else the active season tab — otherwise a card in
      // the middle of a wide carousel can have no header control directly
      // above it and UP does nothing (see spatialNav.js's data-nav-up).
      card.dataset.navUp = this.ranges ? '#drawer-range-btn' : '.season-tab-btn.active';

      const stillUrl = ep.still_path ? tmdb.getImageUrl(ep.still_path, 'w342') : tmdb.getImageUrl(this.details?.backdrop_path, 'w342');

      // See DetailsModal.js's identical logic — absence of data means
      // "unknown", never "missing".
      const isUnavailable = this.availableEpisodes && !this.availableEpisodes.has(ep.episode_number);
      if (isUnavailable) card.classList.add('episode-unavailable');
      const providerName = isUnavailable
        ? (getProviders().find(p => p.id === this.availabilityProviderId) || {}).name || this.availabilityProviderId
        : '';

      card.innerHTML = `
        <div class="drawer-ep-thumb-wrap">
          <img src="${stillUrl}" alt="Episode ${ep.episode_number}" class="drawer-ep-thumb" loading="lazy" />
          <div class="drawer-ep-num-badge">EP ${ep.episode_number}</div>
          ${isCurrent ? `<div class="drawer-now-playing-badge">${icon('play', { size: 12 })} Playing</div>` : ''}
          ${isUnavailable ? `<div class="episode-unavailable-badge" title="Not found on ${providerName}">${icon('flag', { size: 12 })} Not on ${providerName}</div>` : ''}
        </div>
        <div class="drawer-ep-info">
          <div class="drawer-ep-title">${ep.name || `Episode ${ep.episode_number}`}</div>
          <div class="drawer-ep-overview">${ep.overview || 'No episode description.'}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        const seasonNumber = this.selectedSeason;
        this.currentSeason = seasonNumber;
        this.currentEpisode = ep.episode_number;
        this.close();
        if (this.onSelectEpisode) {
          this.onSelectEpisode({
            ...this.media,
            season: seasonNumber,
            episode: ep.episode_number,
            title: `${this.media.name || this.media.title} - S${seasonNumber}E${ep.episode_number}`,
            name: this.media.name || this.media.title
          });
        }
      });

      epList.appendChild(card);
    });

    // Focus the requested episode, else the current-playing card, else the first item
    setTimeout(() => {
      let target = null;
      if (focusEpisode !== null) {
        target = epList.querySelector(`.drawer-ep-card[data-episode-number="${focusEpisode}"]`);
      }
      target = target || epList.querySelector('.current-playing') || epList.querySelector('.drawer-ep-card');
      if (target) {
        nav.setFocus(target);
      }
    }, 50);
  }

  close() {
    nav.popBackHandler(this.backHandler);
    nav.clearScope(this.drawerEl);
    if (this.drawerEl && this.drawerEl.parentNode) {
      this.drawerEl.parentNode.removeChild(this.drawerEl);
    }
    if (this.onClose) this.onClose();
  }
}
