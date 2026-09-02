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
  CUSTOM_PROVIDERS: 'tflix_custom_providers',
  PROVIDER_REPO_URL: 'tflix_provider_repo_url',
  PLAYER_MODE: 'tflix_player_mode',
  SETUP_TOUR_SEEN: 'tflix_setup_tour_seen'
};

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

  getProviderRepoUrl() {
    return localStorage.getItem(STORAGE_KEYS.PROVIDER_REPO_URL) || '';
  },

  setProviderRepoUrl(url) {
    if (!url || url.trim() === '') {
      localStorage.removeItem(STORAGE_KEYS.PROVIDER_REPO_URL);
    } else {
      localStorage.setItem(STORAGE_KEYS.PROVIDER_REPO_URL, url.trim());
    }
  },

  getCustomProviders() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_PROVIDERS) || '[]');
    } catch {
      return [];
    }
  },

  setCustomProviders(providers) {
    if (!Array.isArray(providers) || providers.length === 0) {
      localStorage.removeItem(STORAGE_KEYS.CUSTOM_PROVIDERS);
    } else {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_PROVIDERS, JSON.stringify(providers));
    }
  },

  hasCustomProviders() {
    return this.getCustomProviders().length > 0;
  },

  clearCustomProviders() {
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_PROVIDERS);
  },

  getDefaultProvider() {
    return localStorage.getItem(STORAGE_KEYS.DEFAULT_PROVIDER) || '';
  },

  setDefaultProvider(providerId) {
    localStorage.setItem(STORAGE_KEYS.DEFAULT_PROVIDER, providerId);
  },

  getWatchlist() {
    try {
      const items = JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCHLIST) || '[]');
      return items.map(item => {
        const mediaType = item.media_type || item.mediaType || (item.first_air_date ? 'tv' : 'movie');
        return {
          ...item,
          media_type: mediaType,
          mediaType: mediaType
        };
      });
    } catch {
      return [];
    }
  },

  addToWatchlist(item) {
    const list = this.getWatchlist();
    if (!list.some(i => i.id === item.id)) {
      const mediaType = item.media_type || item.mediaType || (item.first_air_date ? 'tv' : 'movie');
      list.unshift({
        id: item.id,
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

  removeFromWatchlist(id) {
    const list = this.getWatchlist().filter(i => i.id !== id);
    localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(list));
  },

  isInWatchlist(id) {
    return this.getWatchlist().some(i => i.id === id);
  },

  getHistory() {
    try {
      const items = JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCH_HISTORY) || '[]');
      return items.map(item => {
        const mediaType = item.media_type || item.mediaType || (item.first_air_date ? 'tv' : 'movie');
        return {
          ...item,
          media_type: mediaType,
          mediaType: mediaType
        };
      });
    } catch {
      return [];
    }
  },

  saveHistory(item) {
    const mediaType = item.media_type || item.mediaType || (item.first_air_date ? 'tv' : 'movie');
    const list = this.getHistory().filter(i => i.id !== item.id);
    const existing = this.getHistory().find(i => i.id === item.id);

    list.unshift({
      id: item.id,
      media_type: mediaType,
      mediaType: mediaType,
      title: item.title || item.name,
      name: item.name || item.title,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      vote_average: item.vote_average,
      release_date: item.release_date || item.first_air_date,
      first_air_date: item.first_air_date || item.release_date,
      season: item.season || (existing ? existing.season : 1),
      episode: item.episode || (existing ? existing.episode : 1),
      currentTime: typeof item.currentTime === 'number' ? item.currentTime : (existing?.currentTime || 0),
      duration: typeof item.duration === 'number' ? item.duration : (existing?.duration || 0),
      progress: typeof item.progress === 'number' ? item.progress : (existing?.progress || 0),
      watchedAt: Date.now()
    });
    localStorage.setItem(STORAGE_KEYS.WATCH_HISTORY, JSON.stringify(list.slice(0, 30)));
  },

  updateProgress(id, season, episode, currentTime, duration) {
    if (!id || typeof currentTime !== 'number' || currentTime < 0) return;
    const list = this.getHistory();
    const item = list.find(i => i.id === id);
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

  getProgress(id, season = 1, episode = 1) {
    const item = this.getHistory().find(i => i.id === id);
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

  removeFromHistory(id) {
    const list = this.getHistory().filter(i => i.id !== id);
    localStorage.setItem(STORAGE_KEYS.WATCH_HISTORY, JSON.stringify(list));
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
