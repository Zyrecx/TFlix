/**
 * In-Player Season & Episode Drawer for TFlix
 * 10-foot TV UI for browsing and previewing episodes while watching
 */

import { tmdb } from '../api/tmdb.js';
import { nav } from '../nav/spatialNav.js';
import { icon } from '../ui/icons.js';

export class EpisodeDrawer {
  constructor({ media, currentSeason = 1, currentEpisode = 1, onSelectEpisode, onClose }) {
    this.media = media; // { id, title, name, ... }
    this.currentSeason = currentSeason;
    this.currentEpisode = currentEpisode;
    this.selectedSeason = currentSeason;
    this.onSelectEpisode = onSelectEpisode;
    this.onClose = onClose;

    this.drawerEl = null;
    this.episodes = [];
    this.details = null;
    this.backHandler = this.close.bind(this);
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

    await this.loadSeasonsAndEpisodes();
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
            ${s.name || `Season ${s.season_number}`}
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

      await this.loadEpisodes(this.selectedSeason);
    } catch (err) {
      console.error('Failed to load TV details for drawer:', err);
      const list = this.drawerEl.querySelector('#drawer-episodes-list');
      if (list) {
        list.innerHTML = `<div style="padding: 30px; color: #e50914;">Failed to load seasons: ${err.message}</div>`;
      }
    }
  }

  async loadEpisodes(seasonNumber) {
    this.selectedSeason = seasonNumber;

    // Update active tab button
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

      epList.innerHTML = '';
      this.episodes.forEach(ep => {
        const isCurrent = (seasonNumber === this.currentSeason && ep.episode_number === this.currentEpisode);
        const card = document.createElement('div');
        card.className = `drawer-ep-card focusable ${isCurrent ? 'current-playing' : ''}`;
        card.setAttribute('tabindex', '0');

        const stillUrl = ep.still_path ? tmdb.getImageUrl(ep.still_path, 'w500') : tmdb.getImageUrl(this.details?.backdrop_path, 'w500');

        card.innerHTML = `
          <div class="drawer-ep-thumb-wrap">
            <img src="${stillUrl}" alt="Episode ${ep.episode_number}" class="drawer-ep-thumb" loading="lazy" />
            <div class="drawer-ep-num-badge">EP ${ep.episode_number}</div>
            ${isCurrent ? `<div class="drawer-now-playing-badge">${icon('play', { size: 12 })} Playing</div>` : ''}
          </div>
          <div class="drawer-ep-info">
            <div class="drawer-ep-title">${ep.name || `Episode ${ep.episode_number}`}</div>
            <div class="drawer-ep-overview">${ep.overview || 'No episode description.'}</div>
          </div>
        `;

        card.addEventListener('click', () => {
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

      // Focus current episode or first item
      setTimeout(() => {
        const currentCard = epList.querySelector('.current-playing') || epList.querySelector('.drawer-ep-card');
        if (currentCard) {
          nav.setFocus(currentCard);
        }
      }, 50);

    } catch (err) {
      console.error('Failed to load season episodes:', err);
      epList.innerHTML = `<div style="padding: 40px; color: #e50914;">Error loading episodes: ${err.message}</div>`;
    }
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
