/**
 * Local storage manager for TFlix
 * Stores user TMDB token, watch history, watchlist, and server preferences
 */

const STORAGE_KEYS = {
  TMDB_API_KEY: 'tflix_tmdb_api_key',
  WATCH_HISTORY: 'tflix_watch_history',
  WATCHLIST: 'tflix_watchlist',
  DEFAULT_PROVIDER: 'tflix_default_provider',
  LAST_TAB: 'tflix_last_tab',
  CUSTOM_PROVIDER_SOURCES: 'tflix_custom_provider_sources',
  PLAYER_MODE: 'tflix_player_mode',
  SETUP_TOUR_SEEN: 'tflix_setup_tour_seen',
  CONFIRMED_SHOW_MAP: 'tflix_confirmed_show_map',
  EPISODE_AVAILABILITY: 'tflix_episode_availability'
};

const EPISODE_AVAILABILITY_TTL_MS = 24 * 60 * 60 * 1000;

export const storage = {
  getApiKey() {
    return localStorage.getItem(STORAGE_KEYS.TMDB_API_KEY) || '';
  },

  hasApiKey() {
    const key = this.getApiKey();
    return Boolean(key && key.trim() !== '');
  },

  getCustomApiKey() {
    return this.getApiKey();
  },

  setApiKey(key) {
    if (!key || key.trim() === '') {
      localStorage.removeItem(STORAGE_KEYS.TMDB_API_KEY);
    } else {
      localStorage.setItem(STORAGE_KEYS.TMDB_API_KEY, key.trim());
    }
  },

  isUsingCustomKey() {
    return this.hasApiKey();
  },

  getPlayerMode() {
    return localStorage.getItem(STORAGE_KEYS.PLAYER_MODE) || 'auto'; // 'auto' | 'native' | 'embed'
  },

  setPlayerMode(mode) {
    localStorage.setItem(STORAGE_KEYS.PLAYER_MODE, mode);
  },

  // Embed-type provider sources — each one a repository URL the user added,
  // kept as its own group rather than merged into one flat list, so adding
  // a second source doesn't wipe the first (see providers.js#fetchProvidersFromUrl).
  getProviderSources() {
    try {
      const sources = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_PROVIDER_SOURCES) || '[]');
      return Array.isArray(sources) ? sources : [];
    } catch {
      return [];
    }
  },

  setProviderSources(sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
      localStorage.removeItem(STORAGE_KEYS.CUSTOM_PROVIDER_SOURCES);
    } else {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_PROVIDER_SOURCES, JSON.stringify(sources));
    }
  },

  // Adds a new source, or replaces the existing one with the same URL
  // (re-fetching a URL you already added updates it in place).
  addProviderSource(url, providers) {
    const sources = this.getProviderSources().filter(s => s.url !== url);
    sources.push({ url, providers, addedAt: Date.now() });
    this.setProviderSources(sources);
  },

  removeProviderSource(url) {
    this.setProviderSources(this.getProviderSources().filter(s => s.url !== url));
  },

  getCustomProviders() {
    return this.getProviderSources().flatMap(s => s.providers || []);
  },

  hasCustomProviders() {
    return this.getCustomProviders().length > 0;
  },

  getDefaultProvider() {
    return localStorage.getItem(STORAGE_KEYS.DEFAULT_PROVIDER) || '';
  },

  setDefaultProvider(providerId) {
    localStorage.setItem(STORAGE_KEYS.DEFAULT_PROVIDER, providerId);
  },

  // Composite identity for anything id-keyed (watchlist/history dedup and
  // lookup). A bare `id` is no longer sufficient once a native-catalog
  // provider's own id space exists alongside TMDB's — the two could
  // theoretically collide. `source` is `'tmdb'` for every existing/TMDB-flow
  // record, or a providerId for a native item (see docs/PROVIDER_PACKS.md's
  // "Native catalogs" section).
  _itemKey(source, id) {
    return `${source}:${id}`;
  },

  getWatchlist() {
    try {
      const items = JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCHLIST) || '[]');
      return items.map(item => {
        const mediaType = item.media_type || item.mediaType || (item.first_air_date ? 'tv' : 'movie');
        return {
          ...item,
          media_type: mediaType,
          mediaType: mediaType,
          source: item.source || 'tmdb'
        };
      });
    } catch {
      return [];
    }
  },

  addToWatchlist(item) {
    const list = this.getWatchlist();
    const source = item.source || 'tmdb';
    if (!list.some(i => this._itemKey(i.source, i.id) === this._itemKey(source, item.id))) {
      const mediaType = item.media_type || item.mediaType || (item.first_air_date ? 'tv' : 'movie');
      list.unshift({
        id: item.id,
        source,
        media_type: mediaType,
        mediaType: mediaType,
        title: item.title || item.name,
        name: item.name || item.title,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path,
        vote_average: item.vote_average,
        release_date: item.release_date || item.first_air_date,
        first_air_date: item.first_air_date || item.release_date,
        addedAt: Date.now()
      });
      localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(list.slice(0, 100)));
    }
  },

  removeFromWatchlist(source, id) {
    const list = this.getWatchlist().filter(i => this._itemKey(i.source, i.id) !== this._itemKey(source, id));
    localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(list));
  },

  isInWatchlist(source, id) {
    return this.getWatchlist().some(i => this._itemKey(i.source, i.id) === this._itemKey(source, id));
  },

  getHistory() {
    try {
      const items = JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCH_HISTORY) || '[]');
      return items.map(item => {
        const mediaType = item.media_type || item.mediaType || (item.first_air_date ? 'tv' : 'movie');
        return {
          ...item,
          media_type: mediaType,
          mediaType: mediaType,
          source: item.source || 'tmdb'
        };
      });
    } catch {
      return [];
    }
  },

  saveHistory(item) {
    const source = item.source || 'tmdb';
    const mediaType = item.media_type || item.mediaType || (item.first_air_date ? 'tv' : 'movie');
    const list = this.getHistory().filter(i => this._itemKey(i.source, i.id) !== this._itemKey(source, item.id));
    const existing = this.getHistory().find(i => this._itemKey(i.source, i.id) === this._itemKey(source, item.id));

    const season = item.season || (existing ? existing.season : 1);
    const episode = item.episode || (existing ? existing.episode : 1);
    // Only one history record is kept per show/movie id, so switching
    // episodes reuses this same record. Carrying over `existing`'s saved
    // progress here is only correct when it's progress for THIS episode —
    // otherwise a fresh episode inherits whatever time the last one left
    // off at, and the resume-progress check (which reads this record right
    // after this call) "resumes" the new episode into the old one's spot.
    const sameEpisode = existing && existing.season === season && existing.episode === episode;

    list.unshift({
      id: item.id,
      source,
      media_type: mediaType,
      mediaType: mediaType,
      title: item.title || item.name,
      name: item.name || item.title,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      vote_average: item.vote_average,
      release_date: item.release_date || item.first_air_date,
      first_air_date: item.first_air_date || item.release_date,
      season,
      episode,
      currentTime: typeof item.currentTime === 'number' ? item.currentTime : (sameEpisode ? existing.currentTime : 0),
      duration: typeof item.duration === 'number' ? item.duration : (sameEpisode ? existing.duration : 0),
      progress: typeof item.progress === 'number' ? item.progress : (sameEpisode ? existing.progress : 0),
      watchedAt: Date.now()
    });
    localStorage.setItem(STORAGE_KEYS.WATCH_HISTORY, JSON.stringify(list.slice(0, 30)));
  },

  updateProgress(source, id, season, episode, currentTime, duration) {
    if (!id || typeof currentTime !== 'number' || currentTime < 0) return;
    const list = this.getHistory();
    const item = list.find(i => this._itemKey(i.source, i.id) === this._itemKey(source, id));
    if (item) {
      item.season = season || item.season || 1;
      item.episode = episode || item.episode || 1;
      item.currentTime = Math.floor(currentTime);
      item.duration = Math.floor(duration || item.duration || 0);
      item.progress = item.duration > 0 ? Math.min(100, Math.round((item.currentTime / item.duration) * 100)) : 0;
      item.watchedAt = Date.now();
      localStorage.setItem(STORAGE_KEYS.WATCH_HISTORY, JSON.stringify(list));
    }
  },

  getProgress(source, id, season = 1, episode = 1) {
    const item = this.getHistory().find(i => this._itemKey(i.source, i.id) === this._itemKey(source, id));
    if (!item) return null;
    const isTv = item.media_type === 'tv' || item.mediaType === 'tv';
    if (isTv) {
      if (item.season === season && item.episode === episode && item.currentTime > 5) {
        return {
          currentTime: item.currentTime,
          duration: item.duration,
          progress: item.progress
        };
      }
      return null;
    }
    if (item.currentTime > 10) {
      return {
        currentTime: item.currentTime,
        duration: item.duration,
        progress: item.progress
      };
    }
    return null;
  },

  clearHistory() {
    localStorage.removeItem(STORAGE_KEYS.WATCH_HISTORY);
  },

  removeFromHistory(source, id) {
    const list = this.getHistory().filter(i => this._itemKey(i.source, i.id) !== this._itemKey(source, id));
    localStorage.setItem(STORAGE_KEYS.WATCH_HISTORY, JSON.stringify(list));
  },

  // Caches a user's disambiguation choice for an ambiguous title match on a
  // "direct" provider (see resolve()'s `needsConfirmation` outcome), keyed
  // by provider + TMDB id, so a long-running series only ever prompts once —
  // every subsequent episode reuses the confirmed show id.
  //
  // `season` is folded into the key (as ":sN") for TV so a confirmation made
  // while watching one season never gets reused to resolve another — some
  // provider catalogs (e.g. GogoAnime) give every season its own separate
  // slug, so a show-level-only key would silently pin every season to
  // whichever one the user happened to confirm first. Pass `null`/omit for
  // movies, which have no season to disambiguate.
  _showKey(tmdbId, season) {
    return season != null ? `${tmdbId}:s${season}` : String(tmdbId);
  },

  getConfirmedShowMap() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.CONFIRMED_SHOW_MAP) || '{}');
    } catch {
      return {};
    }
  },

  getConfirmedShowId(providerId, tmdbId, season = null) {
    const map = this.getConfirmedShowMap();
    return (map[providerId] && map[providerId][this._showKey(tmdbId, season)]) || null;
  },

  setConfirmedShowId(providerId, tmdbId, showId, season = null) {
    const map = this.getConfirmedShowMap();
    if (!map[providerId]) map[providerId] = {};
    map[providerId][this._showKey(tmdbId, season)] = showId;
    localStorage.setItem(STORAGE_KEYS.CONFIRMED_SHOW_MAP, JSON.stringify(map));
  },

  // Client-side cache for streamScraper.js's listAvailableEpisodes, keyed
  // the same way as confirmedShowId (including the season fold-in — an
  // available-episode list is for one season's slug, not the whole show).
  // TTL because new episodes do get dubbed/added over time.
  getEpisodeAvailability(providerId, tmdbId, season = null) {
    try {
      const map = JSON.parse(localStorage.getItem(STORAGE_KEYS.EPISODE_AVAILABILITY) || '{}');
      const entry = map[providerId] && map[providerId][this._showKey(tmdbId, season)];
      if (!entry || Date.now() - entry.fetchedAt > EPISODE_AVAILABILITY_TTL_MS) return null;
      return entry.episodes;
    } catch {
      return null;
    }
  },

  setEpisodeAvailability(providerId, tmdbId, episodes, season = null) {
    let map;
    try {
      map = JSON.parse(localStorage.getItem(STORAGE_KEYS.EPISODE_AVAILABILITY) || '{}');
    } catch {
      map = {};
    }
    if (!map[providerId]) map[providerId] = {};
    map[providerId][this._showKey(tmdbId, season)] = { episodes, fetchedAt: Date.now() };
    localStorage.setItem(STORAGE_KEYS.EPISODE_AVAILABILITY, JSON.stringify(map));
  },

  hasSeenSetupTour() {
    return localStorage.getItem(STORAGE_KEYS.SETUP_TOUR_SEEN) === '1';
  },

  setSetupTourSeen() {
    localStorage.setItem(STORAGE_KEYS.SETUP_TOUR_SEEN, '1');
  },

  clearAllData() {
    localStorage.clear();
  }
};
