import { tmdb } from './api/tmdb.js';
import { storage } from './store/storage.js';
import { nav } from './nav/spatialNav.js';
import { createHeroBanner } from './components/HeroBanner.js';
import { createMediaRow } from './components/MediaRow.js';
import { createContinueWatchingRow } from './components/ContinueWatchingRow.js';
import { DetailsModal } from './components/DetailsModal.js';
import { SearchModal } from './components/SearchModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { SetupTourModal } from './components/SetupTourModal.js';
import { refreshRelayProviders, getNativeCatalogProviders, getNativeSeasons, listNativeEpisodes } from './api/providers.js';
import { ProviderBrowseScreen } from './components/ProviderBrowseScreen.js';
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
    // don't block first paint on this — the Providers nav entry (native-
    // catalog packs only) appears once this resolves, see updateProvidersNavVisibility.
    refreshRelayProviders().then(() => this.updateProvidersNavVisibility());

    // Permanent, never-popped root back handler — sits at the bottom of
    // nav's back-handler stack so it only fires once every screen-level
    // modal/drawer has handled (or not needed to handle) its own Back press.
    nav.pushBackHandler(() => {
      this.showExitConfirm();
      return true;
    });

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

  showExitConfirm() {
    if (this.exitModalEl) return;

    this.exitModalEl = document.createElement('div');
    this.exitModalEl.className = 'modal-overlay';
    this.exitModalEl.innerHTML = `
      <div class="modal-container" style="max-width: 420px; padding: 36px; text-align: center;">
        <div style="margin-bottom: 14px; color: #e50914; display: flex; justify-content: center;">${icon('triangle-alert', { size: 40 })}</div>
        <h2 style="font-size: 20px; font-weight: 800; color: #fff; margin-bottom: 10px;">Exit TFlix?</h2>
        <p style="color: #a1a1aa; font-size: 14px; margin-bottom: 26px;">Are you sure you want to close the app?</p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button class="btn btn-secondary focusable primary-focus" id="exit-confirm-cancel" style="padding: 12px 28px;">Cancel</button>
          <button class="btn btn-primary focusable" id="exit-confirm-ok" style="padding: 12px 28px;">Exit</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.exitModalEl);

    const closeHandler = () => {
      this.closeExitConfirm();
      return true;
    };
    nav.setScope(this.exitModalEl);
    nav.pushBackHandler(closeHandler);
    this._exitBackHandler = closeHandler;

    this.exitModalEl.querySelector('#exit-confirm-cancel').addEventListener('click', () => this.closeExitConfirm());
    this.exitModalEl.querySelector('#exit-confirm-ok').addEventListener('click', () => {
      // Always close our own dialog: if an exit mechanism actually works,
      // the whole page/context is about to go away anyway and this is
      // moot; if none is available in this environment (see nav.exitApp()),
      // the dialog must not just sit there looking stuck.
      const exited = nav.exitApp();
      if (!exited) console.warn('[App] No exit mechanism available in this environment.');
      this.closeExitConfirm();
    });
  }

  closeExitConfirm() {
    if (!this.exitModalEl) return;
    nav.popBackHandler(this._exitBackHandler);
    nav.clearScope(this.exitModalEl);
    if (this.exitModalEl.parentNode) this.exitModalEl.parentNode.removeChild(this.exitModalEl);
    this.exitModalEl = null;
    this._exitBackHandler = null;
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
          <div id="nav-providers-slot"></div>
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

    this.updateProvidersNavVisibility();
  }

  // The Providers tab only exists when at least one installed pack has its
  // own native catalog — hidden otherwise rather than shown empty (see
  // NATIVE_CATALOG_PLAN.md §6). renderShell() runs before
  // refreshRelayProviders() resolves, so this patches the nav in after the
  // fact instead of being computed at initial render time.
  updateProvidersNavVisibility() {
    const slot = this.navBarEl && this.navBarEl.querySelector('#nav-providers-slot');
    if (!slot) return;
    const hasNative = getNativeCatalogProviders().length > 0;
    if (!hasNative) {
      slot.innerHTML = '';
      if (this.activeTab === 'providers') this.switchTab('home');
      return;
    }
    if (slot.querySelector('.nav-btn')) return; // already rendered
    slot.innerHTML = `
      <button class="nav-btn focusable ${this.activeTab === 'providers' ? 'active' : ''}" data-tab="providers">
        ${icon('compass', { size: 22 })}
        <span>Providers</span>
      </button>
    `;
    slot.querySelector('.nav-btn').addEventListener('click', () => this.switchTab('providers'));
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
    // Native-catalog providers are explicitly TMDB-independent (see
    // docs/PROVIDER_PACKS.md's "Native catalogs" section) — gating the
    // Providers tab behind a TMDB key would defeat the point for a user who
    // doesn't have/want one.
    if (tab !== 'watchlist' && tab !== 'providers' && !storage.hasApiKey()) {
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
      } else if (tab === 'providers') {
        this.renderProvidersTab();
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
        onItemSelect: (item) => this.resumeHistoryItem(item)
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
        const progressItem = history.find(h => h.source === (item.source || 'tmdb') && h.id === item.id);
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
          this.openWatchlistItem(item);
        });

        grid.appendChild(card);
      });
    }

    this.mainContentEl.appendChild(container);
  }

  // Watchlist card click. A native movie's stored `id` is already what
  // resolve() needs (no episode indirection), so it can relaunch directly.
  // A native TV show's watchlist entry has no season/episode/episode-id
  // context to resume from (unlike a Continue Watching record — see
  // resumeHistoryItem), so the honest move is to drop the user into that
  // provider's own browse screen to pick an episode, not guess one.
  openWatchlistItem(item) {
    if (!item.source || item.source === 'tmdb') {
      this.openDetails(item);
      return;
    }
    const isTv = item.media_type === 'tv' || item.mediaType === 'tv';
    if (!isTv) {
      this.openPlayer(item, { nativeMode: true });
      return;
    }
    const provider = getNativeCatalogProviders().find(p => p.id === item.source);
    if (provider) this.openProviderBrowse(provider);
  }

  // Lists installed native-catalog providers as simple cards — not
  // createMediaRow, which expects TMDB-shaped media items. Tapping one opens
  // the per-provider browse screen. See NATIVE_CATALOG_PLAN.md §3.2/3.3.
  renderProvidersTab() {
    this.mainContentEl.innerHTML = '';
    const providers = getNativeCatalogProviders();

    if (this.activeProviderBrowseScreen) {
      this.activeProviderBrowseScreen = null;
    }

    if (providers.length === 0) {
      const container = document.createElement('div');
      container.style.padding = '100px 48px 48px';
      container.innerHTML = `
        <div style="text-align: center; padding: 80px 20px; color: #a1a1aa;">
          <div style="margin-bottom: 16px; color: #fbbf24; display: flex; justify-content: center;">${icon('compass', { size: 48 })}</div>
          <h2 style="color: #fff; margin-bottom: 10px;">No Native-Catalog Providers Installed</h2>
          <p>Install a provider pack with its own browsable catalog from Settings to see it here.</p>
        </div>
      `;
      this.mainContentEl.appendChild(container);
      return;
    }

    const container = document.createElement('div');
    container.style.padding = '100px 48px 48px';
    container.innerHTML = `<h2 style="font-size: 28px; font-weight: 800; margin-bottom: 24px;">Providers</h2>`;

    const grid = document.createElement('div');
    grid.className = 'search-results-grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';

    providers.forEach(provider => {
      const card = document.createElement('div');
      card.className = 'media-card focusable';
      card.setAttribute('tabindex', '0');
      card.style.aspectRatio = 'auto';
      card.innerHTML = `
        <div style="padding: 24px; display:flex; flex-direction:column; gap:8px; align-items:center; text-align:center;">
          ${icon('compass', { size: 32 })}
          <div class="media-card-title" style="margin-top:8px;">${provider.name}</div>
          <div style="color:#71717a; font-size:12px;">${(provider.catalogTypes || []).join(', ') || 'unknown types'}</div>
        </div>
      `;
      card.addEventListener('click', () => this.openProviderBrowse(provider));
      grid.appendChild(card);
    });

    container.appendChild(grid);
    this.mainContentEl.appendChild(container);
  }

  openProviderBrowse(provider) {
    this.mainContentEl.innerHTML = '';
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary focusable';
    backBtn.style.cssText = 'margin-bottom: 20px; padding: 8px 16px;';
    backBtn.innerHTML = `${icon('chevron-left', { size: 16 })} All Providers`;
    backBtn.addEventListener('click', () => this.renderProvidersTab());
    this.mainContentEl.appendChild(backBtn);

    this.activeProviderBrowseScreen = new ProviderBrowseScreen({
      provider,
      onPlayNative: (media) => this.openPlayer(media, { nativeMode: true })
    });
    this.mainContentEl.appendChild(this.activeProviderBrowseScreen.render());
    setTimeout(() => nav.focusFirstAvailable(), 50);
  }

  // Continue Watching card click. TMDB-sourced history opens Details (its
  // resume-season/episode UI, cast, etc) rather than jumping straight into
  // playback — a native item should feel the same, not skip straight to
  // the player. It has no TMDB id for DetailsModal itself, so this opens
  // that provider's own browse screen and its lightweight native-details
  // overlay instead (see ProviderBrowseScreen.js's openNativeDetails),
  // pre-resolved to a "Resume S{season} E{episode}" button. `item.id` in a
  // native history record is the show's own native id (stable across
  // episodes, see ProviderBrowseScreen.js's nativeShowId), not the specific
  // episode id resolve() needs, so a TV resume has to re-look-up which
  // episode matches the saved season/episode numbers first.
  async resumeHistoryItem(item) {
    if (!item.source || item.source === 'tmdb') {
      this.openDetails(item);
      return;
    }

    const provider = getNativeCatalogProviders().find(p => p.id === item.source);
    if (!provider) {
      // Pack got uninstalled since this was watched — nothing to show a
      // details screen from, so playback is the only option left.
      this.openPlayer(item, { nativeMode: true });
      return;
    }

    const isTv = item.media_type === 'tv' || item.mediaType === 'tv';
    const native = { id: item.id, title: item.title || item.name, poster: item.poster_path || null, type: isTv ? 'tv' : 'movie' };
    this.openProviderBrowse(provider);
    const screen = this.activeProviderBrowseScreen;

    if (!isTv) {
      screen.openNativeDetails({ _native: native });
      return;
    }

    let resume = null;
    try {
      const season = item.season || 1;
      const { seasons } = await getNativeSeasons(item.source, item.id);
      const seasonId = seasons.length > 0 ? (seasons[season - 1] || seasons[0]).id : null;
      const { episodes } = await listNativeEpisodes(item.source, item.id, seasonId);
      const targetEpisode = Number(item.episode) || 1;
      const match = episodes.find(ep => Number(ep.number) === targetEpisode) || episodes[0];
      if (match) resume = { season, episodeId: match.id, episodeNumber: match.number };
    } catch (err) {
      console.warn('[TFlixApp] Failed to resolve resume episode:', err);
    }
    screen.openNativeDetails({ _native: native }, resume);
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

  async openPlayer(media, { nativeMode = false } = {}) {
    // Dynamic import, not a static one — PlayerModal pulls in hls.js, which
    // is otherwise fetched/parsed at app cold start (via app.js's top-level
    // imports) even though most sessions spend a moment on the home screen
    // before ever opening a video. Loading it on first actual playback
    // trims that off Tizen's cold-start path; the ~1 network round trip of
    // latency here is invisible next to the modal's own render/mount time.
    const { PlayerModal } = await import('./components/PlayerModal.js');
    const modal = new PlayerModal({
      media,
      nativeMode,
      onNextEpisode: (nextMedia) => {
        this.openPlayer(nextMedia, { nativeMode });
      },
      onClose: () => {
        if (nativeMode) {
          if (this.activeProviderBrowseScreen) {
            nav.focusFirstAvailable();
          }
        } else if (this.activeTab === 'home') {
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
        // Settings installs/uninstalls packs via providers.js's own
        // refreshRelayProviders() call, not this class's — the Providers nav
        // entry (native-catalog packs only) needs its own refresh here or it
        // stays stuck at whatever it was on app load until a restart.
        this.updateProvidersNavVisibility();
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
