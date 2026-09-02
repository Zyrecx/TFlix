import { tmdb } from './api/tmdb.js';
import { storage } from './store/storage.js';
import { nav } from './nav/spatialNav.js';
import { createHeroBanner } from './components/HeroBanner.js';
import { createMediaRow } from './components/MediaRow.js';
import { createContinueWatchingRow } from './components/ContinueWatchingRow.js';
import { DetailsModal } from './components/DetailsModal.js';
import { PlayerModal } from './components/PlayerModal.js';
import { SearchModal } from './components/SearchModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { SetupTourModal } from './components/SetupTourModal.js';
import { refreshRelayProviders } from './api/providers.js';
import { setupTizenShim } from '../dev/tizen-shim.js';
import { setupTvRemoteSimulator } from '../dev/tv-remote-hud.js';
import { icon } from './ui/icons.js';

class TFlixApp {
  constructor() {
    this.activeTab = 'home';
    this.appEl = document.getElementById('app');
    this.mainContentEl = null;
    this.navBarEl = null;
  }

  async init() {
    // Desktop emulation shim & remote simulator are dev-tooling only. Gated
    // on Vite's build-time DEV flag rather than `!window.tizen` — TizenBrew
    // doesn't expose the `tizen` namespace to dynamically-loaded npm modules,
    // so that runtime check was true on the real TV too, shipping the
    // simulator there. import.meta.env.DEV is always false in a production
    // build (`vite build`), regardless of the runtime environment, and lets
    // Vite tree-shake this code out of the shipped bundle entirely.
    if (import.meta.env.DEV) {
      setupTizenShim();
      setupTvRemoteSimulator();
    }

    this.renderShell();
    nav.init();
    refreshRelayProviders(); // don't block first paint on this

    if (!storage.hasSeenSetupTour()) {
      this.openSetupTour();
      return; // loadTab() runs once the tour completes, via onComplete
    }

    await this.loadTab(this.activeTab);
  }

  openSetupTour() {
    const modal = new SetupTourModal({
      onComplete: () => this.loadTab(this.activeTab)
    });
    modal.render();
  }

  renderShell() {
    const navItem = (tab, iconName, label) => `
      <button class="nav-btn focusable ${this.activeTab === tab ? 'active' : ''}" data-tab="${tab}">
        ${icon(iconName, { size: 22 })}
        <span>${label}</span>
      </button>
    `;

    this.appEl.innerHTML = `
      <nav class="sidebar">
        <div class="sidebar-brand">
          <span class="brand-logo">TFLIX</span>
          <span class="brand-badge">TV</span>
        </div>
        <div class="nav-links">
          ${navItem('home', 'home', 'Home')}
          ${navItem('movies', 'film', 'Movies')}
          ${navItem('tv', 'tv', 'TV Shows')}
          ${navItem('watchlist', 'bookmark', 'Watchlist')}
          <button class="nav-btn focusable" id="nav-search-btn">${icon('search', { size: 22 })}<span>Search</span></button>
          <button class="nav-btn focusable" id="nav-settings-btn">${icon('settings', { size: 22 })}<span>Settings</span></button>
        </div>
      </nav>
      <div class="main-content" id="main-content">
        <div style="padding: 56px 48px; text-align: center; color: #a1a1aa;">
          <h2 style="color: #fff; margin-bottom: 12px;">Loading TFlix...</h2>
          <p>Connecting to TMDB</p>
        </div>
      </div>
    `;

    this.mainContentEl = this.appEl.querySelector('#main-content');
    this.navBarEl = this.appEl.querySelector('.sidebar');

    // Tab button listeners
    const tabBtns = this.navBarEl.querySelectorAll('.nav-btn[data-tab]');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.switchTab(tab);
      });
    });

    this.navBarEl.querySelector('#nav-search-btn').addEventListener('click', () => {
      this.openSearch();
    });

    this.navBarEl.querySelector('#nav-settings-btn').addEventListener('click', () => {
      this.openSettings();
    });
  }

  async switchTab(tab) {
    if (this.activeTab === tab && this.mainContentEl.children.length > 1) return;
    this.activeTab = tab;

    const tabBtns = this.navBarEl.querySelectorAll('.nav-btn[data-tab]');
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    await this.loadTab(tab);
  }

  async loadTab(tab) {
    if (tab !== 'watchlist' && !storage.hasApiKey()) {
      this.mainContentEl.innerHTML = `
        <div style="padding: 64px 48px; text-align: center; max-width: 650px; margin: 0 auto;">
          <div style="margin-bottom: 16px; color: #e50914;">${icon('key', { size: 54 })}</div>
          <h2 style="color: #fff; font-size: 28px; font-weight: 800; margin-bottom: 12px;">TMDB API Key Required</h2>
          <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin-bottom: 28px;">
            TFlix requires your free TMDB API key to browse the catalog, view movie/TV details, and fetch streaming media.
            <br><br>
            Get your free key at <strong style="color: #e50914;">themoviedb.org/settings/api</strong>.
          </p>
          <button class="btn btn-primary focusable primary-focus" id="btn-setup-key" style="padding: 14px 32px; font-size: 16px;">
            ${icon('settings')} Open Settings & Enter Key
          </button>
        </div>
      `;
      this.mainContentEl.querySelector('#btn-setup-key').addEventListener('click', () => this.openSettings());
      setTimeout(() => nav.focusFirstAvailable(), 50);
      return;
    }

    this.mainContentEl.innerHTML = `
      <div style="padding: 64px 48px; text-align: center; color: #a1a1aa;">
        <h2 style="color: #fff; margin-bottom: 12px;">Loading catalog...</h2>
      </div>
    `;

    try {
      if (tab === 'home') {
        await this.renderHomeTab();
      } else if (tab === 'movies') {
        await this.renderMoviesTab();
      } else if (tab === 'tv') {
        await this.renderTvTab();
      } else if (tab === 'watchlist') {
        this.renderWatchlistTab();
      }
      // Re-focus first element after view render
      setTimeout(() => {
        nav.focusFirstAvailable();
      }, 100);
    } catch (err) {
      console.error('Tab loading error:', err);
      this.mainContentEl.innerHTML = `
        <div style="padding: 64px 48px; text-align: center;">
          <h2 style="color: #e50914; margin-bottom: 14px;">Error Loading Content</h2>
          <p style="color: #a1a1aa; margin-bottom: 24px;">${err.message}</p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button class="btn btn-primary focusable" id="btn-retry-tab">Retry</button>
            <button class="btn btn-secondary focusable" id="btn-err-settings">Open Settings</button>
          </div>
        </div>
      `;
      this.mainContentEl.querySelector('#btn-retry-tab').addEventListener('click', () => this.loadTab(tab));
      this.mainContentEl.querySelector('#btn-err-settings').addEventListener('click', () => this.openSettings());
      nav.focusFirstAvailable();
    }
  }

  async renderHomeTab() {
    this.mainContentEl.innerHTML = '';

    const [trending, popMovies, popTv, topMovies] = await Promise.all([
      tmdb.getTrending('all', 'week'),
      tmdb.getPopularMovies(1),
      tmdb.getPopularTV(1),
      tmdb.getTopRatedMovies(1)
    ]);

    // Hero banner from top trending
    const heroItem = trending[0];
    const heroBanner = createHeroBanner({
      item: heroItem,
      onPlay: (item) => this.openPlayer(item),
      onDetails: (item) => this.openDetails(item)
    });
    this.mainContentEl.appendChild(heroBanner);

    // Continue Watching Row (if any)
    const history = storage.getHistory();
    if (history.length > 0) {
      const historyRow = createContinueWatchingRow({
        items: history,
        onItemSelect: (item) => this.openDetails(item)
      });
      this.mainContentEl.appendChild(historyRow);
    }

    // Trending Row
    const trendingRow = createMediaRow({
      title: 'Trending This Week',
      icon: 'flame',
      items: trending.slice(1),
      onItemSelect: (item) => this.openDetails(item)
    });
    this.mainContentEl.appendChild(trendingRow);

    // Popular Movies Row
    const popMoviesRow = createMediaRow({
      title: 'Popular Movies',
      icon: 'popcorn',
      items: popMovies,
      onItemSelect: (item) => this.openDetails(item)
    });
    this.mainContentEl.appendChild(popMoviesRow);

    // Popular TV Series Row
    const popTvRow = createMediaRow({
      title: 'Popular TV Series',
      icon: 'tv',
      items: popTv,
      onItemSelect: (item) => this.openDetails(item)
    });
    this.mainContentEl.appendChild(popTvRow);

    // Top Rated Movies
    const topMoviesRow = createMediaRow({
      title: 'Critically Acclaimed',
      icon: 'star',
      items: topMovies,
      onItemSelect: (item) => this.openDetails(item)
    });
    this.mainContentEl.appendChild(topMoviesRow);
  }

  async renderMoviesTab() {
    this.mainContentEl.innerHTML = '';

    const [trendingMovies, popMovies, topMovies, actionMovies, scifiMovies] = await Promise.all([
      tmdb.getTrending('movie', 'week'),
      tmdb.getPopularMovies(1),
      tmdb.getTopRatedMovies(1),
      tmdb.getByGenre('movie', 28),
      tmdb.getByGenre('movie', 878)
    ]);

    const heroBanner = createHeroBanner({
      item: trendingMovies[0],
      onPlay: (item) => this.openPlayer(item),
      onDetails: (item) => this.openDetails(item)
    });
    this.mainContentEl.appendChild(heroBanner);

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Trending Movies',
      icon: 'flame',
      items: trendingMovies.slice(1),
      onItemSelect: (item) => this.openDetails(item)
    }));

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Popular Right Now',
      icon: 'popcorn',
      items: popMovies,
      onItemSelect: (item) => this.openDetails(item)
    }));

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Action & Adventure',
      icon: 'zap',
      items: actionMovies,
      onItemSelect: (item) => this.openDetails(item)
    }));

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Sci-Fi & Fantasy',
      icon: 'rocket',
      items: scifiMovies,
      onItemSelect: (item) => this.openDetails(item)
    }));

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Top Rated All Time',
      icon: 'star',
      items: topMovies,
      onItemSelect: (item) => this.openDetails(item)
    }));
  }

  async renderTvTab() {
    this.mainContentEl.innerHTML = '';

    const [trendingTv, popTv, topTv, dramaTv, scifiTv] = await Promise.all([
      tmdb.getTrending('tv', 'week'),
      tmdb.getPopularTV(1),
      tmdb.getTopRatedTV(1),
      tmdb.getByGenre('tv', 18),
      tmdb.getByGenre('tv', 10765)
    ]);

    const heroBanner = createHeroBanner({
      item: trendingTv[0],
      onPlay: (item) => this.openPlayer(item),
      onDetails: (item) => this.openDetails(item)
    });
    this.mainContentEl.appendChild(heroBanner);

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Trending Series',
      icon: 'flame',
      items: trendingTv.slice(1),
      onItemSelect: (item) => this.openDetails(item)
    }));

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Popular Shows',
      icon: 'tv',
      items: popTv,
      onItemSelect: (item) => this.openDetails(item)
    }));

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Sci-Fi & Supernatural',
      icon: 'satellite',
      items: scifiTv,
      onItemSelect: (item) => this.openDetails(item)
    }));

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Gripping Dramas',
      icon: 'drama',
      items: dramaTv,
      onItemSelect: (item) => this.openDetails(item)
    }));

    this.mainContentEl.appendChild(createMediaRow({
      title: 'Top Rated Series',
      icon: 'star',
      items: topTv,
      onItemSelect: (item) => this.openDetails(item)
    }));
  }

  renderWatchlistTab() {
    this.mainContentEl.innerHTML = '';
    const watchlist = storage.getWatchlist();

    const container = document.createElement('div');
    container.style.padding = '100px 48px 48px';

    if (watchlist.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 80px 20px; color: #a1a1aa;">
          <div style="margin-bottom: 16px; color: #fbbf24; display: flex; justify-content: center;">${icon('bookmark', { size: 48 })}</div>
          <h2 style="color: #fff; margin-bottom: 10px;">Your Watchlist is Empty</h2>
          <p style="margin-bottom: 24px;">Add movies and TV shows from the details screen to find them here.</p>
          <button class="btn btn-primary focusable primary-focus" id="btn-browse-home">Browse Home</button>
        </div>
      `;
      container.querySelector('#btn-browse-home').addEventListener('click', () => this.switchTab('home'));
    } else {
      container.innerHTML = `
        <h2 style="font-size: 28px; font-weight: 800; margin-bottom: 24px;">My Watchlist (${watchlist.length})</h2>
        <div class="search-results-grid" id="watchlist-grid"></div>
      `;
      const grid = container.querySelector('#watchlist-grid');
      const history = storage.getHistory();
      watchlist.forEach(item => {
        const card = document.createElement('div');
        card.className = 'media-card focusable';
        card.setAttribute('tabindex', '0');

        const itemTitle = item.title || item.name || 'Untitled';
        const posterUrl = tmdb.getImageUrl(item.poster_path, 'w500');
        const year = (item.release_date || item.first_air_date || '').substring(0, 4);
        const isTv = item.media_type === 'tv' || item.mediaType === 'tv';
        const progressItem = history.find(h => h.id === item.id);
        const progressLabel = progressItem && progressItem.progress > 0
          ? `${progressItem.progress}% watched${isTv && progressItem.season ? ` · S${progressItem.season} E${progressItem.episode}` : ''}`
          : (isTv ? 'TV' : 'Movie');

        card.innerHTML = `
          <img src="${posterUrl}" alt="${itemTitle}" loading="lazy" />
          ${progressItem && progressItem.progress > 0 ? `<div class="cw-progress-track"><div class="cw-progress-fill" style="width:${progressItem.progress}%"></div></div>` : ''}
          <div class="media-card-info">
            <div class="media-card-title">${itemTitle}</div>
            <div class="media-card-sub">
              <span>${year}</span>
              <span style="color:#e50914; font-weight:700;">${progressLabel}</span>
            </div>
          </div>
        `;

        card.addEventListener('click', () => {
          this.openDetails(item);
        });

        grid.appendChild(card);
      });
    }

    this.mainContentEl.appendChild(container);
  }

  openDetails(item) {
    const modal = new DetailsModal({
      item,
      onPlay: (media) => this.openPlayer(media),
      onClose: () => {
        if (this.activeTab === 'watchlist') {
          this.renderWatchlistTab();
        }
      }
    });
    modal.render();
  }

  openPlayer(media) {
    const modal = new PlayerModal({
      media,
      onNextEpisode: (nextMedia) => {
        this.openPlayer(nextMedia);
      },
      onClose: () => {
        if (this.activeTab === 'home') {
          this.loadTab('home');
        }
      }
    });
    modal.render();
  }

  openSearch() {
    const modal = new SearchModal({
      onSelectMedia: (item) => {
        modal.close();
        this.openDetails(item);
      }
    });
    modal.render();
  }

  openSettings() {
    const modal = new SettingsModal({
      onSettingsChanged: () => {
        this.loadTab(this.activeTab);
      }
    });
    modal.render();
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new TFlixApp();
  app.init();
});
